"""Stub server: hardcoded responses for all API routes.

Derived from prototype/game.js mock data. Lets C and D start immediately
without waiting for the real backend or ML models.

Run with: USE_STUBS=true uvicorn server.main:app --reload --port 8000
"""

from __future__ import annotations

import random
import uuid

from fastapi import APIRouter, Query

from server.models.schemas import (
    CaseFile,
    ClerkRequest,
    ClerkResponse,
    LeaderboardEntry,
    MemoRule,
    PatchNote,
    RoundStartRequest,
    RoundStartResponse,
    SubmitRequest,
    SubmitResponse,
    Tell,
    Vendor,
    VersionMetrics,
)

router = APIRouter()

# ---------------------------------------------------------------------------
# Stub data (from prototype/game.js LEVELS, SCHEMES, lines)
# ---------------------------------------------------------------------------

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

# ---------------------------------------------------------------------------
# Stub helpers
# ---------------------------------------------------------------------------


def _pick_memo(level: int) -> list[MemoRule]:
    """Pick 2 real + 1 decoy memo rules, shuffled."""
    data = STUB_LEVELS.get(level, STUB_LEVELS[1])["memo"]
    reals = [m for m in data if m["real"]]
    fakes = [m for m in data if not m["real"]]
    chosen = random.sample(reals, min(2, len(reals))) + [random.choice(fakes)]
    random.shuffle(chosen)
    return [MemoRule(text=m["text"], real=m["real"]) for m in chosen]


def _compute_stub_tells(record) -> list[Tell]:
    """Simplified version of game.js computeTells()."""
    tells: list[Tell] = []

    if record.bank_account not in ("3321", "9902", "1111", "5150", "2208", "4470"):
        tells.append(Tell(tell_type="bank_changed", strength=26.0, region="bank"))

    if record.domain_mismatch:
        tells.append(Tell(tell_type="domain_mismatch", strength=18.0, region="header"))

    if record.field_altered:
        tells.append(Tell(tell_type="altered", strength=12.0 * len(record.field_altered), region=None))

    if record.copy_generation > 0:
        tells.append(Tell(tell_type="copy_gen", strength=8.0 * record.copy_generation, region=None))

    if record.legibility.get("bank", 1.0) < 0.6:
        tells.append(Tell(tell_type="low_legibility", strength=10.0, region="bank"))

    if record.heat > 40:
        tells.append(Tell(tell_type="heat", strength=record.heat * 0.3, region=None))

    if not record.letterhead_match:
        tells.append(Tell(tell_type="letterhead", strength=14.0, region="header"))

    if record.scheme == "phantom":
        tells.append(Tell(tell_type="unknown_vendor", strength=20.0, region="header"))

    # Sort by strength descending
    tells.sort(key=lambda t: t.strength, reverse=True)
    return tells


def _score_clerk(text: str, level: int = 1) -> tuple[int, str, str]:
    """Score clerk text and return (score, tier, reply). Reusable by voice endpoint."""
    clerk = STUB_LEVELS.get(level, STUB_LEVELS[1])["clerk"]
    keywords = clerk["keywords"]
    text_lower = text.lower()

    hits = sum(1 for k in keywords if k in text_lower)
    score = 30 + hits * 25 - max(0, len(text) - 90) * 0.5 + random.randint(-10, 10)
    score = max(0, min(100, int(score)))

    if score > 60:
        tier = "good"
    elif score > 35:
        tier = "meh"
    else:
        tier = "bad"

    reply = random.choice(clerk["replies"][tier])
    return score, tier, reply


# ---------------------------------------------------------------------------
# Stub routes
# ---------------------------------------------------------------------------


@router.post("/round/start", response_model=RoundStartResponse)
async def stub_round_start(req: RoundStartRequest):
    level = req.level if req.level in STUB_LEVELS else 1
    data = STUB_LEVELS[level]

    return RoundStartResponse(
        round_id=f"stub-{uuid.uuid4().hex[:8]}",
        memo=_pick_memo(level),
        inspector_version=1,
        case_file=CaseFile(
            company=data["company"],
            vendors=data["vendors"],
            approvers=data["approvers"],
            notes=data["notes"],
        ),
    )


@router.post("/clerk", response_model=ClerkResponse)
async def stub_clerk(req: ClerkRequest):
    score, _tier, reply = _score_clerk(req.text)
    return ClerkResponse(reply=reply, persuasion_score=score)


@router.post("/submit", response_model=SubmitResponse)
async def stub_submit(req: SubmitRequest):
    tells = _compute_stub_tells(req.record)
    suspicion = sum(t.strength for t in tells) * 0.67  # v1 skill factor
    suspicion -= random.randint(-12, 12)
    caught = suspicion > 38

    payout = 0
    if not caught:
        pay_mult = SCHEME_PAY.get(req.record.scheme, 1.0)
        payout = int(req.record.amount * pay_mult)

    level_data = STUB_LEVELS.get(req.record.level, STUB_LEVELS[1])
    line_key = "catch" if caught else "pass"
    inspector_line = random.choice(level_data["lines"][line_key])

    return SubmitResponse(
        verdict="FLAGGED" if caught else "PAID",
        top_tells=tells[:3],
        inspector_line=inspector_line,
        payout=payout,
        new_version=2,
    )


@router.get("/patch-notes", response_model=list[PatchNote])
async def stub_patch_notes(since: int = Query(default=0)):
    notes = [
        PatchNote(
            version=2,
            learned=["bank account doesn't match the vendor on file"],
            invoices_trained_on=57,
        ),
        PatchNote(
            version=3,
            learned=["photocopied invoices with low legibility", "domain mismatches on known vendors"],
            invoices_trained_on=134,
        ),
    ]
    return [n for n in notes if n.version > since]


@router.get("/metrics", response_model=list[VersionMetrics])
async def stub_metrics():
    return [
        VersionMetrics(version=1, catch_rate=0.35, false_positive_rate=0.08, held_out_catch_rate=0.30),
        VersionMetrics(version=2, catch_rate=0.52, false_positive_rate=0.10, held_out_catch_rate=0.45),
        VersionMetrics(version=3, catch_rate=0.64, false_positive_rate=0.11, held_out_catch_rate=0.58),
    ]


@router.get("/leaderboard", response_model=list[LeaderboardEntry])
async def stub_leaderboard():
    return [
        LeaderboardEntry(player="Alice", money=12400, patches_caused=3),
        LeaderboardEntry(player="Bob", money=8200, patches_caused=1),
        LeaderboardEntry(player="Charlie", money=4100, patches_caused=0),
    ]
