"""Gus's reasons name what the order actually did (model.tell_for and Version.explain).

A feature's contribution only becomes a tell when the order's own value shows it: a drop four
miles away is a new address, not "shipped across the ocean"; a card's long history is not
"too many orders, too fast". Model-based checks use the shipped live version on game orders
frozen in fixtures/orders.json (rebuild it with fixtures/make_orders.py).
"""
import json
import re
from pathlib import Path

import pandas as pd
import pytest

from ml.online import features as F
from ml.online import model as M

ORDERS = json.loads((Path(__file__).parent / "fixtures" / "orders.json").read_text())
PROTOTYPE = Path(__file__).resolve().parents[3] / "prototype"


def framed(**raw):
    """One raw order -> its framed feature row."""
    return F.frame(pd.DataFrame([raw])).iloc[0]


@pytest.mark.parametrize("raw,feature,tell", [
    ({"dist1": 4, "M5": "T"}, "dist1", "new_address"),          # a mule in town is a new address
    ({"dist1": 4024, "M5": "T"}, "dist1", "far_ship"),          # a warehouse overseas is far
    ({"M5": "T"}, "M5", "new_address"),
    ({"M5": "F"}, "M5", None),
    ({"M6": "F", "M5": "T"}, "M6", "new_address"),
    ({"M6": "F", "M5": "F"}, "M6", None),                       # an emailed code has no address
    ({"C1": 10, "C6": 1, "M5": "T"}, "C1", "new_address"),      # an old card shipping somewhere new
    ({"C1": 10, "C6": 1, "M5": "F"}, "C1", None),               # a long history alone is no tell
    ({"C1": 1, "C6": 1}, "C1", "new_card"),
    ({"C1": 12, "C6": 3}, "C1", "velocity"),
    ({"C6": 3}, "C6", "velocity"),
    ({"C6": 1}, "C6", None),
    ({"C13": 1}, "C13", "new_account"),
    ({"C13": 24, "C6": 1}, "C13", None),
    ({"D4": 0}, "D4", "new_account"),
    ({"D4": 730}, "D4", None),
    ({"D1": 0}, "D1", "new_card"),
    ({"D1": 640}, "D1", None),
    ({"D3": 0.01}, "D3", "velocity"),
    ({"D3": 12}, "D3", None),
    ({"D10": 0}, "D10", "new_device"),
    ({"D10": 730}, "D10", None),
    ({"D15": 0, "M5": "T"}, "D15", "new_address"),
    ({"D15": 0, "M5": "F"}, "D15", None),
    ({"C2": 2, "M5": "T"}, "C2", "new_address"),
    ({"C14": 1, "M5": "F"}, "C14", None),
    ({"P_emaildomain": "protonmail.com"}, "P_email", "email_risky"),
    ({"P_emaildomain": "gmail.com"}, "P_email", None),
    ({"P_emaildomain": "fastmail.com"}, "P_email", "odd_domain"),
    ({"R_emaildomain": "protonmail.com"}, "R_email", "email_risky"),
    ({"TransactionDT": 3 * 3600}, "hour", "night"),
    ({"TransactionDT": 14 * 3600}, "hour", None),
    ({"TransactionAmt": 899.99}, "TransactionAmt", "amount_unusual"),
    ({"TransactionAmt": 62}, "TransactionAmt", None),
    ({"ProductCD": "C"}, "ProductCD", "gift_card"),
    ({"ProductCD": "W"}, "ProductCD", None),
    ({"dist2": 1460}, "dist2", "ip_far"),
    ({"dist2": 3}, "dist2", None),
    ({"M4": "M2"}, "M4", "foreign_card"),
    ({"M4": "M1"}, "M4", "ip_far"),
    ({"M4": "M0"}, "M4", None),
    ({"id_23": "IP_PROXY:ANONYMOUS"}, "proxy", "proxy"),
    ({}, "proxy", None),
    ({"C11": 3}, "C11", "device_reuse"),
    ({"C11": 1}, "C11", None),
    ({"id_16": "NotFound"}, "id_16", "new_device"),
    ({"id_16": "Found"}, "id_16", None),
    ({"DeviceType": "mobile", "DeviceInfo": "rv:57.0", "id_30": "Linux"}, "device", "emulator"),
    ({"DeviceInfo": "Windows", "id_30": "Windows 10", "D10": 0}, "os", "new_device"),
    ({"DeviceInfo": "Windows", "id_30": "Windows 10", "D10": 400}, "os", None),
    ({"card4": "american express"}, "card4", None),
    ({"card6": "credit"}, "card6", None),
])
def test_a_feature_names_the_tell_its_value_shows(raw, feature, tell):
    assert M.tell_for(feature, framed(**raw)) == tell


def test_every_feature_has_a_rule():
    for feature in F.FEATURES:
        M.tell_for(feature, framed())  # an empty order: no rule may fail on missing values


def _js_keys(path: Path, const: str) -> set[str]:
    body = re.search(rf"const {const} = \{{(.*?)\}};", path.read_text(), re.S).group(1)
    return set(re.findall(r"(\w+):", body))


def test_every_tell_has_a_label_and_a_box_in_the_game():
    assert M.TELLS <= _js_keys(PROTOTYPE / "orders.js", "TELL_LABELS")
    assert M.TELLS <= _js_keys(PROTOTYPE / "orders.js", "TELL_BOX")
    assert M.TELLS <= _js_keys(PROTOTYPE / "game.js", "TELL_REGION")
    assert set(M.TELL_OF.values()) <= M.TELLS


# ---------- the live version on game orders ----------


@pytest.fixture(scope="module")
def live():
    return M.load()


def tells(live, name):
    """The tells of an order's last row."""
    return [t for t, _ in live.explain(pd.DataFrame(ORDERS[name]["rows"]))[-1]]


def test_a_drop_in_town_is_a_new_address_not_the_ocean(live):
    names = tells(live, "careful_local")
    assert "new_address" in names
    assert not {"far_ship", "velocity", "email_risky"} & set(names)


def test_a_look_alike_account_is_a_new_account(live):
    assert "new_account" in tells(live, "careful_local")


def test_a_warehouse_overseas_ships_far(live):
    assert tells(live, "reshipper")[0] == "far_ship"


def test_codes_by_email_have_no_address(live):
    assert "new_address" not in tells(live, "ghost_gift_card")
    assert "new_address" not in tells(live, "hijack_gift_card")


def test_a_hijacked_account_is_not_a_burst(live):
    assert "velocity" not in tells(live, "hijack_gift_card")
    assert "velocity" not in tells(live, "rookie_kit")


def test_a_burst_of_orders_is_velocity(live):
    assert "velocity" in tells(live, "burst")


def test_the_ghost_is_named_for_its_burner_and_its_hiding(live):
    assert len({"email_risky", "proxy", "emulator", "ip_far", "night"} & set(tells(live, "ghost_gift_card"))) >= 2


def test_reasons_are_suspicion_points_strongest_first(live):
    why = live.explain(pd.DataFrame(ORDERS["ghost_gift_card"]["rows"]))[0]
    weights = [w for _, w in why]
    assert weights == sorted(weights, reverse=True) and min(weights) > 0 and len(why) <= 3
