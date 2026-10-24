"""The online backend around the fraud model (ml/online): the game sees one version everywhere,
patch notes and metrics come from the model's registry, retrains run only where they can, and
the game's nudges and perks (persuasion, heat, Patience, the Paper Shredder) still count.

Uses the shipped model versions (ml/online/models) and game orders frozen in
ml/online/tests/fixtures/orders.json. Redis isn't running: every call to it fails.
"""
import asyncio
import json
import logging
import math
import shutil
from pathlib import Path

import pandas as pd
import pytest

try:
    from ml.online import model as M  # loads LightGBM through ml/online/lgbm.py
except ImportError as e:
    pytest.skip(f"the fraud model can't load here: {e}", allow_module_level=True)

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from ml.online import train as T  # noqa: E402
from server.models.schemas import GusVerdict, OnlineRecord, RoundStartRequest  # noqa: E402
from server.routes import meta as meta_routes  # noqa: E402
from server.routes import round as round_routes  # noqa: E402
from server import stubs  # noqa: E402
from server.services import claude_service, game_state, online_data  # noqa: E402

ORDERS = json.loads((Path(M.__file__).parent / "tests" / "fixtures" / "orders.json").read_text())


@pytest.fixture(autouse=True)
def isolated(tmp_path, monkeypatch):
    monkeypatch.setattr(online_data, "DATA_DIR", tmp_path / "data")
    monkeypatch.setattr(online_data, "ROWS_CSV", tmp_path / "data" / "ieee_rows.csv")
    monkeypatch.setattr(online_data, "_retrain", {"running": False, "evasions": 0})
    monkeypatch.setattr(online_data, "_shredded", set())
    monkeypatch.setattr(online_data, "_unavailable", {"error": None, "at": 0.0})
    monkeypatch.setattr(online_data, "_warned", set())

    def no_redis(*a, **k):
        raise ConnectionError("Redis isn't running in the tests")
    for name in ("get_current_version", "get_patch_notes", "get_all_metrics", "add_patch_note"):
        monkeypatch.setattr(game_state, name, no_redis)
    return tmp_path / "data"


@pytest.fixture
def registry(tmp_path, monkeypatch):
    """A copy of the shipped versions the test can add to."""
    folder = tmp_path / "models"
    shutil.copytree(M.MODEL_DIR, folder)
    monkeypatch.setattr(M, "MODEL_DIR", folder)
    M._cache.clear()
    yield folder
    M._cache.clear()


def record(name, rank=5, **extra):
    return OnlineRecord(mode="online", level=1, scheme="typed-r1", rows=[dict(r) for r in ORDERS[name]["rows"]],
                        **{"rank": rank, "persuasion": 0, "heat": 0, **extra})


def gus(name, caught=False):
    """The browser's scripted Gus, with what each order pays (game.js judge)."""
    return GusVerdict(caught=caught, tells=[["proxy", 14.0]], payout=0, values=ORDERS[name]["values"])


def submit(name, rank=5, perks=None, **extra):
    return online_data.submit_online(record(name, rank, **extra), gus(name), "round-1", "tester", perks)


def saved(data_dir):
    return pd.read_csv(data_dir / "ieee_rows.csv")


def client(*routers):
    app = FastAPI()
    for router in routers:
        app.include_router(router)
    return TestClient(app)


LIVE = max(r["version"] for r in M.registry() if r.get("promoted"))


# ---------- one version everywhere ----------


@pytest.fixture
def start_round(monkeypatch):
    """POST /round/start on the real routes, with Redis and Claude stubbed: returns the inspector version."""
    monkeypatch.setattr(game_state, "get_current_version", lambda: 1)
    monkeypatch.setattr(game_state, "load_session", lambda sid: None)
    monkeypatch.setattr(game_state, "create_session", lambda: ("s1", {}))
    monkeypatch.setattr(game_state, "save_round", lambda *a, **k: None)
    monkeypatch.setattr(game_state, "append_round_to_session", lambda *a: None)

    async def decoy(level, tells):
        return "Friday orders are suspicious."
    monkeypatch.setattr(claude_service, "generate_memo_decoy", decoy)
    return lambda: asyncio.run(round_routes.round_start(RoundStartRequest(level=1))).inspector_version


