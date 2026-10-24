# Forged: Contracts

Agreed interfaces between all four roles. **Do not change these without notifying the team.**

---

## 1. API Endpoints

Base URL: `http://localhost:8000` (dev) / TBD (prod)

All endpoints accept and return JSON. Errors return `{"error": "message"}` with an appropriate HTTP status.

### POST /round/start

Start a new round.

**Request:**
```json
{
  "level": 1,
  "session_id": "optional-session-uuid"
}
```

**Response:**
```json
{
  "round_id": "uuid-string",
  "memo": [
    { "text": "Alert: wire transfers over $5,000", "real": true },
    { "text": "Flag anything from a .biz domain", "real": true },
    { "text": "Double-check invoices with round totals", "real": false }
  ],
  "inspector_version": 3,
  "case_file": {
    "company": "Sunny Diner Supply",
    "vendors": [
      {
        "name": "Pancake Pete's Batter Co.",
        "domain": "pancakepetes.com",
        "bank": "7721",
        "usual_amount": [800, 2500],
        "icon": "🥞",
        "items": [["Buttermilk mix (50 lb)", 4, 89], ["Maple syrup (gal)", 10, 34]]
      }
    ],
    "approvers": [["Dana Kim", "Manager"], ["Ravi Patel", "CFO"]],
    "notes": ["Pays vendors on the 1st and 15th", "PO numbers start with SD-"]
  }
}
```

Note: `memo[].real` is included in the response but the frontend should NOT reveal it directly. The player deduces which rule is the decoy.

### POST /clerk

Send a message to the clerk NPC.

**Request:**
```json
{
  "round_id": "uuid-string",
  "text": "Hey, quick question about this invoice..."
}
```

**Response:**
```json
{
  "reply": "Oh sure, lemme look at that after lunch.",
  "persuasion_score": 62
}
```

### POST /clerk/voice

Send a voice message to the clerk NPC. Uses Deepgram STT to transcribe, runs through clerk logic, then Deepgram TTS for the reply audio.

**Request:**
```json
{
  "round_id": "uuid-string",
  "audio_b64": "base64-encoded-webm-opus-audio"
}
```

**Response:**
```json
{
  "transcript": "Hey, quick question about this invoice...",
  "reply": "Oh sure, lemme look at that after lunch.",
  "persuasion_score": 62,
  "reply_audio_b64": "base64-encoded-mp3-audio-or-null"
}
```

Notes:
- Audio from browser should be webm/opus (MediaRecorder default)
- `reply_audio_b64` is mp3, or null if TTS is unavailable / stub mode
- Falls back to text-only in stub mode (transcript is canned, no audio returned)

### POST /submit

Submit a forged invoice for inspection.

**Request:**
```json
{
  "round_id": "uuid-string",
  "record": {
    "level": 1,
    "scheme": "changed_bank",
    "vendor": "Pancake Pete's Batter Co.",
    "amount": 1847.50,
    "bank_account": "9999",
    "sender_domain": "pancakepetes.com",
    "invoice_no": "INV-20241023",
    "po_number": "SD-4412",
    "date": "Fri, Oct 23",
    "line_items": ["Buttermilk mix (50 lb) x4 @89", "Maple syrup (gal) x10 @34"],
    "field_altered": ["bank"],
    "legibility": { "header": 1.0, "meta": 1.0, "items": 0.7, "bank": 0.4, "footer": 1.0 },
    "scan_quality": 0.9,
    "copy_generation": 1,
    "stamp_type": ["APPROVED"],
    "stamp_position": [[120, 80]],
    "domain_mismatch": false,
    "letterhead_match": true,
    "cover_email": "Quick payment for the usual order, thanks!",
    "heat": 12
  }
}
```

**Response:**
```json
{
  "verdict": "PAID",
  "top_tells": [
    { "tell_type": "bank_changed", "strength": 18.2, "region": "bank" },
    { "tell_type": "amount_unusual", "strength": 6.1, "region": "meta" }
  ],
  "inspector_line": "Looks fine to me! *stamps without looking up*",
  "payout": 1478,
  "new_version": 3
}
```

### GET /patch-notes?since=v

**Response:**
```json
[
  {
    "version": 3,
    "learned": ["bank account changes on known vendors", "photocopied invoices with low legibility"],
    "invoices_trained_on": 57
  }
]
```

### GET /metrics

