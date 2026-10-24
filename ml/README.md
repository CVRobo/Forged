# ml/ (Person B)

The detector side of Forged. Built in the order of Model Spec v0.2, section 7. Done so far: steps 1–5 (schema and `compute_features`, the legit generator, the scripted attackers, a baseline that passes the spec's checks, and the retrain loop), plus `ml/detector.py`, the module the game server imports. Also done: the data side of steps 7 and 9 (replay grid, memo rules, patch notes, per-level thresholds).

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
| `detector.py` | **What the server imports**: `predict`, `retrain`, `top_features`, `memo_rules`, `versions`, `replay_grid`, `warm`. |
| `adapter.py` | Turns the game's `InvoiceRecord` (prototype `record()`) into an `Invoice` and a serving case file. |
| `training.py` | Trains v1 and runs the retrain loop: dedupe, cloning, retrain guard, per-player cap, bootstrap promotion gate, `force`. |
| `store.py` | Saved versions (`v{n}.joblib`, `versions.json`) and the replay buffer, under `FORGED_MODEL_DIR` (default `ml/models/`, git-ignored). |
| `explain.py` | Tells (in the prototype's tell names and regions), memo rules from a depth-2 tree (spec 5.1), patch notes (spec 5.2). |
| `demo.py` | Plays the spec's core sequence through `ml.detector` with game-shaped records. |
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

See the detector play a round, a retrain and the next version (about 7 s):

```bash
ml/.venv/bin/python -m ml.demo
```

Train and save v1 before the demo, so the first submit isn't slow:

```bash
ml/.venv/bin/python -m ml.detector --train
```

## Where v1 stands

Every check passes on seeds 1–12: v1 catches 63–69% of fresh scripted attacks at 4–6% FPR (target 50–70%). On seeds 1–3, no payload feature alone gets past 49% recall at 5% FPR (target under 60%), and text features alone score AUROC 0.59 (target under 0.75).

By scheme, v1 catches Duplicate Dance most often (about 85%) and Phantom Supplier least (about 50%). Spoofed reprints of a known vendor's invoice get caught 75–97% of the time, against 51–64% for hand-edited originals. That is a game-balance point for C and D: the burner pen is currently the riskier tool.

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

## Where the retrain loop stands

One missed trick, cloned 100 times, retrains in under half a second, and the promotion gate keeps frozen-set FPR at about 4%. How well vN+1 catches the trick depends on whether the trick looks like something real vendors do:

- **Learned fully:** padded invoices and spoofed reprints. 10 of 10 fresh variants are caught after one retrain.
- **Mostly learned:** a careful tape-on-bank switcheroo. v1 catches 18%; after one retrain 78–86% at the spec's 5% FPR, and 60–84% at Sunny Diner's 3%. The spec asks for 9 of 10. The gap is real hand-corrected bank changes, which look identical without the hidden mule account.
- **Not learnable by retraining:** a careful fresh phantom vendor (2 of 10). It's indistinguishable from a real new vendor. Only in-session memory (step 6, `self_sim`) can catch a player who repeats it.

A trial of Stage 2 (gradient-boosted trees with the spec 4.3 monotone constraints) learns the switcheroo completely: 100% of variants after one retrain. But its v1 already catches 93% of scripted attacks, so adopting it means re-tuning the generator so that v1 lands back at 50–70%.

## What the server needs to change (A's files)

0. **Install the ML requirements in the server's environment** (`pip install -r ml/requirements.txt`). `server/requirements.txt` has no scikit-learn or numpy. Without them `from ml.detector import predict` fails and `server/services/detector.py` silently falls back to rule-based tells. With them, the server's own `detect()` picks the model up (checked: it logs "ML detector returned 5 tells").
1. **Use the model's verdict.** `server/routes/round.py` still multiplies suspicion by `0.55 + 0.12 * (version - 1)`, adds random noise of ±12, and flags above 38. `predict()` scales its suspicion so that formula lands on the model's threshold, but the noise still flips verdicts near the line, and that breaks the "same trick, now FLAGGED" demo. Use `prediction.flagged` and keep persuasion as a separate gate (spec 5.4).
2. **Retrain on PAID tricks, for real.** Today the server bumps the version after 5 *caught* submissions without training anything. Queue the PAID player submissions, call `retrain(records)`, and use its `new_version`. `POST /admin/retrain?force=true` maps to `retrain(records, force=True)`.
3. **Send what the model can't guess.** For each session: the earlier records (`predict(record, history=...)`), the invoices paid so far, and the open orders. On each record: a due date and a send time. Without the paid invoice being copied, a Duplicate Dance can't be labelled.
4. **One vendor list.** Level 1 in `server/content/levels.py` has 3 vendors, and the model's world has 6 (`ml/world.py`). Show the player the same case file the model uses.
5. **Expose the data.** `GET /detector/versions` → `versions()`, `GET /detector/replay_grid` → `replay_grid()`. `GET /metrics` can read `versions()` too. The memo's two real rules come from `memo_rules()`.
6. **Warm up.** Call `warm()` at startup, or run `python -m ml.detector --train` before the demo.
7. **Fix the contract.** `docs/contracts.md` documents `predict(record) -> dict`, but the server calls `predict(record, version, memo)` and unpacks two values. `Prediction` supports both: it unpacks as `(tells, suspicion)`, and `.to_dict()` gives the dict.

New tell names for C's labels: `short_terms`, `after_hours`, `vague_items`, `urgent_email`. The rest reuse the prototype's.

## Next for B

- Step 6: in-session memory (`knn_fraud_share`, `knn_max_sim`, `self_sim`) with the numpy fallback. It needs Redis from A only for the shared index.
- The stats page at `frontend/src/app/stats/page.tsx`. It needs A's endpoints from item 5 above.
- Step 8: the search attacker and the robustness audit.
- Stage 2 trees, if the team wants the stronger learner.
