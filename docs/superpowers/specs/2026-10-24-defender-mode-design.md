# Defender mode (role swap): design

Written Sat Oct 24. This is the design doc's "Role swap (stretch)" mode, listed as post-hackathon in `docs/realistic-data-plan.md`: the player works the AP desk and sorts real invoices from fakes, against the same detector the forger plays against.

## What it is in one paragraph

"🛡 Defend the desk" on the title screen opens an AP inbox of 8 invoices. Each one arrives with the email it came in. The player reads the email, the paper invoice and the case file as it stood when the invoice arrived, then decides **PAY** or **FLAG**. Twice per shift they can **call back** to check with someone they trust. After each decision the reveal shows the truth, what the inspector decided and why. The end of a shift compares the player with the inspector on the same 8 invoices.

## Decisions made

- **No points or money.** The reveal teaches; the only tally is a comparison with the inspector: frauds caught and real vendors held.
- **No data collection.** Nothing is logged for now. Shifts are deterministic per seed, so logging later is one row per decision: seed, item index, decision, callback used, detector version.
- **Fakes come from the scripted attackers** (`ml/generate.py`), not from logged player attempts.
- **Computer screen only.** No 3D office changes. It runs in standalone `os.html` and on the office computer.
- **Sunny Diner only**, the one level `ml/world.py` models.

## How a shift plays

