"""The CRS identity check offline (the mirror), and older versions still scoring without it."""
import csv

import pandas as pd

from ml.online import crs
from ml.online import features as F
from ml.online import model as M


def _row(pid, email="", name=None, own=False):
    return {"crs_id": pid, "buyer_email": email, "buyer_name": name, "buyer_is_holder": own}


def test_mirror_answers_from_the_sandbox_personas(monkeypatch):
    monkeypatch.setenv("FORGED_CRS", "off")
    c = crs.columns(pd.DataFrame([_row("P06", own=True), _row("P14", own=True), _row("P16", own=True)]))
    assert c["crs_idv"].tolist() == ["PASS", "FAIL", "STEP_UP"]
    assert c["crs_risk"].tolist() == [12.0, 80.0, 50.0]  # the sandbox's documented Fraud Finder scores


def test_mirror_rates_other_emails(monkeypatch):
    monkeypatch.setenv("FORGED_CRS", "off")
    c = crs.columns(pd.DataFrame([_row("P06", "a.b@protonmail.com", "Angela Morrissey"),
                                  _row("P06", "angela.morrissey1@gmail.com", "Angela Morrissey"),
                                  _row("P06", "angela.morrissey1@gmail.com", "Alex Smith")]))
    risk = c["crs_risk"].tolist()
    assert risk[0] == 85 and risk[1] < risk[0] and risk[2] == risk[1] + 10  # anonymous > look-alike; a wrong name adds


def test_rows_without_a_victim_stay_blank():
    c = crs.columns(pd.DataFrame([{"TransactionAmt": 10.0}, _row("nobody")]))
    assert c["crs_idv"].isna().all() and c["crs_risk"].isna().all()


def test_frame_adds_crs_only_when_asked(monkeypatch):
    monkeypatch.setenv("FORGED_CRS", "off")
    df = pd.DataFrame([{"TransactionAmt": 10.0, **_row("P13", own=True)}])
    assert list(F.frame(df).columns) == F.FEATURES and F.frame(df)["crs_idv"].iloc[0] == "FAIL"
    assert list(F.frame(df, F.LEGACY_FEATURES).columns) == F.LEGACY_FEATURES


def test_versions_before_crs_load_with_their_own_features():
    v1 = M.load(1)
    assert v1.features == F.LEGACY_FEATURES
    assert len(v1.scores(pd.DataFrame([{"TransactionAmt": 10.0, **_row("P14", own=True)}]))) == 1


def test_old_csv_header_is_upgraded(tmp_path, monkeypatch):
    from server.services import online_data as D
    path = tmp_path / "ieee_rows.csv"
    old = [c for c in D.COLUMNS if c not in ("crs_id", "buyer_email", "buyer_name", "buyer_is_holder")]
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=old)
        w.writeheader()
        w.writerow({"TransactionID": 1, "player": "p1"})
    monkeypatch.setattr(D, "ROWS_CSV", path)
    D._upgrade_header()
    with path.open(newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    assert list(rows[0]) == D.COLUMNS and rows[0]["player"] == "p1" and rows[0]["crs_id"] == ""
