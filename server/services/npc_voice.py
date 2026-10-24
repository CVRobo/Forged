"""NPC brain: personality-driven conversation for all NPCs via Claude + keyword fallback.

Each NPC has a distinct personality, Cartesia voice, and gameplay effect.
When Claude is unavailable the keyword fallback mirrors the dialogue trees
from prototype/voice.js so the game works without ANTHROPIC_API_KEY.
"""

from __future__ import annotations

import json
import logging
import random
import re

from server import config
from server.content.levels import STUB_LEVELS
from server.services import game_state

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# NPC info helpers
# ---------------------------------------------------------------------------

VALID_NPCS = ("clerk", "inspector", "boss", "kevin", "dana")


def get_npc_info(level: int, npc_key: str) -> dict | None:
    """Get NPC personality data from level data. Returns None if NPC not found."""
    level_data = STUB_LEVELS.get(level, STUB_LEVELS[1])
    npcs = {k: v for k, v in level_data.items() if k in VALID_NPCS}
    npc = npcs.get(npc_key)
    if npc is None:
        return None
    info = dict(npc)  # shallow copy
    info["vendor_names"] = ", ".join(v.name for v in level_data["vendors"])
    return info


def get_npc_voice(npc_info: dict) -> str:
    """Return the Cartesia voice UUID for this NPC."""
    return npc_info.get("voice", "a0e99841-438c-4a64-b679-ae501e7d6091")


# ---------------------------------------------------------------------------
# Keyword fallback — mirrors prototype/voice.js LINES
# ---------------------------------------------------------------------------

# Regex rules ported from prototype/voice.js for each NPC.
# Each entry: (compiled regex, list of reply strings).
_KEYWORD_RULES: dict[str, list[tuple[re.Pattern, list[str]]]] = {
    "kevin": [
        (re.compile(r"\b(hi|hey|hello|morning|sup|yo)\b", re.I), [
            "Oh hey! Did you see my fantasy spreadsheet league?",
            "Heyyy! Want a gummy bear? It's from Tuesday.",
        ]),
        (re.compile(r"invoice|forg|fake|fraud|money|cash|steal", re.I), [
            "Invoices? I just rename mine final_FINAL_v2. Works every time.",
            "Money? I found a quarter in the copier once. Best day of my life.",
        ]),
        (re.compile(r"boss|manager", re.I), [
            "Shh! He can hear spreadsheets.",
            "He told me my tie was 'a choice'. I think that's a compliment?",
        ]),
        (re.compile(r"lunch|food|pizza|eat|hungry|coffee", re.I), [
            "I brought soup. In a mug. Again.",
            "There's cake in the break room! Or there was. I was there.",
        ]),
        (re.compile(r"help|favor|cover", re.I), [
            "I can help! I know Ctrl+C AND Ctrl+V.",
            "Cover for you? Sure! What are we covering? Is it a surprise party?",
        ]),
    ],
    "dana": [
        (re.compile(r"\b(hi|hey|hello|morning|sup|yo)\b", re.I), [
            "Mm.", "Hello. Make it quick.",
        ]),
        (re.compile(r"invoice|forg|fake|fraud|steal", re.I), [
            "I didn't hear that. I'm very busy not hearing things.",
            "If you're doing what I think you're doing, I want plausible deniability and a muffin.",
        ]),
        (re.compile(r"money|cash|cut|split|share", re.I), [
            "Cut me in or keep me out. Pick fast.",
            "Twenty percent and I forget your face.",
        ]),
        (re.compile(r"boss|manager", re.I), [
            "He's done three laps. He's counting the staplers.",
            "He walks the same loop every time. Like a Roomba with a mustache.",
        ]),
        (re.compile(r"gus|inspector", re.I), [
            "Gus approves anything that smells like pie.",
            "Gus is learning. That's what worries me.",
        ]),
    ],
    "clerk": [
        (re.compile(r"urgent|rush|asap|quick|now", re.I), [
            "Urgent is a feeling, hon, not a deadline. I'll note it anyway.",
            "Rush job? I'll write it down between bites.",
        ]),
        (re.compile(r"note|memo|cover|file|approve|sign", re.I), [
            "On lunch, hon. But I'll clip it to the file.",
            "Sure, sure. One cover note, coming up. With a little mustard stain.",
        ]),
        (re.compile(r"lunch|sandwich|food|eat|hungry", re.I), [
            "It's tuna. Don't judge me.",
            "Lunch is a state of mind, sweetie.",
        ]),
        (re.compile(r"\b(hi|hey|hello|morning)\b", re.I), [
            "Hi hon! I'm on lunch, but go on.",
            "Mmhm? Talk while I chew.",
        ]),
    ],
    "inspector": [
        (re.compile(r"pie|cake|donut|doughnut|cookie|snack", re.I), [
            "Pie? Where?!", "Don't tempt me. I'm on a pie-free diet. Since 10am.",
        ]),
        (re.compile(r"invoice|tray|check|inspect|approve|paid", re.I), [
            "Put it in the IN tray. I read every invoice. Mostly.",
            "I've got a stamp and I'm not afraid to use it.",
        ]),
        (re.compile(r"smart|learn|upgrade|version|ai|robot", re.I), [
            "I've been learning. From you, mostly.",
            "Every trick I see, I remember. Every. Single. One.",
        ]),
        (re.compile(r"\b(hi|hey|hello|morning)\b", re.I), [
            "Hello, citizen of accounts payable.",
            "Hi. Did you know I have a stapler?",
        ]),
    ],
    "boss": [
        (re.compile(r"\b(hi|hey|hello|morning)\b", re.I), [
            "Don't 'hi' me. Hi me with results.", "Morning. It's 3pm.",
        ]),
        (re.compile(r"raise|promotion|bonus|vacation|day off", re.I), [
            "A raise? Raise your output.",
            "Vacation? You're ON vacation. From working, apparently.",
        ]),
        (re.compile(r"sorry|apolog", re.I), [
            "Sorry doesn't hit quarterly targets.",
            "Don't be sorry. Be productive.",
        ]),
        (re.compile(r"invoice|report|working|busy|spreadsheet", re.I), [
            "Good. Keep working. I'll know if you don't.",
            "Spreadsheets. I love spreadsheets. Show me one later.",
        ]),
    ],
}

