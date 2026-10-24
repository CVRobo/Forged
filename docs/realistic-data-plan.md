# Forged: making the data realistic (plan to Sunday morning)

Written Sat Oct 24, 2:20 AM. Submissions are due Sunday morning, about 30 hours from now.

## The goal in one paragraph

Today Forged's data describes how players beat our detector in a cartoon world: paper tools, game-defined labels, and nothing kept in a reusable form. By Sunday it should record the attack real accounts-payable teams actually lose money to:
- an email that gets the vendor's bank details changed,
- often from a compromised or lookalike sender,
- followed by an ordinary-looking invoice,
- stopped (or not) by a callback to the number on file.

Every attempt gets logged with consent in a format someone else can use. The paper tools stay as game flavor but are left out of the exported data.

**Honest claim for the pitch:** "Forged collects human-written vendor-impersonation attacks (email, bank-change request, invoice) against a detector and a callback policy, with labels players can't poison. It's simulated, not real fraud data, but it's in the real medium and real formats." The data card says the same.

## What we build (in priority order)

| # | Piece | Why it matters | Owner | Hours |
|---|---|---|---|---|
| 1 | **Event log, consent and export** | Without it nothing survives. One reproducible row per attempt. | B (ml/), A (server), C (consent screen) | 4 |
| 2 | **Email channel with simulated headers** | The real medium. Pretext text plus header signals email-security tools use. | B (schema, features, generator), C (composer UI), A (route) | 10 |
| 3 | **Bank-change request as act 1, plus the callback** | The most common real attack, and the real control. | B (payloads, generator, features), A (round flow), C (UI) | 8 |
| 4 | **Policy-driven inspector (AP-agent lite)** | The memo becomes the inspector's actual written policy, and its actions (approve, hold, call back) become labels. | B + A | 4 (stretch) |
| — | Defender-role mode, PDF forensics, real legit data, deepfake voice | Post-hackathon. | — | — |

**Cut line, in this order if behind:** 4, then the CC and thread fields of 2, then the phone channel of 3. **Never cut:** 1, and the core demo (a trick gets PAID, a retrain runs, variants get FLAGGED).

## 1. Event log, consent and export

**Consent screen (C).** Shown before round 1 and stored with the session:

> Everything here is fictional. Don't type real names, companies, emails or account numbers. Your emails, chat and moves are saved under a random ID, used to train this game's inspector, and may be released publicly for research.

**Session id (C, A).** A random id is generated in the browser and sent with `/round/start` and `/submit`. The leaderboard is keyed by display name, not vendor.

**One row per attempt (B helper, A calls it).** `ml.eventlog.log_attempt(...)` appends to `ml/models/attempts.jsonl` and, when Redis is up, to a Redis stream with no TTL. Each row holds:
- session id, round id, timestamps, consent flag
- the raw record, the email and the change request, the defender's actions
- the model's version, score, threshold, flagged and features
- the payload schemes (the label set) and the scheme the player declared
- the final verdict, persuasion, perks, and the server's noise draw if it still uses one
- rejected attempts as `REJECTED` rows

**Export (B).** `python -m ml.export` writes:
- `attempts.jsonl`
- each email as an RFC 5322 `.eml` file
- invoices as UBL-style JSON
- a `DATACARD.md` covering fields, label rules, known artifacts, consent wording and license

## 2. Email channel

### Data model (new, in `ml/schema.py`)

```python
class EmailMessage(BaseModel):
    message_id: str
    thread_id: str | None            # set when replying into an existing vendor thread
    in_reply_to: str | None
    from_name: str                   # display name
    from_addr: str                   # e.g. billing@petesflour.com
    reply_to: str | None
    cc: list[str] = []
    subject: str
    body: str
    sent_at: datetime
    # simulated by the game world, never typed by the player:
    spf: Literal["pass", "fail", "none"]
    dkim: Literal["pass", "fail", "none"]
    dmarc: Literal["pass", "fail", "none"]
    sender_domain_age_days: int
    first_time_sender: bool          # first mail from this address to the company
```

### What the player chooses (C's composer)

**Sender identity**, each with a cost or an unlock:

| Identity | From address | Email checks | Domain age | Notes |
|---|---|---|---|---|
| Lookalike domain | `petesfl0ur.com` | pass (the attacker owns it) | days | |
| Free mail | `petes.flour@gmail.com` | pass | old | free-mail domain |
| Spoofed real domain | the real domain | DMARC fails | | |
| Compromised vendor mailbox | the real address | all pass | | an unlock, the hard case for detectors |

**Other fields:**
- Reply-To: optional, can point at a lookalike.
- CC: optional lookalike.
- Thread: reply into the vendor's last real thread, or start a new one.
- Subject and body are free text, and the clerk chat moves into this composer.

### New features (in `ml/features.py`)

- `reply_to_mismatch`: Reply-To domain differs from the From domain
- `from_domain_known`: From domain is the vendor's domain on file
- `free_mail_sender`
- `display_name_matches_vendor` while the address doesn't
- `cc_lookalike`: a CC domain is 1–2 edits from a known vendor domain
- `dmarc_fail`, `spf_fail`
- `log_domain_age`
- `first_time_sender`
- `new_thread_for_payment`: a payment request that starts a new thread instead of replying

