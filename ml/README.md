# ml/ (Person B)

The detector side of Forged. Built in the order of Model Spec v0.2, section 7. Done so far: steps 1–4 (schema and `compute_features`, the legit generator, the scripted attackers, and a baseline that passes the spec's checks).

| File | What it is |
| --- | --- |
| `schema.py` | Pydantic models from design doc v0.1 Appendix A, plus the spec's section 8 changes. Also holds the feature name lists and the per-level settings (spec 5.3). |
| `features.py` | `compute_features(invoice, case_file, session_history)`: the one function used for training, serving and the generators. |
| `world.py` | The Sunny Diner level: six approved vendors, the name and line-item pools shared by legit and fraud invoices, and the hidden `Truth` (mule accounts, real order amounts). |
| `payloads.py` | Ground truth. `payload_schemes()` and `is_fraud()` for the five Sunny Diner schemes. Labels come only from here. |
| `text.py` | Cover-email templates, shared by both classes (spec 3.2). |
| `generate.py` | Simulated runs (spec 3.1): `build_dataset(seed)` and `clone_attacks(levers, n, seed)` for trick cloning (spec 2.2). |
| `attackers.py` | One scripted attacker per scheme: `Levers`, `sample_levers()` (random, with a care level) and fixed-lever mode. |
| `baseline.py` | Stage 1 detector: logistic regression, Platt calibration, threshold at a target FPR, per-feature reasons. |
| `checks.py` | The gate before the retrain loop: spec checks 2.1, 3.1, 3.2, 4.5 and the v1 recall target. |
| `tests/` | Unit tests for every feature, payload and check, plus invariants of the generated data. `factories.py` builds a small Sunny Diner world. |

Set up once, from the repo root (Python 3.10+):

```bash
uv venv ml/.venv --python 3.10 && uv pip install --python ml/.venv/bin/python -r ml/requirements.txt
```

Run the tests:

```bash
ml/.venv/bin/python -m pytest ml
```

Run the spec gate (about 10 s, three datasets of about 3,300 rows each):

```bash
ml/.venv/bin/python -m ml.checks
```

## Where v1 stands

Every check passes on seeds 1–12: v1 catches 63–68% of fresh scripted attacks at 4–6% FPR (target 50–70%). On seeds 1–3, no payload feature alone gets past 49% recall at 5% FPR (target under 60%), and text features alone score AUROC 0.58 (target under 0.75).

By scheme, v1 catches Duplicate Dance most often (about 85%) and Phantom Supplier least (about 50%). Spoofed reprints of a known vendor's invoice get caught 75–97% of the time, against 50–64% for hand-edited originals. That is a game-balance point for C and D: the burner pen is currently the riskier tool.

## Contract notes for A and C

- **Send raw invoice state, not computed flags.** The prototype's `record()` sends `domain_mismatch`, `letterhead_match` and `heat`. The server computes all of these from `Invoice` plus the case file.
- **Tool names follow Appendix A, not the prototype:** `coffee` → `mug`, `copier` → `photocopier`, `scissors` → `tape`. `whiteout`, `stamp` and `pen` are unchanged.
- **A mug stain** is `ToolUse(tool="mug", target=<region>, params={"strength": 0.35})`. Coffee Connoisseur sends 0.7. Stains on the same region add up, capped at 1.
- **Two proposed fields, not in Appendix A:**
  - `Invoice.sent_at`: `offhours_send` needs a send time, and the schema only had dates. `None` counts as business hours.
  - `VendorProfile.usual_stamps`: `stamp_matches_vendor` needs each vendor's stamp habits.
- **Inputs are as of *before* the invoice.** `case_file.paid_invoices` must not contain it yet. `SessionHistory.round_no` is the round being scored. `entries` lists this run's earlier invoices, any verdict, and entries after the current round are ignored.
- **The kNN features are not computed here.** `knn_fraud_share`, `knn_max_sim` and `self_sim` come from the vector index at submit time (spec 2.3). They get stored in `Submission.features` alongside the base features.

## Choices made in `features.py` (change them if the team disagrees)

- An open order only counts when it belongs to the invoice's vendor. A phantom vendor citing a real PO number still gets `no_open_order = 1`.
- "Source" for `window_count` / `window_sum` means the same vendor *or* the same bank account. This way Salami Slicer can't dodge the window by rotating vendor names. The window covers the current round and the 4 before it, and includes the current invoice.
- `domain_edit_distance` is the distance to the *nearest* known domain, not to the vendor's own. A known vendor sending from another vendor's real domain gets `domain_mismatch = 1` with distance 0.
- `cadence_z` assumes a cadence std of 25% of `cadence_days`, since `VendorProfile` has no std field.
- `dup_similarity` is the mean of four 0–1 scores: same vendor, amount closeness, line-item overlap, and date closeness (0 at 30 days apart). A normal recurring invoice scores about 0.88, which matches spec 2.1 (real recurring invoices should look like duplicates).
- The text features (urgency, vagueness, bank-change wording) are keyword lists at the top of `features.py`.

## How labels and data work (for A)

- **Labels need the hidden `Truth`.** A Bank Switcheroo pays a *mule account*, so a real vendor's bank change is legit even though `bank_changed = 1`. A Padded Invoice beats the *real* order amount, so a real change order is legit. A Duplicate Dance re-bills a paid invoice within half the vendor's cadence. The game server must call `payload_schemes(invoice, case_file, truth)` with the player's mule accounts in `truth.attacker_accounts`.
- **Scheme ids:** `bank_switcheroo`, `duplicate_dance`, `boss_request`, `phantom_supplier`, `padded_invoice`. The prototype's `changed_bank`, `duplicate` and `phantom` map to the first three's names.
- **A session is the desk's whole inbox:** the vendors' own invoices *and* the player's, one per round. That is what the model trained on. Between player rounds the server should add a few background legit invoices, and pay them into `case_file.paid_invoices`, so that serving matches training. A small hook in `generate.py` can produce them on request.

## Next

Step 5: the retrain loop. That covers the replay buffer, trick cloning with `clone_attacks`, the retrain guard, the bootstrap promotion gate and `force=true`.
