"""Level data shared by stubs and real routes.

Extracted from prototype/game.js LEVELS and SCHEMES.
"""

from __future__ import annotations

from server.models.schemas import Vendor

STUB_LEVELS = {
    1: {
        "company": "Sunny Diner Supply",
        "vendors": [
            Vendor(
                name="Pancake Pete's Flour Co.",
                domain="petesflour.com",
                bank="3321",
                usual_amount=[800, 2500],
                icon="\U0001f33e",
                items=[
                    ["Flour, 50lb sack", 12, 62],
                    ["Pancake mix, bulk", 4, 95],
                    ["Delivery", 1, 76],
                ],
            ),
            Vendor(
                name="Bubbles Dish Soap Ltd.",
                domain="bubblessoap.co",
                bank="9902",
                usual_amount=[300, 700],
                icon="\U0001fab7",
                items=[
                    ["Dish soap, 5gal", 6, 48],
                    ["Sponges (100)", 2, 39],
                    ["Rubber gloves", 10, 11],
                ],
            ),
            Vendor(
                name="Existential Dread Consulting LLC",
                domain="dreadconsulting.com",
                bank="1111",
                usual_amount=[1500, 2500],
                icon="\U0001f300",
                items=[
                    ["Menu font audit", 1, 900],
                    ["Vibes assessment", 1, 700],
                    ["Travel", 1, 400],
                ],
            ),
        ],
        "approvers": [["Marge (manager)", "up to $2,500"], ["Big Lou (owner)", "everything else"]],
        "notes": [
            "Pays invoices on Fridays.",
            "Never uses URGENT stamps \u2014 Lou hates them.",
            "Recent invoice: Pancake Pete's #PP-0193, $1,238.",
        ],
        "memo": [
            {"text": "Watch for vendors changing bank details.", "tell": "bank_changed", "real": True},
            {"text": "Check any email from an unfamiliar domain.", "tell": "domain_mismatch", "real": True},
            {"text": "Flag totals that don't add up.", "tell": "total_mismatch", "real": True},
            {"text": "Coffee stains are a sign of fraud.", "tell": "low_legibility", "real": False},
            {"text": "Anything over $5,000 goes to Lou.", "tell": "amount_unusual", "real": True},
            {"text": "Photocopies are always fake.", "tell": "copy_gen", "real": False},
        ],
        "lines": {
            "idle": ["Mmm\u2026 pie. Oh! Send me whatever.", "Is it lunch yet? It feels like lunch."],
            "pass": ["Looks great! Like a nice slice of pie.", "Yep! Totally! Stamping it!"],
            "catch": ["Hey\u2026 wait a minute. Pie can wait.", "Hold on, that's not right!"],
        },
        "clerk": {
            "name": "Brenda",
            "quirk": "always on lunch break",
            "keywords": ["lunch", "quick", "sandwich", "fast", "easy", "pie"],
            "replies": {
                "good": [
                    "Oh that's fine, sure, I'll push it through after lunch.",
                    "Short and sweet. I like you.",
                ],
                "meh": [
                    "Uh-huh. Sure. Whatever. *chews*",
                    "Is this gonna take long? Because lunch.",
                ],
                "bad": [
                    "That's a LOT of words for a Tuesday.",
                    "Hon, I'm on break. Why is this so long?",
                ],
            },
        },
    },
    2: {
        "company": "St. Mercy Hospital",
        "vendors": [
            Vendor(
                name="Gauze & Effect Medical",
                domain="gauzeeffect.med",
                bank="5150",
                usual_amount=[5000, 8000],
                icon="\U0001fa79",
                items=[
                    ["Sterile gauze, case", 40, 85],
                    ["Surgical tape", 60, 22],
                    ["Freight", 1, 680],
                ],
            ),
            Vendor(
                name="St. Scalpel Instruments",
                domain="stscalpel.com",
                bank="2208",
                usual_amount=[8000, 12000],
                icon="\U0001f52a",
                items=[
                    ["Scalpel set", 20, 310],
                    ["Autoclave pouches", 50, 48],
                    ["Calibration", 1, 1200],
                ],
            ),
            Vendor(
                name="Dr. Sleepwell Linens",
                domain="sleepwell-linens.com",
                bank="4470",
                usual_amount=[2500, 4000],
                icon="\U0001f6cf\ufe0f",
                items=[
                    ["Bed sheets (100)", 8, 260],
                    ["Pillowcases (100)", 6, 110],
                    ["Laundry fee", 1, 360],
                ],
            ),
        ],
        "approvers": [
            ["Head Nurse Okafor", "supplies up to $8,000"],
            ["CFO Dr. Ledger", "everything else, PO required"],
        ],
        "notes": [
            "Every invoice needs a PO number starting with SM-.",
            "APPROVED stamp required on anything over $5,000.",
            "Recent invoice: St. Scalpel #SS-7741, $9,630.",
        ],
        "memo": [
            {"text": "Reject invoices without a valid SM- PO.", "tell": "bad_po", "real": True},
            {"text": "Watch for vendors changing bank details.", "tell": "bank_changed", "real": True},
            {"text": "Altered fields must be re-verified.", "tell": "altered", "real": True},
            {"text": "Linen vendors are high risk.", "tell": "vendor_type", "real": False},
            {"text": "Flag photocopied invoices.", "tell": "copy_gen", "real": True},
            {"text": "Mint-colored letterheads are suspicious.", "tell": "letterhead", "real": False},
        ],
        "lines": {
            "idle": ["Please submit form 7-B in triplicate.", "Procedure is a comfort."],
            "pass": ["Form complete. Processing. Paid.", "Compliant. Moving on."],
            "catch": ["Irregularity detected. Filing a report.", "Non-compliant. Flagged."],
        },
        "clerk": {
            "name": "Theo",
            "quirk": "terrified of the manager",
            "keywords": ["manager", "approved", "policy", "signed", "urgent", "compliance"],
            "replies": {
                "good": [
                    "Oh thank goodness, if it's approved I won't get yelled at.",
                    "Policy-compliant? Bless you.",
                ],
                "meh": [
                    "I\u2026 I guess? Please don't tell anyone I asked.",
                    "Should I forward this to the manager? No? Okay.",
                ],
                "bad": [
                    "The manager is going to SEE this. I can't.",
                    "This doesn't feel like policy\u2026",
                ],
            },
        },
    },
}

SCHEME_PAY = {
    "changed_bank": 1.0,
    "duplicate": 0.9,
    "phantom": 1.2,
    "boss_request": 1.5,
}

# Collect all known bank accounts across levels for detection fallback
KNOWN_BANKS: set[str] = set()
for _level_data in STUB_LEVELS.values():
    for _vendor in _level_data["vendors"]:
        KNOWN_BANKS.add(_vendor.bank)