**Response:**
```json
[
  { "version": 1, "catch_rate": 0.35, "false_positive_rate": 0.08, "held_out_catch_rate": 0.30 },
  { "version": 2, "catch_rate": 0.52, "false_positive_rate": 0.10, "held_out_catch_rate": 0.45 },
  { "version": 3, "catch_rate": 0.64, "false_positive_rate": 0.11, "held_out_catch_rate": 0.58 }
]
```

### GET /leaderboard

**Response:**
```json
[
  { "player": "Alice", "money": 12400, "patches_caused": 3 },
  { "player": "Bob", "money": 8200, "patches_caused": 1 }
]
```

---

## 2. Invoice Record Schema

The canonical shape of a submitted invoice. B uses this for training, A stores it in Redis, C sends it from the frontend.

| Field | Type | Source |
|-------|------|--------|
| level | int (1-4) | Round state |
| scheme | string | Player choice: `changed_bank`, `duplicate`, `phantom`, `boss_request` |
| vendor | string | Vendor name (may be spoofed for phantom scheme) |
| amount | float | Total invoice amount |
| bank_account | string | 4-digit bank code (attacker changes this) |
| sender_domain | string | Email domain on the invoice |
| invoice_no | string | Invoice number |
| po_number | string | Purchase order number |
| date | string | Invoice date |
| line_items | list[string] | Formatted line items |
| field_altered | list[string] | Fields the player whited out and edited |
| legibility | dict[str, float] | Per-region visibility (0-1): header, meta, items, bank, footer |
| scan_quality | float | 0-1, degrades with copies |
| copy_generation | int | Number of times photocopied (0-3) |
| stamp_type | list[string] | Stamps applied: APPROVED, PAID, URGENT |
| stamp_position | list[list[int]] | [[x,y], ...] positions of stamps |
| domain_mismatch | bool | Does the sender domain mismatch the vendor? |
| letterhead_match | bool | Does the letterhead match the vendor? |
| cover_email | string | Player's cover note to the clerk |
| heat | int | Current heat level (0-100) |

---

## 3. ML Interface (A ↔ B)

B exposes two functions from `ml/detector.py`:

```python
def predict(record: dict) -> dict:
    """
    Args:
        record: Invoice record matching the schema above.
    Returns:
        {
            "tells": [{"tell_type": str, "strength": float, "region": str | None}, ...],
            "suspicion": float,  # raw score before modifiers
            "top_features": [str, str]  # names of the two strongest features
        }
    """

def retrain(examples: list[dict]) -> dict:
    """
    Args:
        examples: List of invoice records with a "label" field added
                  ("fraud" or "legitimate").
    Returns:
        {
            "new_version": int,
            "metrics": {
                "catch_rate": float,
                "false_positive_rate": float,
                "held_out_catch_rate": float
            },
            "learned": [str, ...]  # human-readable descriptions of new patterns
        }
    """

def top_features(version: int | None = None) -> list[str]:
    """
    Returns the top 2 feature names for the given version (or current).
    Used to generate the real memo rules.
    """
```

---

## 4. Office ↔ Computer postMessage Protocol

Direction and message types (unchanged from prototype):

| Direction | type | Payload | Meaning |
|-----------|------|---------|---------|
| Computer → Office | `hud` | `{level, money, heat, version, round, inspector, emoji, clerk}` | Update the HUD overlay |
| Computer → Office | `phase` | `{phase: "briefing" \| "forging"}` | Current game phase |
| Computer → Office | `print` | `{}` | Envelope dropped on outbox, start printing |
| Computer → Office | `verdict` | `{caught, line, payout, scheme, vendor}` | Inspector's judgment |
| Computer → Office | `stand` | `{}` | Player pressed Esc on the computer |
| Office → Computer | `deliver` | `{}` | Envelope reached the IN tray |
| Office → Computer | `boss-near` | `{}` | Boss is behind the player's chair |

**Rules:**
- All messages include `src: "forged-os"` (from computer) or `src: "forged-world"` (from office)
- C and D agree on any new message type before adding it
- Add new messages to this document and notify the team

---

## 5. Ownership

| Directory / File | Owner | Others ask before editing |
|-----------------|-------|--------------------------|
| `server/`, `content/` | A | |
| `ml/` | B | |
| `frontend/src/app/os/`, game components | C | |
| `frontend/src/app/page.tsx`, 3D office components | D | |
| `frontend/lib/api.ts` | A (C uses it) | |
| `docs/contracts.md` | Everyone (changes need team sign-off) | |
