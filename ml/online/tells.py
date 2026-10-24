"""Map feature contributions from the logistic regression to player-facing tells.

Each feature that pushes toward fraud is mapped to a tell name + region (the box in the
game's forensic replay). Contributions are grouped by tell, summed, and the top 5 returned.
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
}


def contributions_to_tells(contributions: dict[str, float]) -> list[Tell]:
    """Convert per-feature contributions to the top 5 player-facing tells.

    Only features with positive contribution (pushing toward fraud) are included.
    Contributions are grouped by tell name, summed, and sorted by strength.
    """
    grouped: dict[str, dict] = defaultdict(lambda: {"strength": 0.0, "region": None})

    for feat, contrib in contributions.items():
        if contrib <= 0:
            continue
        mapping = FEATURE_TO_TELL.get(feat)
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
