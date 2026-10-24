"""Generate ~5000 synthetic labeled orders for bootstrapping the online fraud detector.

Values match the game's orders.js vocabulary (card brands, email domains, device strings,
city distances) so the model's feature space matches real game data.
"""

from __future__ import annotations

import random

# --- Value lists (matching orders.js) ---

_LEGIT_EMAILS = ["gmail.com", "yahoo.com", "hotmail.com", "aol.com", "comcast.net",
                 "outlook.com", "icloud.com", "msn.com"]
_ANON_EMAILS = ["protonmail.com", "proton.me", "tutanota.com", "guerrillamail.com",
                "tempmail.com", "yopmail.com", "10minutemail.com"]
_ODD_EMAILS = ["mail.ru", "qq.com", "rediffmail.com", "web.de"]

_BRANDS = ["visa", "mastercard", "american express"]
_CARD_TYPES = ["credit", "debit"]
_PCDS = ["W", "C", "H", "R", "S"]

_DEVICE_DESKTOP = [
    ("desktop", "Windows", "Windows 10", "chrome 63.0", "1920x1080", 24),
    ("desktop", "MacOS", "Mac OS X 10_12_6", "safari 11.0", "2560x1600", 24),
]
_DEVICE_MOBILE = [
    ("mobile", "iOS Device", "iOS 11.2.1", "mobile safari 11.0", "2436x1125", 32),
    ("mobile", "SAMSUNG SM-G930V Build/NRD90M", "Android 7.0", "samsung browser 6.2", "1440x2560", 32),
    ("mobile", "Moto G (4) Build/NPJ25.93-14.7", "Android 7.0", "chrome 63.0 for android", "1080x1920", 32),
]
_DEVICE_EMULATOR = [
    ("mobile", "rv:57.0", "Linux", "chrome generic", "800x600", 24),
]

_ADDR1_VALUES = [299, 325, 204, 264, 330, 100, 150, 200, 250, 300, 350]
_CARD1_VALUES = [9500, 15885, 16136, 7919, 10000, 12000, 14000, 8000]
_CARD2_VALUES = [111, 545, 204, 194, 300, 400, 150, 250]
_CARD5_VALUES = [226, 224, 117, 138, 200, 165, 190, 142]


def generate(n: int = 5000, seed: int = 42) -> list[dict]:
    """Return n labeled IEEE-CIS row dicts (each with an isFraud key)."""
    rng = random.Random(seed)
    n_fraud = int(n * 0.3)
    n_legit = n - n_fraud
    rows = [_legit_order(rng) for _ in range(n_legit)]
    rows += [_fraud_order(rng) for _ in range(n_fraud)]
    rng.shuffle(rows)
    # assign sequential TransactionIDs
    for i, row in enumerate(rows):
        row["TransactionID"] = 8000000 + i
    return rows


def _legit_order(rng: random.Random) -> dict:
    """Sample a normal customer order."""
    row: dict = {"isFraud": 0}

    # card: aged, domestic, visa or mastercard
    row["card4"] = rng.choice(["visa", "mastercard"])
    row["card6"] = rng.choice(["credit", "debit"])
    row["card1"] = rng.choice(_CARD1_VALUES)
    row["card2"] = rng.choice(_CARD2_VALUES)
    row["card3"] = 150
    row["card5"] = rng.choice(_CARD5_VALUES)
    row["addr1"] = rng.choice(_ADDR1_VALUES)
    row["addr2"] = 87  # domestic

    # email: common provider, matches cardholder
    row["P_emaildomain"] = rng.choice(_LEGIT_EMAILS)
    row["R_emaildomain"] = None
    row["M1"] = "T"  # name matches
    row["M2"] = "T"  # email matches holder
    row["M3"] = "F"  # not hijacked
    row["M4"] = "M0"  # domestic
    row["M5"] = rng.choice(["F", "F", "F", "T"])  # mostly ships to billing
    row["M6"] = "F" if row["M5"] == "T" else "T"

    # device: real laptop or phone, no proxy
    dev = rng.choice(_DEVICE_DESKTOP + _DEVICE_MOBILE)
    row["DeviceType"], row["DeviceInfo"], row["id_30"], row["id_31"] = dev[0], dev[1], dev[2], dev[3]
    row["id_33"], row["id_32"] = dev[4], dev[5]
    row["id_23"] = None  # no proxy

    # shipping: billing address or nearby
    row["dist1"] = rng.choice([0, 0, 0, rng.randint(1, 14)])
    row["dist2"] = rng.randint(0, 50)  # IP close to billing

    # amount: normal range
    row["TransactionAmt"] = round(rng.uniform(15, 300), 2)
    row["ProductCD"] = rng.choice(["W", "W", "W", "R", "H"])

    # timing: business hours / evening
    hour = rng.randint(8, 22)
    day = rng.randint(0, 180)
    row["TransactionDT"] = 86400 * 200 + day * 86400 + hour * 3600 + rng.randint(0, 3599)

    # history: moderate C-columns, aged D-columns
    card_age = rng.randint(30, 800)
    row["C1"] = rng.randint(3, 15)
    row["C2"] = rng.randint(1, 3)
    row["C4"] = rng.randint(1, 2)
    row["C6"] = 1
    row["C8"] = rng.randint(1, 2)
    row["C9"] = rng.randint(1, 5)
    row["C11"] = 1
    row["C12"] = 1
    row["C13"] = rng.randint(1, 10)
    row["C14"] = rng.randint(1, 8)
    row["D1"] = card_age
    row["D3"] = rng.randint(1, 30)
    row["D4"] = rng.randint(30, 800)
    row["D10"] = rng.randint(5, 300)
    row["D15"] = rng.randint(0, card_age)

    # identity
    row["id_12"] = "Found"
    row["id_15"] = "Found"
    row["id_16"] = "Found"

    return row