_KEYWORD_OTHER: dict[str, list[str]] = {
    "kevin": [
        "Totally. Wait, what?",
        "Ha! Classic. ...I didn't hear any of that.",
        "You should put that in a memo. I love memos.",
        "Brb, my screensaver needs me.",
    ],
    "dana": [
        "Fascinating. Truly.",
        "I have eleven tabs open and none of them are you.",
        "Is this going to be a whole thing?",
        "Noted. Filed. Forgotten.",
    ],
    "clerk": [
        'Mmhm. I\'ll put that in the note: "{q}".',
        'Got it, "{q}". Very official.',
        'Writing it down: "{q}". Don\'t tell anyone I worked during lunch.',
    ],
    "inspector": [
        "Mmm... is it lunch yet?",
        "Interesting. I'll be watching. I'm always watching.",
        "Is that so. Hm. Hmm.",
    ],
    "boss": [
        "Is that a work conversation? It doesn't sound like a work conversation.",
        "Uh huh. Back to your desk.",
        "I'm going to pretend I didn't hear that. For now.",
    ],
}

_INSPECTOR_CARRYING = [
    "Why are you holding that envelope so... casually?",
    "That envelope is sweating. Envelopes don't sweat.",
    "Chatting me up first? Hmm. Noted. Very noted.",
    "You're being awfully friendly for someone holding paperwork.",
]

_BOSS_SHOUTED = [
    "Keep it down! People are working. Allegedly.",
    "This is an OFFICE, not a sports bar!",
]


def _keyword_respond(npc_key: str, text: str, ctx: dict | None = None) -> str:
    """Keyword-based response mirroring prototype/voice.js respond()."""
    ctx = ctx or {}
    low = (text or "").lower()

    # Special cases
    if npc_key == "inspector" and ctx.get("carrying"):
        return random.choice(_INSPECTOR_CARRYING)
    if npc_key == "boss" and ctx.get("shouted"):
        return random.choice(_BOSS_SHOUTED)

    # Try regex rules
    rules = _KEYWORD_RULES.get(npc_key, [])
    for pattern, replies in rules:
        if pattern.search(low):
            return random.choice(replies)

    # Fallback
    others = _KEYWORD_OTHER.get(npc_key, ["..."])
    q = text.strip()[:40] + ("…" if len(text.strip()) > 40 else "")
    return random.choice(others).replace("{q}", q)


def _keyword_score(text: str, npc_info: dict) -> int:
    """Simple keyword hit score (0-100), used for clerk persuasion."""
    keywords = npc_info.get("keywords", [])
    text_lower = text.lower()
    hits = sum(1 for k in keywords if k in text_lower)
    score = 30 + hits * 25 - max(0, len(text) - 90) * 0.5 + random.randint(-10, 10)
    return max(0, min(100, int(score)))