def test_round_start_reports_the_models_version(start_round):
    assert start_round() == LIVE


def test_the_stub_round_start_reports_it_too():
    assert client(stubs.router).post("/round/start", json={"level": 1}).json()["inspector_version"] == LIVE


def test_a_win_reports_the_same_version_as_the_round_start(start_round):
    assert submit("hijack_gift_card").new_version == start_round()


def test_without_a_model_round_start_falls_back(start_round, monkeypatch):
    def gone(version=None):
        raise FileNotFoundError("no trained version yet")
    monkeypatch.setattr(M, "load", gone)
    assert start_round() == 1
    assert client(stubs.router).post("/round/start", json={"level": 1}).json()["inspector_version"] == 1


# ---------- patch notes and metrics from the model's registry ----------


@pytest.mark.parametrize("router", [meta_routes.router, stubs.router], ids=["real", "stub"])
def test_patch_notes_say_what_each_version_learned(router):
    notes = client(router).get("/patch-notes", params={"since": 1}).json()
    entry = next(r for r in M.registry() if r["version"] == 2)
    assert notes[0] == {"version": 2, "learned": entry["learned"], "invoices_trained_on": entry["trained_on"]["player"]}
    assert client(router).get("/patch-notes", params={"since": LIVE}).json() == []


@pytest.mark.parametrize("router", [meta_routes.router, stubs.router], ids=["real", "stub"])
def test_metrics_are_each_versions_test_results(router):
    rows = client(router).get("/metrics").json()
    assert [r["version"] for r in rows] == [r["version"] for r in M.registry() if r.get("promoted")]
    v2 = next(r for r in M.registry() if r["version"] == 2)
    assert rows[1] == {"version": 2, "catch_rate": v2["test"]["recall"], "false_positive_rate": v2["test"]["fpr"],
                       "held_out_catch_rate": v2["test"]["player_catch"]}
    assert rows[0]["held_out_catch_rate"] == M.registry()[0]["test"]["sim_catch"]  # v1 had no player orders yet


def test_a_version_that_failed_its_gate_stays_out_of_sight(registry):
    reg = json.loads((registry / "versions.json").read_text())
    reg.append({**reg[-1], "version": 3, "promoted": False, "learned": ["proxy"]})
    (registry / "versions.json").write_text(json.dumps(reg))
    api = client(meta_routes.router)
    assert [n["version"] for n in api.get("/patch-notes", params={"since": 1}).json()] == [2]
    assert [r["version"] for r in api.get("/metrics").json()] == [1, 2]
    assert online_data.model_version() == 2


# ---------- health ----------


def test_health_reports_the_model():
    from server import main

    model = TestClient(main.app).get("/health").json()["model"]
    assert model["version"] == LIVE and model["available"] is True
    assert set(model) >= {"learning", "why_not_learning", "wins_waiting"}


def test_health_says_why_the_model_is_off(monkeypatch):
    from server import main

    def broken(version=None):
        raise ImportError("LightGBM needs OpenMP (libomp)")
    monkeypatch.setattr(M, "load", broken)
    model = TestClient(main.app).get("/health").json()["model"]
    assert model["available"] is False and "OpenMP" in model["error"]


# ---------- retraining ----------


def test_no_retrain_is_started_without_the_dataset(monkeypatch, caplog):
    monkeypatch.setattr(T, "can_retrain", lambda: (False, "the Kaggle files aren't in ml/online/data/"))
    started = []
    monkeypatch.setattr(online_data.threading, "Thread", lambda *a, **k: started.append(1))
    with caplog.at_level(logging.WARNING):
        for _ in range(3):
            online_data._maybe_retrain(online_data.RETRAIN_EVERY)
    assert started == []
    assert caplog.text.count("Kaggle") == 1                      # said once, not on every win
    assert online_data._retrain["evasions"] == 3 * online_data.RETRAIN_EVERY  # the wins wait


