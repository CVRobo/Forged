# Handoff: realistic data (branch `b/realistic-data`)

This picks up from `docs/realistic-data-plan.md`. The branch starts from `b/ml-generator`, which has steps 1–8 of the ML spec plus the server fixes. The design workflow was stopped on purpose, because the plan already settles the design.

## Done on this branch

| Plan item | What exists | Where |
| --- | --- | --- |
| 1. Event log | `log_attempt()`: one row per attempt with the model's version, score, threshold, flag, features and payload labels. Without consent every typed field is blanked. Rows go to `attempts.jsonl`, plus an optional Redis stream that can never block a verdict. `read_attempts()` reads them back. | `ml/eventlog.py`, `ml/tests/test_eventlog.py` |
| 2–3. Shared formats | `EmailMessage` (world-set SPF/DKIM/DMARC, domain age, first contact, `sender_identity`), `VendorChangeRequest`, `BankChangeEvent` (vendor-master change log), `Invoice.email`, `CaseFile.bank_changes`, `VendorProfile.phone` | `ml/schema.py` |
| 2. Email channel, world side | `realize_email(identity, vendor_id, ...)` fills in what a mail server would see for the 5 identities (see the table in the module docstring). `vendor_directory()` gives the case file with the number on file and each vendor's last real thread. | `ml/mail.py`, `ml/tests/test_mail.py` |
| 3. Callback, world side | `assess_change_request(request, level)` applies the callback policy: Sunny Diner calls back at random, later levels call the number on file when the request looks suspicious. `apply_decision()` gives the outcomes (number on file exposes a mule account; a number from the request reaches the attacker; no callback lets it through). `to_event()` makes the change-log row. `suspicion()` is a **hand-written stand-in** for a trained model. | `ml/changes.py` |
| Vendors | Phone numbers and domain ages on all 6 vendors | `ml/world.py` |

203 tests pass, and `ml.checks` still passes (v1 64.1% recall at 4.3% FPR).

## Not done yet (in plan order)

**ML (`ml/`)**
1. **Email features** in `compute_features`, read from `invoice.email`: `reply_to_mismatch`, `from_domain_known`, `free_mail_sender`, display-name spoof, `cc_lookalike`, `dmarc_fail`, `spf_fail`, `log_domain_age`, `first_time_sender`, `new_thread_for_payment`. Neutral values when there's no email.
2. **Change-history features**, read from `case_file.bank_changes`: `days_since_bank_change`, `bank_change_via_email`, `bank_change_verified`, `change_request_offered_phone`, and a payment into an account changed less than N days ago.
3. **New payload label `bank_change_fraud`:** a known vendor whose account *on file* is now a mule account, because a change request was applied. The paying invoice inherits the label. It needs a rule in `payload_schemes` alongside `bank_switcheroo`.
4. **Generator:**
   - legit emails for every legit invoice, at the plan's base rates: billing Reply-To about 10%, free mail about 8%, new contact about 10%, new domain about 5%
   - legit change requests in about 3% of vendor-months
   - a two-act attacker: a change request, then an ordinary invoice one or more rounds later
   - sender-identity levers in `attackers.py`
5. **Then:** add the new names to `BASE_FEATURES`, refit `memory_scale.json` (`python -m ml.memory --fit`), and keep `ml.checks` passing on seeds 1–12. Every new tell needs a legit base rate above 5%.
6. **A trained change-request model** to replace `changes.suspicion()`.
7. **`detector.predict(..., email=, bank_changes=)`**, and `retrain()` accepting those fields.
8. **`ml/export.py`:** `attempts.jsonl` (consented rows only), one RFC 5322 `.eml` per email, UBL-style invoice JSON, and `DATACARD.md` (fields, label rules, known artifacts, consent wording from `eventlog.CONSENT_TEXT`, license).

**Server (`server/`)**
- `/round/start` takes `session_id` and `consent`, and returns `vendor_directory()`.
- New `POST /change-request`: realize the email, run `assess_change_request`, keep the session's vendor master and change log in Redis, and log the attempt with verdict `APPLIED` or `BLOCKED`.
- `/submit` takes an `email`, passes the session's `bank_changes` to `predict`, calls `log_attempt` on every submit and rejection, takes the verdict from `prediction.flagged` (no noise), runs a real `retrain()`, and serves `/metrics` from `versions()`.

**Computer UI (`prototype/`)**
- A consent screen (`eventlog.CONSENT_TEXT`) and a session id in localStorage.
- An email composer that replaces the cover email: sender-identity picker (compromised mailbox as an unlock), From name and local part, Reply-To, CC, reply-in-thread or new thread, subject, body.
- An act-1 screen for the change request (email or phone script, plus an optional "verify at" number) and a callback-outcome toast. In act 2 the vendor's invoice pays the new account with no tape.

## Commands

```bash
ml/.venv/bin/python -m pytest ml        # about 21 s
ml/.venv/bin/python -m ml.checks        # the spec gate
ml/.venv/bin/python -m ml.demo          # the core sequence
```

The core demo must keep working: a trick is PAID, a retrain runs, variants are FLAGGED.
