"""Feature frame and encoding: no dataset or trained model needed."""
import numpy as np
import pandas as pd

from ml.online import features as F


def _raw(**over):
    """A single IEEE-CIS-shaped row as orders.js produces, with overridable fields."""
    row = {"TransactionDT": 86400 * 200 + 3 * 3600, "TransactionAmt": 499.0, "ProductCD": "W",
           "card4": "visa", "card6": "credit", "dist1": 8.0, "dist2": 20.0, "P_emaildomain": "gmail.com",
           "R_emaildomain": None, "C1": 1, "C2": 1, "C6": 1, "C11": 1, "C13": 1, "C14": 1,
           "D1": 0, "D3": None, "D4": 0, "D10": 0, "D15": 0, "M4": "M0", "M5": "F", "M6": "F",
           "id_12": "NotFound", "id_16": "NotFound", "id_23": None, "id_30": "iOS 11.2.1",
           "id_31": "mobile safari 11.0", "DeviceType": "mobile", "DeviceInfo": "iOS Device"}
    row.update(over)
    return row


def test_frame_has_every_feature_column():
    x = F.frame(pd.DataFrame([_raw()]))
    assert list(x.columns) == F.FEATURES
    assert len(x) == 1


def test_hour_is_derived_from_dt():
    x = F.frame(pd.DataFrame([_raw(TransactionDT=86400 * 200 + 3 * 3600)]))
    assert x["hour"].iloc[0] == 3.0


def test_email_canonicalization():
    rows = pd.DataFrame([_raw(P_emaildomain="protonmail.com"), _raw(P_emaildomain="yahoo.co.jp"),
                         _raw(P_emaildomain="gmail.com")])
    p = F.frame(rows)["P_email"].tolist()
    assert p == ["anonymous", "yahoo", "gmail"]


def test_missing_columns_become_nan_not_crash():
    # a row with only a couple of raw columns still frames cleanly
    x = F.frame(pd.DataFrame([{"TransactionAmt": 50.0, "ProductCD": "C"}]))
    assert list(x.columns) == F.FEATURES
    assert x["TransactionAmt"].iloc[0] == 50.0


def test_proxy_strips_prefix():
    x = F.frame(pd.DataFrame([_raw(id_23="IP_PROXY:ANONYMOUS")]))
    assert x["proxy"].iloc[0] == "anonymous"


def test_encode_maps_unknown_to_other_and_fixes_categories():
    train = F.frame(pd.DataFrame([_raw(ProductCD="W")] * 40 + [_raw(ProductCD="C")] * 40))
    voc = F.vocab(train, min_count=30)
    assert "other" in voc["ProductCD"]
    # a value never seen in training is encoded as "other", not dropped
    enc = F.encode(F.frame(pd.DataFrame([_raw(ProductCD="ZZZ")])), voc)
    assert str(enc["ProductCD"].iloc[0]) == "other"
    # categories are fixed to the vocabulary, so the model always sees the same columns
    assert list(enc["ProductCD"].cat.categories) == voc["ProductCD"]


def test_vocab_drops_rare_values():
    train = F.frame(pd.DataFrame([_raw(card4="visa")] * 50 + [_raw(card4="discover")] * 3))
    voc = F.vocab(train, min_count=30)
    assert "visa" in voc["card4"]
    assert "discover" not in voc["card4"]  # too rare
