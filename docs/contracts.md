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

B exposes these from `ml/detector.py` (details and the server-side to-do list: `ml/README.md`):

```python
from ml.detector import predict, retrain, top_features, memo_rules, versions, replay_grid, warm

def predict(record, version=None, memo=None, history=(), model_version=None) -> Prediction:
    """
    record:  the InvoiceRecord above (dict or the pydantic object).
    version: the server's inspector version (only used to scale `suspicion`, below).
    history: this session's earlier records, oldest first (feeds the session features).
    Returns a Prediction that unpacks as (tells, suspicion), the way
    server/services/detector.py calls it, plus:
        .flagged      bool   the model's verdict at this level's FPR target   <- use this
        .score        float  calibrated P(fraud)
        .threshold    float
        .version      int    the model version that judged it
        .tells        [{"tell_type", "strength", "region", "features"}], strongest first
        .suspicion    float  scaled so the old rule (x (0.55 + 0.12*(v-1)), > 38) lands on .flagged
        .to_dict()
    """

def retrain(examples: list, force: bool = False) -> dict:
    """
    examples: game records of PAID player attacks (optionally with round_id, session_id,
              detector_version). Labels come from the payload check (mule accounts),
              not from a "label" field.
    force:    the demo override (POST /admin/retrain?force=true).
    Returns:
        {
            "new_version": int,          # the live version after this call
            "candidate_version": int, "promoted": bool, "forced": bool,
            "metrics": {
                "catch_rate": float,           # frozen scripted test set
                "false_positive_rate": float,  # frozen legit set
                "held_out_catch_rate": float   # held-out variants of the player's tricks
            },
            "learned": [str, ...],       # patch-note lines
            "examples": {...}, "guard": {...}, "gate": {...}
        }
    """

def top_features(version=None) -> list[str]   # the 2 features the memo rules are about
def memo_rules(version=None) -> list[str]     # the 2 real memo rules, as sentences
def versions() -> list[dict]                  # every saved version with metrics and thresholds
def replay_grid() -> dict                     # versions, batches, recall[i][j], n[i][j] (spec 2.4)
def warm() -> int                             # load or train v1; returns the live version
```

---

## 4. Office ↔ Computer postMessage Protocol

Direction and message types (unchanged from prototype):

| Direction | type | Payload | Meaning |
|-----------|------|---------|---------|
| Computer → Office | `hud` | `{level, money, heat, version, round, inspector, emoji, clerk, patches, shame}` | Update the HUD overlay (`patches`/`shame` feed the Game Menu leaderboard) |
| Computer → Office | `phase` | `{phase: "briefing" \| "forging"}` | Current game phase |
| Computer → Office | `print` | `{}` | Envelope dropped on outbox, start printing |
| Computer → Office | `verdict` | `{caught, line, payout, scheme, vendor, tells}` | Inspector's judgment (`tells`: top tell names, for the booth close-up) |
| Computer → Office | `stand` | `{}` | Player pressed the Stand up key (default Left Shift) on the computer |
| Office → Computer | `deliver` | `{}` | Envelope reached the IN tray |
| Office → Computer | `boss-near` | `{}` | Boss is behind the player's chair |
| Office → Computer | `heat` | `{amount}` | The boss caught you carrying the envelope; add heat |
| Computer → Office | `menu` | `{screen: "pause" \| "howto" \| "board"}` | Esc (or a menu button) on the computer: open the Game Menu, which the office page owns |
| Office → Computer | `paused` | `{on}` | The Game Menu opened/closed: freeze or resume the computer's timers |
| Office → Computer | `quit` | `{}` | Game Menu → Quit to Title: reset the computer to its title screen |
| Office → Computer | `tour` | `{}` | Game Menu → Tutorial: start the desk tutorial |

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

---

## 6. Realistic channel: email, bank-change requests, consent

From `docs/realistic-data-plan.md` sections 1–3. Everything here is additive: a client that sends none of the new fields gets today's behaviour.

### Sessions and consent

The browser makes a random session id once (`crypto.randomUUID()`), keeps it in `localStorage` (`forged.session.v1`), and sends it with every `/round/start`. Before round 1 it shows `ml.eventlog.CONSENT_TEXT` and keeps the answer in `localStorage` (`forged.consent.v1`, `"yes"` or `"no"`). The server stores both on the session.

### POST /round/start (new fields)

Request adds `consent` (bool, optional; default false) and `player` (display name, optional). Response adds:

