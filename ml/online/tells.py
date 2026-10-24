"""Map feature contributions from the logistic regression or SHAP to player-facing tells.

Each feature that pushes toward fraud is mapped to a tell name + region (the box in the
game's forensic replay). Contributions are grouped by tell, summed, and the top 5 returned.

For the Kaggle LightGBM model, SHAP values replace logistic regression coefficients.
V-columns (anonymized) are mapped to generic pattern tells by correlation group.
"""

from __future__ import annotations

from collections import defaultdict

from server.models.schemas import Tell

# feature_name -> (tell_type, region)
# For "inverted" features (where low value = suspicious), the model's negative coefficient
# on a low value produces a positive contribution, so the mapping works directly.
FEATURE_TO_TELL: dict[str, tuple[str, str]] = {
    # email / buyer
    "is_anonymous_email":   ("email_risky", "buyer"),
    "is_odd_domain":        ("odd_domain", "buyer"),
    "email_matches_holder": ("email_mismatch", "buyer"),  # inverted: low = suspicious
    "name_matches_card":    ("name_mismatch", "buyer"),    # inverted
    # card
    "is_foreign_card":      ("foreign_card", "card"),
    "D1":                   ("new_card", "card"),           # inverted: low D1 = new card
    "C6":                   ("velocity", "card"),
    "C1":                   ("new_card", "card"),           # low C1 = new card
    # device
    "is_emulator":          ("emulator", "device"),
    "is_mobile":            ("emulator", "device"),         # secondary signal
    "proxy_anonymous":      ("proxy", "device"),
    "proxy_hidden":         ("proxy", "device"),
    "dist2":                ("ip_far", "device"),
    "C11":                  ("device_reuse", "device"),
    # shipping
    "dist1":                ("far_ship", "ship"),
    "ship_not_billing":     ("far_ship", "ship"),
    # cart
    "is_gift_card":         ("gift_card", "cart"),
    "TransactionAmt":       ("amount_unusual", "cart"),
    "high_amount":          ("amount_unusual", "cart"),
    "is_night":             ("night", "cart"),
    # --- Kaggle-model features ---
    # UID + aggregations
    "uid_is_new":           ("new_card", "card"),
    "uid_count":            ("velocity", "card"),
    "uid_mean_amt":         ("amount_unusual", "cart"),
    "uid_std_amt":          ("amount_unusual", "cart"),
    "card1_count":          ("velocity", "card"),
    "card1_mean_amt":       ("amount_unusual", "cart"),
    "addr1_count":          ("velocity", "card"),
    # Frequency / target encoding
    "card1_FE":             ("velocity", "card"),
    "addr1_FE":             ("velocity", "card"),
    "P_emaildomain_FE":     ("odd_domain", "buyer"),
    "P_emaildomain_TE":     ("email_risky", "buyer"),
    "card1_TE":             ("suspicious_pattern", "card"),
    "addr1_TE":             ("suspicious_pattern", "card"),
    "ProductCD_TE":         ("suspicious_pattern", "cart"),
    "card4_TE":             ("suspicious_pattern", "card"),
    # Amount engineering
    "amt_dollars":          ("amount_unusual", "cart"),
    "amt_cents":            ("amount_unusual", "cart"),
    "amt_log":              ("amount_unusual", "cart"),
    # D-column missingness
    "D1_missing":           ("new_card", "card"),
    "D4_missing":           ("suspicious_pattern", "card"),
    "D10_missing":          ("suspicious_pattern", "device"),
    "D11_missing":          ("suspicious_pattern", "device"),
    "D15_missing":          ("suspicious_pattern", "card"),
    # M-column pattern
    "M_nan_count":          ("suspicious_pattern", "device"),
    # Extra C/D columns (not in base features)
    "C3":                   ("velocity", "card"),
    "C5":                   ("velocity", "card"),
    "C7":                   ("velocity", "card"),
    "C10":                  ("velocity", "card"),
    "D2":                   ("new_card", "card"),
    "D5":                   ("suspicious_pattern", "card"),
    "D6":                   ("suspicious_pattern", "card"),
    "D7":                   ("suspicious_pattern", "device"),
    "D8":                   ("suspicious_pattern", "device"),
    "D9":                   ("suspicious_pattern", "device"),
    "D11":                  ("suspicious_pattern", "device"),
    "D12":                  ("suspicious_pattern", "device"),
    "D13":                  ("suspicious_pattern", "device"),
    "D14":                  ("suspicious_pattern", "device"),
}

# V-columns mapped by their correlation group to the nearest meaningful tell.
# Since V-columns are anonymized, we assign them to generic pattern tells.
V_TELL_GROUPS: dict[str, list[str]] = {
    # V-columns that correlate with transaction amount patterns
    "amount_pattern": [
        "V201", "V200", "V189", "V188", "V202", "V203", "V204", "V205",
        "V206", "V207", "V208", "V209", "V210", "V211",
    ],
    # V-columns that correlate with card/identity patterns
    "card_pattern": [
        "V257", "V246", "V244", "V242", "V258", "V259", "V260", "V261",
        "V262", "V263", "V264", "V265", "V266", "V267", "V268", "V243",
        "V245", "V247", "V248", "V249", "V250", "V251", "V252", "V253",
        "V254", "V255", "V256",
    ],
    # V-columns that correlate with device/browser patterns
    "device_pattern": [
        "V45", "V44", "V52", "V51", "V53", "V54", "V55", "V56",
        "V57", "V58", "V59", "V60", "V61", "V62",
    ],
}

# Build V-column -> tell mapping from the groups above
_V_TO_TELL: dict[str, tuple[str, str]] = {}
_V_TELL_REGION: dict[str, str] = {
    "amount_pattern": "cart",
    "card_pattern": "card",
    "device_pattern": "device",
}
for _group, _cols in V_TELL_GROUPS.items():
    _tell_type = f"suspicious_pattern"
    _region = _V_TELL_REGION.get(_group, "card")
    for _col in _cols:
        _V_TO_TELL[_col] = (_tell_type, _region)


def contributions_to_tells(contributions: dict[str, float]) -> list[Tell]:
    """Convert per-feature contributions to the top 5 player-facing tells.

    Only features with positive contribution (pushing toward fraud) are included.
    Contributions are grouped by tell name, summed, and sorted by strength.
    """
    grouped: dict[str, dict] = defaultdict(lambda: {"strength": 0.0, "region": None})

    for feat, contrib in contributions.items():
        if contrib <= 0:
            continue
        mapping = FEATURE_TO_TELL.get(feat) or _V_TO_TELL.get(feat)
        if mapping is None:
            continue
        tell_type, region = mapping
        grouped[tell_type]["strength"] += contrib
        grouped[tell_type]["region"] = region

    # Sort by total strength descending, take top 5
    sorted_tells = sorted(grouped.items(), key=lambda x: -x[1]["strength"])[:5]

    return [
        Tell(tell_type=name, strength=round(info["strength"], 3), region=info["region"])
        for name, info in sorted_tells
        if info["strength"] > 0
    ]


def shap_to_tells(
    shap_contributions: dict[str, float],
    feature_names: list[str],
) -> list[Tell]:
    """Convert SHAP feature contributions to the top 5 player-facing tells.

    Alternative to contributions_to_tells() for the LightGBM/SHAP path.
    Positive SHAP values push toward fraud (class 1); the logic is the same
    as the coefficient-based path.
    """
    return contributions_to_tells(shap_contributions)