def test_a_retrain_starts_where_it_can(monkeypatch):
    monkeypatch.setattr(T, "can_retrain", lambda: (True, ""))
    ran = []

    class Now:
        def __init__(self, target, daemon):
            self.target = target

        def start(self):
            ran.append(1)
    monkeypatch.setattr(online_data.threading, "Thread", Now)
    online_data._maybe_retrain(online_data.RETRAIN_EVERY)
    assert ran == [1] and online_data._retrain["evasions"] == 0


def test_this_machine_has_no_dataset_so_cannot_retrain():
    ok, why = T.can_retrain()
    assert ok is (T.F.DATA_DIR / "train_transaction.csv").exists() or (T.F.DATA_DIR / "real_identity.pkl").exists()
    assert ok or "Kaggle" in why


# ---------- the game's nudges, in the model's units ----------


def logit(p):
    return math.log(p / (1 - p))


def test_persuasion_eases_a_borderline_order():
    # the careful local sits about 1.3 log-odds over Mastermind's line; 50 persuasion is 9 points, 2.25 log-odds
    assert submit("careful_local", persuasion=0).verdict == "DECLINED"
    assert submit("careful_local", persuasion=50).verdict == "APPROVED"


def test_heat_tips_a_quiet_order():
    # the Rookie kit sits about 2 log-odds under the line; heat 80 adds (80 - 40) * 0.5 = 20 points, 5 log-odds
    assert submit("rookie_kit", heat=40).verdict == "APPROVED"
    assert submit("rookie_kit", heat=80).verdict == "DECLINED"


def test_the_gut_feeling_includes_the_nudges():
    calm = online_data.preview(record("careful_local", persuasion=50))
    tense = online_data.preview(record("careful_local", persuasion=0))
    assert calm.worry < 1 <= tense.worry


def test_results_keep_the_models_own_score():
    v = M.load()
    score = float(v.scores(pd.DataFrame(ORDERS["careful_local"]["rows"]))[0])
    assert submit("careful_local", persuasion=50).results[0]["score"] == round(score, 4)


# ---------- the card can get reported while you wait ----------


def test_a_card_can_get_reported_while_you_wait(monkeypatch):
    monkeypatch.setattr(online_data, "_roll", lambda: 0.0)  # unlucky
    r = submit("week_apart", rank=3)  # Schemer: both orders sit under the line
    assert [o["reason"] for o in r.results] == [None, "card_reported"]
    assert r.verdict == "DECLINED"
    assert r.payout == round(ORDERS["week_apart"]["values"][0])  # the first order still paid
    assert online_data._retrain["evasions"] == 1                # and it got through


def test_patience_keeps_the_card_alive(monkeypatch):
    monkeypatch.setattr(online_data, "_roll", lambda: 0.0)
    r = submit("week_apart", rank=3, perks=["patience"])
    assert [o["reason"] for o in r.results] == [None, None] and r.verdict == "APPROVED"


def test_orders_on_the_same_day_are_never_reported(monkeypatch):
    monkeypatch.setattr(online_data, "_roll", lambda: 0.0)
    assert "card_reported" not in [o["reason"] for o in submit("burst", rank=1).results]


# ---------- the Paper Shredder ----------


def test_the_paper_shredder_makes_gus_forget_one_win(isolated):
    first = submit("hijack_gift_card", perks=["shred"])
    assert first.verdict == "APPROVED" and first.payout > 0      # the player still gets away with it
    assert saved(isolated)["verdict"].tolist() == ["FORGOTTEN"]  # but Gus doesn't study it
    assert online_data._retrain["evasions"] == 0
    submit("hijack_gift_card", perks=["shred"])                  # once per run
    assert saved(isolated)["verdict"].tolist() == ["FORGOTTEN", "APPROVED"]
    assert online_data._retrain["evasions"] == 1