```json
{
  "session_id": "uuid",
  "consent": true,
  "directory": [
    {
      "vendor_id": "petes", "name": "Pancake Pete's Flour Co.", "domain": "petesflour.com",
      "phone": "(510) 555-0142", "bank_last4": "3321", "bank_on_file_last4": "3321",
      "uses_po": true, "cadence_days": 14,
      "last_thread": {"thread_id": "<thread-petes@petesflour.com>", "message_id": "<petes-last@petesflour.com>",
                      "subject": "Invoice PP-0193", "from_name": "Pancake Pete's Flour Co. Billing",
                      "from_addr": "billing@petesflour.com", "sent_at": "2026-09-30T10:15:00"}
    }
  ],
  "pending_changes": [{"vendor_id": "petes", "new_account_last4": "7781", "changed_at": "..."}]
}
```

`directory` is `ml.mail.vendor_directory()` with `bank_on_file_last4` set from this session's vendor master. `pending_changes` lists the vendors whose account on file is one of the player's accounts because a change request went through (act 2 is open for them).

### The email composer (shared by /change-request and /submit)

```json
{
  "identity": "lookalike_domain",
  "from_name": "Pancake Pete's Billing",
  "local_part": "billing",
  "domain": "petesfl0ur.com",
  "reply_to": "",
  "cc": [],
  "reply_in_thread": false,
  "subject": "Invoice PP-0201",
  "body": "Please find this period's invoice attached.",
  "aged_domain": false
}
```