1. **Inbox.** 8 emails listed by sender, subject and amount. Opening one shows:
   - **The email:** From name and address, Reply-To, CC, subject, date, body, and a thread marker (a reply in the vendor's thread, or a new thread). A **Show headers** toggle adds what a mail server would add: SPF, DKIM and DMARC results, the sender domain's age, and a first-time-sender banner ("You don't often get email from…").
   - **The invoice paper:** vendor, letterhead (the vendor's own or a generic one), invoice number, PO number, issue and due dates, line items, total, the bank account, stamps, and paper traces (tape, whiteout, stains, photocopy generation), drawn the way the forger's desk draws them.
   - **The case file, as it stood before this invoice:**
     - the vendor master (name, domain, bank and phone on file, usual amount, cadence)
     - open POs
     - the bank-change log (date, old and new account, channel, whether a callback confirmed it)
     - recently paid invoices: the ones paid before the shift, plus the ones the player paid earlier in this shift
2. **Decide.** PAY or FLAG. Each decision is final.
3. **Callback (2 per shift, used before deciding).** It calls the number on file for a known vendor, or the owner's office for a vendor not on file. The reply comes from the truth:

   | Truth | Who answers | What they say |
   | --- | --- | --- |
   | Legit, known vendor | the vendor | "Yes, PP-0123 for $1,234.00 is ours." Plus "We moved banks recently, our new account ends 5512" when the paper's account differs from the file. |
   | Legit, vendor not on file | the owner's office | "Yes, we just started working with them. Go ahead." |
   | `bank_switcheroo` | the vendor | "That's not our account. We're still at the one ending 3321." |
   | `bank_change_fraud` | the vendor | "We never asked to change our bank details! Our account ends 3321." |
   | `duplicate_dance` | the vendor | "That's a copy of PP-0119 from Oct 3, which you already paid." |
   | `padded_invoice` | the vendor | "Our invoice for PO-4012 was $1,120.00, not $1,370.00." |
   | `phantom_supplier` | the owner's office | "Never heard of them. Don't pay it." |
   | `boss_request` | the owner's office | "I never asked for that payment. Don't pay it." |

   An invoice with several payloads answers for the first in this order: `bank_change_fraud`, `bank_switcheroo`, `boss_request`, `phantom_supplier`, `duplicate_dance`, `padded_invoice`.
4. **Reveal**, right after each decision:
   - **The truth:** REAL or FRAUD, the scheme's name, and one line on what gave it away in the world (for example "the account ending 7781 is a mule account").
   - **The inspector's call:** FLAGGED or PAID, its P(fraud) against the threshold, and its top three reasons in plain words.
   - **Highlights:** the reasons' regions (header, meta, items, bank, footer, email) are outlined on the paper and the email.
5. **End of shift.** A side-by-side tally of you and Inspector vN: frauds caught out of the total, real vendors held, and callbacks used. Below it is the 8-row table: your call, the inspector's call, and the truth. Then **Next shift** or **Back to title**.

## Pieces

### `ml/defender.py` (B)

- **`build_shift(seed, size=8) -> dict`.** Simulates runs with `generate.simulate(seed, i, attack_rate=0.4, snapshots=True)` for i = 0, 1, … and takes the first window of `size` consecutive rows with 2–4 frauds from at least 2 schemes. It's deterministic given the seed and the live detector.
- **Scoring.** Each item is scored with the live detector at Sunny Diner's threshold, memory off, as `predict()` does for level 1. Reasons are the top three positive contributions, phrased with `explain.phrase(name, value)`. Passing the feature's own value fills in the numbers, as in "invoices due within 7 days". Each reason also carries its tell's region from `explain.TELLS`.
- **Truth and callbacks** come from `payload_schemes` against the snapshot and the run's `Truth`.
- **`python -m ml.defender --export prototype/defend-shifts.json --shifts 5`** writes seeds 1–5 for offline play.
- **Paper traces.** `Invoice.tool_uses` is turned into the prototype's paper fields: taped and whited-out fields, stain strength per region, photocopy count.

### `ml/generate.py` (one opt-in hook)

- `simulate(..., snapshots=False)`. When it's on, `_submit` stores a deep copy of the case file just before computing each invoice's features, so a snapshot is the case file "as it stood before this invoice".
- The hook makes no RNG draws, so every dataset, `ml.checks` result and saved model stays the same.

### Server (A's files)

- `server/routes/defend.py`: `POST /defend/shift {"seed": int | null}` returns `build_shift(seed)`. A null seed picks a random one. It's registered in `main.py` for the non-stub app.
- In stub mode the route is absent, and the client uses the bundled file.
- `docs/contracts.md` gets a section for the endpoint and the payload below.

### Computer UI (C's files)

- `os.html`:
  - a `🛡 Defend the desk` button on the title screen
  - a `#screen-defend` section
  - `defend.js` and `defend.css` loaded after `game.js`, reusing its helpers (`$`, `show`, `toast`, `sfx`, `api`)
- `game.js` is not edited.
- **Shift source.** With `?api=`, `POST /defend/shift`. Without it, or when the call fails, the bundled `defend-shifts.json`, cycling through its shifts.
- **Layout on the 1600×900 stage:**
  - top bar: shift number, Inspector vN, callbacks left, Back to title
  - inbox on the left
  - email and paper in the middle
  - case file tabs and the PAY / FLAG / ☎ Call bar on the right, with the reveal card under the bar

## Shift payload

```json
{
  "shift_id": "shift-1", "seed": 1, "level": 1,
  "inspector": {"version": 2, "threshold": 0.31},
  "approval_limit": 2500.0,
  "paid_before": [{"invoice_id": "PP-0119", "vendor_name": "…", "amount": 1234.0, "issue_date": "2026-10-03"}],
  "items": [{
    "id": "shift-1-3",
    "email": {"from_name": "…", "from_addr": "…", "reply_to": null, "cc": [], "subject": "…", "body": "…",
              "sent_at": "…", "in_thread": true, "spf": "pass", "dkim": "pass", "dmarc": "pass",
              "domain_age_days": 4800, "first_time_sender": false},
    "invoice": {"invoice_id": "…", "vendor_name": "…", "vendor_id": "petes", "issue_date": "…", "due_date": "…",
                "order_number": "PO-4012", "bank_account": "7781", "sender_domain": "…",
                "letterhead": "vendor | generic | own", "line_items": [{"description": "…", "quantity": 8, "unit_price": 62.0}],
                "amount": 1370.0, "stamps": ["RECEIVED"],
                "paper": {"taped": ["bank"], "whiteout": [], "stains": {"items": 0.35}, "copies": 1}},
    "case": {"vendors": [{"vendor_id": "petes", "name": "…", "domain": "…", "bank_on_file": "3321", "phone": "…",
                          "usual_amount": 1230.0, "cadence_days": 14, "uses_po": true}],
             "open_orders": [{"order_number": "PO-4012", "vendor_id": "petes", "amount": 1120.0}],
             "bank_changes": [{"vendor_id": "…", "old_account": "…", "new_account": "…", "changed_at": "…",
                               "channel": "email", "verified": false, "offered_phone": true}]},
    "callback": {"who": "Pancake Pete's Flour Co. · (510) 555-0142", "says": "…"},
    "truth": {"fraud": true, "scheme": "bank_switcheroo", "scheme_name": "Bank switcheroo", "why": "…"},
    "verdict": {"flagged": true, "score": 0.62,
                "reasons": [{"feature": "bank_changed", "text": "bank details that don't match the vendor on file",
                             "region": "bank"}]}
  }]
}
```

The truth and the callback reply are in the payload, so a player with devtools can read them. That's fine for a single-player teaching mode, and it's what lets the offline file work.

## Testing

`ml/tests/test_defender.py` checks:
- the same seed gives the same shift
- there are `size` items with 2–4 frauds from at least 2 schemes
- every item's truth matches `payload_schemes` on its snapshot
- a `bank_change_fraud` item's snapshot has its change in the log, and its bank on file equals the invoice's account
- each scheme's callback line names the right fact (the account on file, the paid invoice, the real PO amount)
- reasons have regions, and the payload round-trips through `json.dumps`
- `simulate(snapshots=True)` gives the same rows as `snapshots=False`

The whole `ml` suite and `ml.checks` must still pass. The UI is checked in the browser pane against the server and against the offline file: a full shift, both callbacks, the reveal highlights, and the end-of-shift tally.

## Out of scope

- Logging decisions or exporting them (see "Decisions made").
- Change requests as inbox items (deciding act 1 yourself). The change log shows them instead.
- Other levels, a leaderboard, and 3D-office scenes.