### Legit base rates (generator, spec 2.1 style: every tell above the 5% FPR target)

Each of these is a real thing legit vendors do:
- **Billing addresses:** they send from a billing address with a different Reply-To (`billing@` replies to `ar@`, about 10%).
- **Free mail:** small vendors use Gmail (about 8%).
- **Invoicing platforms:** invoices come through platforms that pass DMARC on the platform's domain (already modeled as `billing_domain`).
- **New contacts:** a new accounts person writes for the first time (about 10%).
- **New domains:** a recently registered domain after a rebrand (about 5%).

Legit emails come from the same template pool as attacks (`ml/text.py`), so text can't separate the classes by authorship.

## 3. Bank-change request (act 1) and the callback

### Flow (A's round logic)

1. **Act 1.** The player sends a change request for a known vendor. The channel is email (with an EmailMessage), phone script (text), or vendor portal. The request asks to move payments to an account.
2. **The AP desk decides** whether to update the vendor master. The policy and the model decide whether it calls back, and which number it uses: the number on file, or a number written in the email.
   - A callback to the **number on file** reaches the real vendor and exposes the attack.
   - A callback to a **number in the email** reaches the attacker, and the change goes through.
   - **No callback:** the change goes through, with risk shown as heat.
3. **Act 2, one or more rounds later.** An ordinary invoice from that vendor gets paid into the new account, with no tape and no altered paper.

### Data model

```python
class VendorChangeRequest(BaseModel):
    request_id: str
    vendor_id: str
    new_bank_account: str
    channel: Literal["email", "phone", "portal"]
    email: EmailMessage | None
    phone_number_given: str | None   # a number offered for "verification"
    requested_at: datetime
    callback: Literal["none", "number_on_file", "number_from_request"]
    callback_result: Literal["not_called", "vendor_denied", "attacker_confirmed"]
    applied: bool                    # did the vendor master change?
```

### Payloads, labels and features

- **New label `bank_change_fraud`:** a change request whose new account is a mule account. The invoice that later pays it inherits the label. Legit vendors also send real change requests (about 3% of vendor-months), so "a change request happened" is not the label.
- **New features:**
  - `days_since_bank_change` and `bank_change_via_email`
  - `bank_change_verified`: callback to the number on file
  - `change_request_offered_phone`
  - the email features from section 2, on the request
  - a payment into an account changed less than N days ago

**Callback mechanic.** Sunny Diner calls back at a set rate. Later levels call back on suspicion: the model's score on the request plus the policy. That gives the round tension and gives the data the control outcome.

## 4. Stretch: policy-driven inspector

The daily memo becomes the inspector's written policy. For example: "No bank change without a callback to the number on file. Hold first-time senders over $2,000."

The inspector's actions are approve, hold, call back and reject. They're decided by the model's score plus the policy, and logged. If time allows, an LLM reads the policy and the email to choose the action. A local decision model such as LiquidAI d1-3B (see the earlier research) keeps Claude usage down. An unauthorized approve is the attacker's win. That's the LLMail-Inject setup, applied to accounts payable.

## Hour-by-hour (Sat 2 AM to Sun 9 AM)

| When | A (backend) | B (ML) | C (computer UI) | D (office) |
|---|---|---|---|---|
| Sat 2–8 AM | Sleep shift, or verdict from `prediction.flagged`, real `retrain()`, `/metrics` from `versions()` | `eventlog`, `export`, data card; schema for EmailMessage and VendorChangeRequest | Consent screen, session id | Sleep shift |
| Sat 8 AM–2 PM | `/submit` accepts `email`; `log_attempt` on every submit and rejection | Email features, legit base rates, sender-identity levers in attackers; gate still passes | Email composer: sender picker, Reply-To, subject, body (replaces cover email) | Office signposting for the two-act flow |
| Sat 2–8 PM | `/round/change-request`, callback logic, vendor-master update in round state | `bank_change_fraud` payload, change-request generator and features, retrain on two-act tricks | Act-1 screen: change request; callback outcome toast | Phone ring and callback scene |
| **Sat 8 PM checkpoint** | | Whole team plays 5 rounds of the two-act flow. Cut item 4 if anything is shaky. | | |
| Sat 8 PM–2 AM | Stretch: policy actions | Stretch: policy inspector; run `ml.checks` and the demo across seeds | Polish | Playtest with 3 outside people |
| Sun 2–9 AM | Freeze, deploy, warm caches | Fresh model dir for the stage; export the dataset and data card from playtests | Final polish | Record the backup video |

## Done when

- [ ] Every `/submit` and rejection writes one row, with consent and session id, and `python -m ml.export` produces `.eml` files, invoice JSON and `DATACARD.md`.
- [ ] A player can send a bank-change email from any of the four sender identities, and the headers and features come out as specified.
- [ ] A two-act attack works end to end:
  - a callback to the number on file catches it,
  - a callback to the email's number or no callback lets it through,
  - the paying invoice is labelled `bank_change_fraud`.
- [ ] Every new tell has a legit base rate above 5%, and `ml.checks` still passes on seeds 1–12.
- [ ] The core demo still works: the trick is PAID, a retrain runs, variants are FLAGGED.
- [ ] The pitch and the data card make the honest claim above, and nothing more.
