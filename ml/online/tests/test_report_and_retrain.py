"""Attack-family labelling and the retrain weighting / per-player cap."""
import numpy as np
import pandas as pd

from ml.online import report as R
from ml.online import retrain as RT
from ml.online import train as T


def _raw(**over):
    row = {"TransactionAmt": 499.0, "ProductCD": "W", "card4": "visa", "card6": "credit", "dist1": 8.0,
           "dist2": 20.0, "P_emaildomain": "gmail.com", "R_emaildomain": None, "M2": "F", "M3": "F",
           "M5": "F", "M6": "F", "id_23": None, "DeviceType": "desktop", "DeviceInfo": "Windows",
           "id_30": "Windows 10", "id_31": "chrome 63.0", "TransactionDT": 0}
    row.update(over)
    return row


def test_family_flags_account_takeover():
    fam = R.family(pd.DataFrame([_raw(M3="T")])).iloc[0]
    assert fam.startswith("victim's account")


def test_family_flags_gift_card_code_by_email():
    # digital: a recipient email, no shipping distance, not shipped to billing
    fam = R.family(pd.DataFrame([_raw(R_emaildomain="burner@proton.me", dist1=None, M5="F")])).iloc[0]
    assert "code by email" in fam


def test_family_flags_abroad_shipping():
    fam = R.family(pd.DataFrame([_raw(dist1=4000.0)])).iloc[0]
    assert "abroad" in fam


def test_capped_limits_rows_per_player():
    big = pd.DataFrame({"player": ["p1"] * (RT.PLAYER_CAP + 50) + ["p2"] * 5,
                        "TransactionAmt": 1.0, "verdict": "APPROVED"})
    out = RT._capped(big)
    assert (out["player"] == "p1").sum() == RT.PLAYER_CAP   # p1 trimmed to the cap
    assert (out["player"] == "p2").sum() == 5               # p2 kept whole


def test_weights_downweight_simulated_attacks():
    train = {"real": pd.DataFrame({"x": range(100)}), "honest": pd.DataFrame({"x": range(50)}),
             "sim": pd.DataFrame({"x": range(40)})}
    w = T.weights(train, extra=7)
    assert len(w) == 100 + 50 + 40 + 7
    real_honest, sim, extra = w[:150], w[150:190], w[190:]
    assert np.allclose(real_honest, 1.0) and np.allclose(extra, 1.0)
    assert (sim < 1.0).all()   # the simulated attacks weigh less than real rows, like the real fraud rate
