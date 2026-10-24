"""Extract ~45 features from an IEEE-CIS row dict (as produced by orders.js:toRows()).

Input : a single row dict with the dataset's column names.
Output: a flat dict[str, float] keyed by FEATURE_NAMES, ready for the model matrix.
"""

from __future__ import annotations

import math

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

ANONYMOUS_DOMAINS = frozenset({
    "protonmail.com", "proton.me", "tutanota.com", "guerrillamail.com",
    "tempmail.com", "yopmail.com", "10minutemail.com",
})

COMMON_DOMAINS = frozenset({
    "gmail.com", "yahoo.com", "hotmail.com", "aol.com", "comcast.net",
    "outlook.com", "icloud.com", "msn.com", "att.net", "verizon.net",
    "live.com", "mac.com", "me.com", "mail.com", "sbcglobal.net",
})

# Numeric columns read straight from the row
_NUMERIC_COLS = (
    "TransactionAmt", "dist1", "dist2",
    "C1", "C2", "C4", "C6", "C8", "C9", "C11", "C12", "C13", "C14",
    "D1", "D3", "D4", "D10", "D15",
)

# All feature names in stable order — the model matrix uses this.
FEATURE_NAMES: tuple[str, ...] = (
    # numeric (18)
    "TransactionAmt", "dist1", "dist2",
    "C1", "C2", "C4", "C6", "C8", "C9", "C11", "C12", "C13", "C14",
    "D1", "D3", "D4", "D10", "D15",
    # categorical dummies (13)
    "pcd_W", "pcd_C", "pcd_H", "pcd_R", "pcd_S",
    "brand_visa", "brand_mastercard", "brand_amex",
    "is_credit",
    "is_foreign_card",
    "is_mobile",
    "proxy_anonymous", "proxy_hidden",
    # derived (12)
    "is_anonymous_email", "is_odd_domain",
    "is_emulator", "is_gift_card", "is_night",
    "hour_sin", "hour_cos",
    "email_matches_holder", "name_matches_card", "is_hijacked",
    "ship_not_billing", "high_amount",
)


def extract(row: dict) -> dict[str, float]:
    """Turn one IEEE-CIS row dict into the model's feature vector."""
    out: dict[str, float] = {}

    # --- numeric ---
    for col in _NUMERIC_COLS:
        out[col] = _float(row.get(col))

    # --- categorical dummies ---
    pcd = str(row.get("ProductCD", "")).upper()
    for code in ("W", "C", "H", "R", "S"):
        out[f"pcd_{code}"] = 1.0 if pcd == code else 0.0

    brand = str(row.get("card4", "")).lower()
    out["brand_visa"] = 1.0 if "visa" in brand else 0.0
    out["brand_mastercard"] = 1.0 if "master" in brand else 0.0
    out["brand_amex"] = 1.0 if "amex" in brand or "american" in brand else 0.0

    out["is_credit"] = 1.0 if str(row.get("card6", "")).lower() == "credit" else 0.0

    addr2 = _float(row.get("addr2"))
    out["is_foreign_card"] = 0.0 if addr2 == 87.0 else 1.0

    out["is_mobile"] = 1.0 if str(row.get("DeviceType", "")).lower() == "mobile" else 0.0

    proxy = str(row.get("id_23", "")).lower()
    out["proxy_anonymous"] = 1.0 if "anonymous" in proxy else 0.0
    out["proxy_hidden"] = 1.0 if "hidden" in proxy else 0.0

    # --- derived ---
    email = str(row.get("P_emaildomain", "")).lower().strip()
    out["is_anonymous_email"] = 1.0 if email in ANONYMOUS_DOMAINS else 0.0
    out["is_odd_domain"] = 1.0 if email and email not in COMMON_DOMAINS and email not in ANONYMOUS_DOMAINS else 0.0

    device_info = str(row.get("DeviceInfo", "")).lower()
    id_30 = str(row.get("id_30", "")).lower()
    device_type = str(row.get("DeviceType", "")).lower()
    out["is_emulator"] = 1.0 if ("generic" in device_info) or (id_30 == "linux" and device_type == "mobile") else 0.0

    out["is_gift_card"] = 1.0 if pcd == "C" else 0.0

    # hour from TransactionDT (seconds since epoch in the game)
    dt = _float(row.get("TransactionDT"))
    hour = (dt / 3600) % 24
    out["is_night"] = 1.0 if 0 <= hour < 6 else 0.0
    out["hour_sin"] = math.sin(2 * math.pi * hour / 24)
    out["hour_cos"] = math.cos(2 * math.pi * hour / 24)

    out["email_matches_holder"] = 1.0 if str(row.get("M2", "")).upper() == "T" else 0.0
    out["name_matches_card"] = 1.0 if str(row.get("M1", "")).upper() == "T" else 0.0
    out["is_hijacked"] = 1.0 if str(row.get("M3", "")).upper() == "T" else 0.0
    out["ship_not_billing"] = 1.0 if str(row.get("M5", "")).upper() == "T" else 0.0
    out["high_amount"] = 1.0 if out["TransactionAmt"] > 500 else 0.0

    return out


def _float(v) -> float:
    """Coerce to float, default 0."""
    if v is None or v == "" or v == "null":
        return 0.0
    try:
        return float(v)
    except (ValueError, TypeError):
        return 0.0