`identity` is one of `lookalike_domain`, `free_mail`, `spoofed_domain`, `compromised_mailbox` (an unlock), or `new_domain` (for a vendor that isn't on the approved list). `domain` is only read for `lookalike_domain`, `new_domain` and `free_mail` (gmail.com, outlook.com or yahoo.com). `reply_in_thread` replies into the vendor's `last_thread`. The server never trusts client values for SPF/DKIM/DMARC, domain age or first contact: `ml.mail.realize_email()` sets them.

### POST /change-request (act 1)

```json
{
  "round_id": "uuid",
  "vendor_id": "petes",
  "new_bank_account": "7781",
  "channel": "email",
  "email": { "...": "the composer above, when channel is email" },
  "phone_script": "Hi, this is Pete's accounts team ...",
  "phone_number_given": "(415) 555-0199"
}
```

The server realizes the email, builds a `VendorChangeRequest`, and calls `ml.changes.assess_change_request(request, level)`. When it's applied, the server appends `ml.changes.to_event(...)` to the session's change log and sets the vendor's account on file. It logs the attempt (`log_attempt(None, ..., verdict="APPLIED"|"BLOCKED", change_request=..., email=...)`). Response:

```json
{
  "request_id": "uuid", "applied": true, "callback": "number_from_request",
  "callback_result": "attacker_confirmed", "score": 0.42,
  "reason": "random callback check",
  "message": "AP called the number in your email. You picked up and confirmed the change.",
  "bank_on_file_last4": "7781"
}
```

`callback` is `none`, `number_on_file` or `number_from_request`; `callback_result` is `not_called`, `vendor_confirmed`, `vendor_denied` or `attacker_confirmed`.

### POST /submit (new fields)

Request adds `email` (the composer, optional) and `player`. Record `scheme` may be `bank_change` (act 2: the vendor's own untouched invoice, paying the account now on file). The server passes the realized email and the session's change log to `predict(record, ..., email=, bank_changes=)`, takes the verdict from `prediction.flagged` (no random noise), logs every submit and every rejection with `log_attempt`, and queues PAID player attacks for a real `retrain()`. Response adds `score`, `threshold`, `model_version` and `heat`, and `top_tells` can include the new tell names:

| tell | meaning |
| --- | --- |
| `reply_to` | replies go to another domain |
| `free_mail` | sent from a free mailbox |
| `display_spoof` | a vendor's name on someone else's address |
| `lookalike_cc` | a CC a letter or two off a vendor's domain |
| `auth_fail` | fails SPF or DMARC |
| `new_domain` | the sending domain was registered recently |
| `first_contact` | first email from this address |
| `new_thread` | starts a new thread instead of replying |
| `recent_bank_change` | pays into an account changed recently, or changed without a callback |

`region` is `"email"` for the email tells and `"bank"` for `recent_bank_change`.

### GET /metrics

Served from `ml.detector.versions()`: one row per promoted version, `catch_rate` = frozen-set recall, `false_positive_rate` = frozen-set FPR, `held_out_catch_rate` = trick recall (0 for v1).

### ML calls the server makes (B's side)

```python
from ml.detector import predict, retrain, versions
from ml.changes import assess_change_request, to_event
from ml.mail import realize_email, vendor_directory
from ml.eventlog import log_attempt, CONSENT_TEXT
from ml.schema import VendorChangeRequest, BankChangeEvent, EmailMessage

predict(record, version, memo, history=(), *, email: dict | None = None, bank_changes: list[dict] = ())
retrain(records)  # each record may carry "email", "bank_changes", "features", "session_id", "round_id", "verdict"
realize_email(identity, vendor_id_or_None, *, from_name, subject, body, sent_at, local_part, domain, reply_to, cc,
              thread_id, in_reply_to, aged_domain, vendor_name=None)  # vendor_id None: a vendor not on the list
log_attempt(record_or_None, prediction_or_None, *, verdict, session_id, round_id, consent, email=None,
            change_request=None, bank_changes=None, persuasion=None, perks=(), noise=None, stream=None)
```

---

## 7. Defender mode (role swap)

From `docs/superpowers/specs/2026-10-24-defender-mode-design.md`. The player works the AP desk: an inbox of 8 invoices to PAY or FLAG, with 2 callbacks per shift, and after each decision a reveal of the truth and the inspector's call. Nothing is logged.

### POST /defend/shift

Request: `{"seed": 1}`. `seed` is optional; leave it out for a random shift. The same seed and detector version always give the same shift. Built by `ml.defender.build_shift(seed)` and scored by the live detector at Sunny Diner's threshold, with memory off. It's registered only on the real app; in stub mode the computer falls back to the bundled `prototype/defend-shifts.json` (`python -m ml.defender --export prototype/defend-shifts.json`).

Response (abridged):

```json
{
  "shift_id": "shift-1", "seed": 1, "level": 1, "callbacks": 2,
  "inspector": {"version": 2, "threshold": 0.2994},
  "approval_limit": 2500.0,
  "paid_before": [{"invoice_id": "PP-0119", "vendor_name": "Pancake Pete's Flour Co.", "vendor_id": "petes",
                   "amount": 1234.0, "issue_date": "2026-10-03"}],
  "items": [{
    "id": "shift-1-3",
    "email": {"from_name": "…", "from_addr": "billing@petesfl0ur.com", "reply_to": null, "cc": [], "subject": "…",
              "body": "…", "sent_at": "2026-10-14T10:05:00", "in_thread": false, "spf": "pass", "dkim": "pass",
              "dmarc": "pass", "domain_age_days": 12, "first_time_sender": true},
    "invoice": {"invoice_id": "PP-0231", "vendor_name": "Pancake Pete's Flour Co.", "vendor_id": "petes",
                "issue_date": "2026-10-14", "due_date": "2026-11-13", "order_number": "PO-4012",
                "bank_account": "7781", "sender_domain": "petesfl0ur.com", "letterhead": "vendor",
                "line_items": [{"description": "Flour, 50lb sack", "quantity": 12, "unit_price": 62.0}],
                "amount": 1262.0, "stamps": ["RECEIVED"],
                "paper": {"taped": ["bank"], "whiteout": [], "stains": {"items": 0.35}, "copies": 1}},
    "case": {"vendors": [{"vendor_id": "petes", "name": "…", "domain": "petesflour.com", "bank_on_file": "3321",
                          "phone": "(510) 555-0142", "usual_amount": 1230.0, "cadence_days": 14, "uses_po": true}],
             "open_orders": [{"order_number": "PO-4012", "vendor_id": "petes", "amount": 1120.0}],
             "bank_changes": [{"vendor_id": "…", "old_account": "…", "new_account": "…", "changed_at": "…",
                               "channel": "email", "verified": false, "offered_phone": true}]},
    "callback": {"who": "Pancake Pete's Flour Co. · (510) 555-0142",
                 "says": "That's not our account. We're still at the one ending 3321."},
    "truth": {"fraud": true, "scheme": "bank_switcheroo", "scheme_name": "Bank switcheroo",
              "schemes": ["bank_switcheroo"], "why": "The account ending 7781 is a mule account, not …'s."},
    "verdict": {"flagged": true, "score": 0.72,
                "reasons": [{"feature": "bank_changed", "text": "bank details that don't match the vendor on file",
                             "region": "bank"}]}
  }]
}
```

- `case` is the case file as it stood before that item, so a bank change made during the shift shows up from the next invoice on. The computer adds the invoices the player paid this shift to `paid_before` itself.
- `letterhead` is `vendor` (matches the file), `generic`, or `other` (a redesign, or a vendor not on file).
- `paper.whiteout` and `paper.taped` name fields (`items`, `amount`, `issue_date`, `invoice_id`, `bank`); `paper.stains` is keyed by region.
- `callback.who` is the vendor's number on file, or the owner (`ml.defender.OWNER`) for a vendor not on file.
- `reasons` are the top 3 pushes toward FLAGGED in plain words, with the tell's region (`header`, `meta`, `items`, `bank`, `footer`, `email`, or null). They're there whether or not the inspector flagged the invoice.
- The truth and the callback are in the payload, so the reveal works offline. That's fine for a single-player mode.