def _fraud_order(rng: random.Random) -> dict:
    """Generate a fraud order by combining 2-4 suspicious traits on a base."""
    row = _legit_order(rng)
    row["isFraud"] = 1

    # pick 2-4 traits to apply
    traits = [
        "anon_email", "foreign_card", "emulator", "vpn_proxy",
        "far_ship", "gift_card_big", "high_amount", "velocity",
        "new_card_big", "name_mismatch", "night",
    ]
    n_traits = rng.randint(2, 4)
    chosen = rng.sample(traits, min(n_traits, len(traits)))

    for trait in chosen:
        if trait == "anon_email":
            row["P_emaildomain"] = rng.choice(_ANON_EMAILS)
            row["M2"] = "F"
        elif trait == "foreign_card":
            row["addr2"] = 60
            row["addr1"] = None
            row["card4"] = rng.choice(["visa", "mastercard"])
            row["M4"] = "M2"
        elif trait == "emulator":
            dev = rng.choice(_DEVICE_EMULATOR)
            row["DeviceType"] = dev[0]
            row["DeviceInfo"] = dev[1]
            row["id_30"] = dev[2]
            row["id_31"] = dev[3]
            row["id_33"] = dev[4]
            row["id_32"] = dev[5]
        elif trait == "vpn_proxy":
            row["id_23"] = rng.choice(["IP_PROXY:ANONYMOUS", "IP_PROXY:HIDDEN"])
            row["dist2"] = rng.randint(200, 4000)
        elif trait == "far_ship":
            row["dist1"] = rng.choice([None, rng.randint(50, 2000)])
            row["M5"] = "T"
            row["M6"] = "F"
        elif trait == "gift_card_big":
            row["ProductCD"] = "C"
            row["TransactionAmt"] = rng.choice([100, 200, 500, 1000])
        elif trait == "high_amount":
            row["TransactionAmt"] = round(rng.uniform(500, 5000), 2)
        elif trait == "velocity":
            row["C6"] = rng.randint(3, 8)
            row["C1"] = rng.randint(5, 20)
        elif trait == "new_card_big":
            row["D1"] = 0
            row["C1"] = rng.randint(1, 3)
            row["TransactionAmt"] = round(rng.uniform(200, 2000), 2)
        elif trait == "name_mismatch":
            row["M1"] = "F"
            row["M2"] = "F"
        elif trait == "night":
            hour = rng.randint(0, 5)
            day = rng.randint(0, 180)
            row["TransactionDT"] = 86400 * 200 + day * 86400 + hour * 3600 + rng.randint(0, 3599)

    # fraud also often has less history
    if rng.random() < 0.5:
        row["D1"] = rng.randint(0, 10)
        row["C1"] = rng.randint(1, 3)
    if rng.random() < 0.4:
        row["id_12"] = "NotFound"
        row["id_15"] = "New"
        row["id_16"] = "NotFound"
    if rng.random() < 0.3:
        row["D10"] = 0
        row["D15"] = 0

    return row