def test_the_report_still_counts_a_forgotten_win():
    from ml.online import report

    players = pd.DataFrame({"verdict": ["FORGOTTEN", "APPROVED", "DECLINED"]})
    assert report.got_through(players).tolist() == [True, True, False]


def test_the_submit_route_passes_the_perks_on(isolated):
    body = {"round_id": "r1", "player": "tester", "record": record("hijack_gift_card").model_dump(),
            "gus": gus("hijack_gift_card").model_dump(), "perks": ["shred"]}
    assert client(round_routes.router).post("/submit", json=body).json()["verdict"] == "APPROVED"
    assert saved(isolated)["verdict"].tolist() == ["FORGOTTEN"]


# ---------- when the model can't load ----------


def test_an_unloadable_model_is_reported_once_and_the_browser_answers(monkeypatch, caplog):
    def broken(version=None):
        raise ImportError("LightGBM needs OpenMP (libomp)")
    monkeypatch.setattr(M, "load", broken)
    with caplog.at_level(logging.WARNING):
        for _ in range(3):
            r = submit("careful_local")
    assert r.new_version == 0 and r.results is None  # the browser's verdict
    assert caplog.text.count("OpenMP") == 1


# ---------- the leaked memo ----------


def test_the_memo_says_what_the_live_version_watches():
    memo = online_data.model_memo()
    real = [m for m in memo if m["real"]]
    decoy = [m for m in memo if not m["real"]]
    assert len(real) == 2 and len(decoy) == 1
    watched = [t for t in M.load().attention().index if t in online_data.MEMO_RULES][:online_data.MEMO_FROM_TOP]
    assert all(m["tell"] in watched and m["text"] == online_data.MEMO_RULES[m["tell"]] for m in real)
    # the decoy is about something the model never weighs
    assert decoy[0]["tell"] in online_data.MEMO_DECOYS and decoy[0]["tell"] not in M.TELLS


def test_every_memo_rule_is_about_a_tell_the_game_knows():
    from ml.online.tests.test_tells import PROTOTYPE, _js_keys

    labels = _js_keys(PROTOTYPE / "orders.js", "TELL_LABELS")
    assert set(online_data.MEMO_RULES) <= labels and set(online_data.MEMO_DECOYS) <= labels
    assert set(online_data.MEMO_RULES) == set(M.TELL_OF.values())  # a sentence for every family the model can rank


def test_round_start_leaks_the_models_memo(start_round, monkeypatch):
    async def no_claude(level, tells):
        raise AssertionError("the model's memo needs no Claude decoy")
    monkeypatch.setattr(claude_service, "generate_memo_decoy", no_claude)
    memo = asyncio.run(round_routes.round_start(RoundStartRequest(level=1))).memo
    texts = set(online_data.MEMO_RULES.values()) | set(online_data.MEMO_DECOYS.values())
    assert {m.text for m in memo} <= texts and sum(not m.real for m in memo) == 1
    assert all(m.tell for m in memo)


def test_the_stub_round_start_leaks_it_too():
    memo = client(stubs.router).post("/round/start", json={"level": 1}).json()["memo"]
    assert {m["tell"] for m in memo} <= set(online_data.MEMO_RULES) | set(online_data.MEMO_DECOYS)


def test_without_a_model_the_old_memo_stays(start_round, monkeypatch):
    def gone(version=None):
        raise FileNotFoundError("no trained version yet")
    monkeypatch.setattr(M, "load", gone)
    memo = asyncio.run(round_routes.round_start(RoundStartRequest(level=1))).memo
    assert "Friday orders are suspicious." in {m.text for m in memo}  # the start_round fixture's Claude decoy