# ---------------------------------------------------------------------------
# Claude-powered NPC conversation
# ---------------------------------------------------------------------------


def _build_system_prompt(npc_info: dict, history: list[dict]) -> str:
    """Build the Claude system prompt including personality and conversation history."""
    base = npc_info.get("system_prompt", f"You are {npc_info['name']}.")

    parts = [base]

    if history:
        parts.append("\nConversation so far:")
        for turn in history[-6:]:  # last 6 turns for context window
            role = "Player" if turn["role"] == "player" else npc_info["name"]
            parts.append(f"  {role}: {turn['text']}")

    parts.append(
        "\n\nRespond with ONLY valid JSON (no markdown, no backticks):\n"
        '{"reply": "<your in-character reply, max 2 sentences>"'
    )

    effect = npc_info.get("gameplay_effect", "none")
    if effect == "persuasion":
        parts.append(', "score": <int 0-100, how persuaded you are>')
    elif effect == "suspicion":
        parts.append(', "suspicion_delta": <float -0.1 to 0.3, how suspicious this makes you>')
    elif effect == "intel":
        parts.append(', "intel": "<a useful tip about the office, or null if they haven\'t earned it>"')

    parts.append("}")

    return "\n".join(parts)


async def score_npc_interaction(
    text: str,
    npc_key: str,
    npc_info: dict,
    level: int,
    ctx: dict | None = None,
    history: list[dict] | None = None,
) -> tuple[str, dict]:
    """Score an NPC interaction via Claude, with keyword fallback.

    Returns:
        (reply, effects) where effects is a dict with keys:
        persuasion_delta, suspicion_delta, intel, effect.
    """
    effect_type = npc_info.get("gameplay_effect", "none")
    ctx = ctx or {}
    history = history or []

    # Try Claude first
    try:
        from server.services.claude_service import _MODEL, _get_client

        client = _get_client()
        system = _build_system_prompt(npc_info, history)

        response = await client.messages.create(
            model=_MODEL,
            max_tokens=128,
            system=system,
            messages=[{"role": "user", "content": text}],
        )
        raw = response.content[0].text
        parsed = json.loads(raw)
        reply = str(parsed.get("reply", "..."))[:200]

        effects: dict = {
            "persuasion_delta": 0,
            "suspicion_delta": 0.0,
            "intel": None,
            "effect": effect_type,
        }

        if effect_type == "persuasion":
            effects["persuasion_delta"] = max(0, min(100, int(parsed.get("score", 0))))
        elif effect_type == "suspicion":
            delta = float(parsed.get("suspicion_delta", 0.0))
            # Inspector is extra suspicious if player is carrying
            if npc_key == "inspector" and ctx.get("carrying"):
                delta = max(delta, 0.15)
            effects["suspicion_delta"] = max(-0.1, min(0.3, delta))
        elif effect_type == "intel":
            effects["intel"] = parsed.get("intel")

        return reply, effects

    except Exception as exc:
        logger.debug("Claude NPC scoring failed (%s), using keyword fallback", exc)
        return _keyword_fallback(text, npc_key, npc_info, ctx, effect_type)


def _keyword_fallback(
    text: str,
    npc_key: str,
    npc_info: dict,
    ctx: dict,
    effect_type: str,
) -> tuple[str, dict]:
    """Keyword fallback when Claude is unavailable."""
    reply = _keyword_respond(npc_key, text, ctx)

    effects: dict = {
        "persuasion_delta": 0,
        "suspicion_delta": 0.0,
        "intel": None,
        "effect": effect_type,
    }

    if effect_type == "persuasion":
        effects["persuasion_delta"] = _keyword_score(text, npc_info)
    elif effect_type == "suspicion":
        if npc_key == "inspector" and ctx.get("carrying"):
            effects["suspicion_delta"] = 0.2
        elif npc_key == "boss" and ctx.get("shouted"):
            effects["suspicion_delta"] = 0.35
        else:
            effects["suspicion_delta"] = 0.0
    elif effect_type == "intel":
        # Dana gives intel on keyword match
        keywords = npc_info.get("keywords", [])
        text_lower = text.lower()
        hits = sum(1 for k in keywords if k in text_lower)
        if hits > 0:
            pool = npc_info.get("intel_pool", [])
            if pool:
                effects["intel"] = random.choice(pool)

    return reply, effects
