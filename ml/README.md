# ml/ (Person B)

The detector side of Forged. Built in the order of Model Spec v0.2, section 7. Done so far: steps 1–6 (schema and `compute_features`, the legit generator, the scripted attackers, a baseline that passes the spec's checks, the retrain loop, and in-session memory) and step 8 (the search attacker and the robustness audit), plus `ml/detector.py`, the module the game server imports. Also done: the data side of steps 7 and 9 (replay grid, memo rules, patch notes, per-level thresholds).

| File | What it is |
| --- | --- |
| `schema.py` | Pydantic models from design doc v0.1 Appendix A, plus the spec's section 8 changes. Also holds the feature name lists and the per-level settings (spec 5.3). |
| `features.py` | `compute_features(invoice, case_file, session_history)`: the one function used for training, serving and the generators. |
| `world.py` | The Sunny Diner level: six approved vendors, the name and line-item pools shared by legit and fraud invoices, and the hidden `Truth` (mule accounts, real order amounts). |
| `payloads.py` | Ground truth. `payload_schemes()` and `is_fraud()` for the five Sunny Diner schemes. Labels come only from here. |
| `text.py` | Cover-email templates, shared by both classes (spec 3.2). |
| `generate.py` | Simulated runs (spec 3.1): `build_dataset(seed)`, and `clone_attacks` / `clone_runs(levers, n, seed)` for trick cloning (spec 2.2). |
| `attackers.py` | One scripted attacker per scheme: `Levers`, `sample_levers()` (random, with a care level) and fixed-lever mode. |
| `baseline.py` | Stage 1 detector: logistic regression, Platt calibration, threshold at a target FPR, per-feature reasons. `memory=False` scores with the kNN features at their training mean. |
| `memory.py` | In-session memory (spec 2.3): `NumpyIndex` (brute-force cosine search with time and session filters, the spec's fallback when Redis is down), the three kNN features, `replay()` for generator data, memory dropout for training, `heat()`. |
| `memory_scale.json` | The fixed standardization for the index vectors, fit once on the base train split. Refit only when the generator changes: `python -m ml.memory --fit`. |
| `checks.py` | The gate before the retrain loop: spec checks 2.1, 3.1, 3.2, 4.5 and the v1 recall target. Also reports v1 with memory on and at each level. |
| `detector.py` | **What the server imports**: `predict`, `retrain`, `top_features`, `memo_rules`, `versions`, `replay_grid`, `warm`, `harden`. |
| `search.py` | The search attacker (spec 4.6): hill climbing over the lever space against a saved version, about 200 queries per scheme. Also `robustness()`, `audit()`, and `harden()`, a retrain on its best attacks as `search_attacker` rows. |
| `audit.py` | `python -m ml.audit [--harden] [--level L] [--seed N]`: the robustness audit table, optionally before and after one hardening round. |
| `adapter.py` | Turns the game's `InvoiceRecord` (prototype `record()`) into an `Invoice` and a serving case file. |
| `training.py` | Trains v1 and runs the retrain loop: dedupe, cloning, retrain guard, per-player cap, bootstrap promotion gate, `force`. Holds the live memory (`live_memory()`). |
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

v1 trains on all 34 features: the 31 base features and the three memory features. Sunny Diner and St. Mercy have memory off, so they score with the memory features at their training mean. The gate judges v1 that way.

Every check passes on all ten seed triples from 1–12 ((1, 2, 3) through (10, 11, 12) as train, validation and test). With memory off, v1 catches 61–69% of fresh scripted attacks at 4–6% FPR (target 50–70%). At Sunny Diner's own 3% target it catches 51–64%. On seeds 1–3, no payload feature alone gets past 42% recall at 5% FPR (target under 60%), and text features alone score AUROC 0.59 (target under 0.75).

**With memory on, v1 goes past the 70% target.** At 5% FPR (Port Nocturne) it catches 68–81% of scripted attacks, 72.5% on seeds 1–3. At Neon Arcade's 8% it catches 78–88%. That's intended: memory is what makes the later levels harder. The 50–70% target only holds for the memory-off levels.

By scheme (seeds 1–3, memory off), v1 catches Duplicate Dance most often (79%) and Boss Request least (45%). Spoofed reprints of a known vendor's invoice get caught 75–94% of the time, against 48–59% for hand-edited originals. That is a game-balance point for C and D: the burner pen is currently the riskier tool.

## In-session memory (step 6)

- **The index.** Every submission's base features go into a vector index: generator train rows, the replay buffer, and everything `predict()` and `retrain()` see. Each vector is standardized with the fixed `memory_scale.json` and stored with is_fraud, session, origin and created_at. A query only sees rows created earlier, and returns three features:
  - `knn_fraud_share`: the fraud share among the 10 nearest neighbors.
  - `knn_max_sim`: the highest similarity among those neighbors.
  - `self_sim`: the highest similarity to this session's own earlier submissions.
- **Similarity** is cosine, floored at 0, which is what a Redis COSINE index returns as 1 − distance. The index is in-process numpy (`NumpyIndex`, about 3,300 rows, sub-millisecond queries). A Redis backend only needs the same `add()`, `search()` and `id in index`.
- **Generator data** gets its memory features by replaying each dataset in created_at order. Clones replay after the live memory.
- **Memory dropout.** Every training row appears twice, at half weight each: once as served, and once with its memory features at the training mean. Without that, the memory features soak up signal, and memory-off recall fell from 65% to 57% at 5% FPR (50% at 3%).
- **Scripted attackers now repeat themselves.** After a PAID attack, an attacker reuses the same trick half the time, as players do (`REPEAT_RATE` in `generate.py`). Without repeats, `self_sim` looked the same for fraud and legit, and the model gave it no weight.
- **Heat.** `Prediction.heat` (0–100) comes from `self_sim`. It is 0 up to a typical legit invoice's self_sim (0.48, the median on the train split) and 100 at an exact repeat. The heat meter reads the same number at every level; only memory-on levels let it move the score.

Spec 2.3 acceptance checks (all in `tests/test_detector.py`):

1. **Same trick twice in one session, no retrain.** The second scores higher at a memory-on level. A mule account taped onto Pete's invoice scores 0.108 the first time at Port Nocturne and 0.162 the second. On the second, `self_sim` goes 0 → 1, `knn_fraud_share` 0.1 → 0.2, and heat 0 → 100. Both are still PAID (the threshold is 0.35). At Sunny Diner, where memory is off, both score the same.
2. **Dropping memory costs recall on repeated tricks.** This is measured on 100 player-like attacks: sessions that each repeat one careful trick, with one PAID copy already in memory. Each session is replayed on its own, so it sees only the live memory and its own earlier rounds. Both columns use the same 5% FPR target, with memory on (Port Nocturne) and off (St. Mercy).

   | Trick | Memory on | Memory off | Base-features-only model |
   | --- | --- | --- | --- |
   | Careful phantom vendor | 40% | 15% | 19% |
   | Careful switcheroo | 63% | 41% | 39% |
   | Careful boss request | 73% | 52% | 61% |
   | Careful padded invoice | 100% | 100% | 100% |

   Frozen-set FPR stays about the same: 4.4% with memory on, 4.3% with memory off.
3. **The gate**, as described under "Where v1 stands".

## The search attacker and the robustness audit (step 8)

`ml/search.py` attacks a saved version, one scheme at a time:

- **The search.** Hill climbing over the scheme's levers from 4 random restarts, changing one lever at a time and keeping every setting that gets PAID.
  - A setting is scored by its evasion rate on 5 variants generated with those levers fixed. Every setting's variants come from the same seed, so settings are compared on the same vendors and dates.
  - Ties go to the lower mean P(fraud). Without that tie-break, most settings hit 5 out of 5 and the first one found won, which was a much weaker attack (40–68% recall on fresh variants, against 0–57% now).
  - The budget is 200 queries per scheme, one query being one invoice scored. The search takes about 1 s per scheme and is deterministic given a seed (and, at memory-on levels, the memory's contents).
- **The audit.** `python -m ml.audit` gives each scheme's best attack and its robustness recall: the share of 100 fresh variants, generated with another seed, that get FLAGGED. The lowest of those is the worst case. This replaces the maxed-camouflage audit.
- **Hardening.** `python -m ml.audit --harden` (or `ml.detector.harden()`) runs the search on the live version. It then retrains on 10 variants of each scheme's 2 most evasive settings: 100 rows with origin `search_attacker` and weight 1.5. Those rows go through the usual gate and are never cloned. A bigger round, 3 settings × 20 variants, fails the gate: frozen recall drops 6.5 points, because the careful phantoms the search finds look like real new vendors.

Seed 0, Sunny Diner (3% FPR, memory off), one hardening round:

| Scheme | v1: robust recall | v1's best attack | v1's attacks under v2 | v2: robust recall (new search) |
| --- | --- | --- | --- | --- |
| Bank Switcheroo | 32% | a lookalike reprint on a generic letterhead, on cadence | 72% | 38% |
| Duplicate Dance | 40% | a lookalike reprint, generic letterhead, one stain, an apologetic email | 100% | 34% |
| Boss Request | 57% | the same fake payee again, a plain email | 59% | 59% |
| Phantom Supplier | 7% | a fresh payee, an apologetic email mentioning new bank details | 36% | 49% |
| Padded Invoice | 0% | the vendor's own paper, a taped-on handling fee, a plain email | 1% | 3% |
| **Worst case** | **0%** | | | **3%** |
| Frozen test at Sunny Diner | recall 55.8%, FPR 2.5% | | | recall 55.6%, FPR 2.8% |

v2 was promoted: frozen FPR was 4.6% at the gate's 5% target, and the recall-change lower bound was −2.4%. One round fixes the attacks it trained on, except the padded invoice. A new search then finds other settings, but the average worst case still rises from 27% to 37%. At Port Nocturne (memory on, each variant a session that repeats the attack), v1's worst case is 59%, again the padded invoice with a fee.

**The padded invoice with a taped-on fee line is the real hole.** Hardening can't learn it (0% → 1%). On paper it looks like a real change order that someone corrected by hand, because `field_altered_count` counts tape and whiteout the same way. This is a balance call for C and D. The levers are the tape-versus-whiteout distinction, a feature for an added line item, or keeping it as Sunny Diner's "perfect crime".

## Contract notes for A and C

- **Send raw invoice state, not computed flags.** The prototype's `record()` sends `domain_mismatch`, `letterhead_match` and `heat`. The server computes all of these from `Invoice` plus the case file.
- **Tool names follow Appendix A, not the prototype:** `coffee` → `mug`, `copier` → `photocopier`, `scissors` → `tape`. `whiteout`, `stamp` and `pen` are unchanged.
- **A mug stain** is `ToolUse(tool="mug", target=<region>, params={"strength": 0.35})`. Coffee Connoisseur sends 0.7. Stains on the same region add up, capped at 1.
- **Two proposed fields, not in Appendix A:**
  - `Invoice.sent_at`: `offhours_send` needs a send time, and the schema only had dates. `None` counts as business hours.
  - `VendorProfile.usual_stamps`: `stamp_matches_vendor` needs each vendor's stamp habits.
- **Inputs are as of *before* the invoice.** `case_file.paid_invoices` must not contain it yet. `SessionHistory.round_no` is the round being scored. `entries` lists this run's earlier invoices, any verdict, and entries after the current round are ignored.
- **`predict()` serves the kNN features and returns them; store them.** `Prediction.features` holds all 34 values as served. Store them as `Submission.features`, and send them back as `"features"` on each record passed to `retrain()`, because training never recomputes them (spec 2.3).
- **Records need a `session_id` and a `round_id`.** `self_sim` compares against earlier records with the same `session_id`. `round_id` keeps two rounds with the same invoice apart. Without one, a record judged twice counts once.
- **Heat comes from the model now.** `Prediction.heat` (0–100) is derived from `self_sim`. The prototype's own `heat` field can go.
- **The memory lives in-process.** Train rows and the replay buffer are reloaded at startup, but rows `predict()` wrote since the last retrain are lost on restart. A Redis-backed index (A's infrastructure) would keep them, and needs only `add()`, `search()` and `id in index`, like `memory.NumpyIndex`.

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

One missed trick, cloned 100 times, retrains in about half a second, and the promotion gate keeps frozen-set FPR at about 4%. How well vN+1 catches the trick depends on whether the trick looks like something real vendors do:

- **Learned fully:** padded invoices and spoofed reprints. 10 of 10 fresh variants are caught after one retrain.
- **Mostly learned:** a careful tape-on-bank switcheroo. v1 catches 39% at the spec's 5% FPR and 29% at Sunny Diner's 3%. After one retrain it catches 84–86% at 5% and 73–74% at 3% (four tricks, 100 fresh variants each). The spec asks for 9 of 10. The gap is real hand-corrected bank changes, which look identical without the hidden mule account.
- **Not learnable by retraining:** a careful fresh phantom vendor (2 of 10). It's indistinguishable from a real new vendor. In-session memory catches a player who repeats it: 40% of repeats with memory on, against 15% with memory off.

A trial of Stage 2 (gradient-boosted trees with the spec 4.3 monotone constraints) learns the switcheroo completely: 100% of variants after one retrain. But its v1 already catches 93% of scripted attacks, so adopting it means re-tuning the generator so that v1 lands back at 50–70%.

## What the server needs to change (A's files)

Already done on `b/ml-generator`, as small fixes in A's files:
- **ML dependencies** are in `server/requirements.txt`.
- **Warm-up:** the app trains or loads the detector in a background thread at startup.
- **Visible fallback:** a failed ML import now logs a warning.
- **Tell wrapping:** `detect()` wraps ML tells into `Tell`, with descriptions for the new tell names. Before this, `round.py` crashed on `t.model_dump()`.
- **Snapshot crash:** the `round.py` case-file snapshot crashed every `/submit` with "Vendor is not JSON serializable", ML or not. It now calls `v.model_dump()`.
- **Contract:** `docs/contracts.md` section 3 documents the real interface.

Checked end to end: A's real `/round/start` and `/submit` routes, with an in-memory Redis, return 200. The verdicts are the ML model's, and Level 2 falls back to the rule-based tells.

Still A's:
1. **Use the model's verdict.** `round.py` still multiplies suspicion by `0.55 + 0.12 * (version - 1)`, adds random noise of ±12, and flags above 38. `predict()` scales its suspicion so that formula lands on the model's threshold, but the noise still flips verdicts near the line, and that breaks the "same trick, now FLAGGED" demo. Use `prediction.flagged` and keep persuasion as a separate gate (spec 5.4).
2. **Retrain for real, and stop inventing metrics.** Today the server bumps the version after 5 *caught* submissions without training anything, then writes catch rate, FPR and held-out rate as the previous values plus `random.uniform` increments (`round.py`, around line 197). `GET /metrics` serves those numbers. Queue the PAID player submissions, call `retrain(records)`, use its `new_version`, and have `/metrics` return `versions()`. `POST /admin/retrain?force=true` maps to `retrain(records, force=True)`.
3. **One version number.** The UI's "Inspector vN" is the server's Redis counter, not the model that judged the invoice. Show `prediction.version`.
4. **Store what the model saw.** Add `prediction.score`, `threshold`, `flagged`, `version`, `features` and the payload label to the `store_submission` call, so verdicts can be reproduced.
5. **Send what the model can't guess.** The invoice being duplicated, the paid invoices and open orders, a due date and a send time. Without the copied paid invoice, a Duplicate Dance can't be labelled. Session history in `predict(record, history=...)` only after the server also interleaves background legit invoices, because training sessions include them.
6. **One vendor list.** Level 1 in `server/content/levels.py` has 3 vendors, and the model's world has 6 (`ml/world.py`). Show the player the same case file the model uses.
7. **Expose the data.** `GET /detector/versions` → `versions()`, `GET /detector/replay_grid` → `replay_grid()`. The memo's two real rules come from `memo_rules()`.
8. **Keep the stage demo apart from the booth.** Once retraining is real, public playtests will retrain the live model, so by stage time the demo trick may already be caught. Point the stage server at a fresh `FORGED_MODEL_DIR`.

New tell names for C's labels: `short_terms`, `after_hours`, `vague_items`, `urgent_email`. The rest reuse the prototype's.

## Next for B

- A Redis backend for the memory index, once A's Redis is up (same interface as `memory.NumpyIndex`).
- The stats page at `frontend/src/app/stats/page.tsx`. It needs A's endpoints from item 5 above.
- Decide with C and D what to do about the padded-invoice-with-a-fee hole (see step 8 above).
- Run `ml.detector.harden()` between player sessions: A's admin endpoint, or a cron job.
- Stage 2 trees, if the team wants the stronger learner.
- Only Sunny Diner is modelled. `predict()` raises for other levels, so the server uses its rules there, and `retrain()` skips their records.
