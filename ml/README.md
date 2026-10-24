# ml/ (Person B)

The detector side of Forged. Built in the order of Model Spec v0.2, section 7. Done so far: step 1, the schema and `compute_features`.

| File | What it is |
| --- | --- |
| `schema.py` | Pydantic models from design doc v0.1 Appendix A, plus the spec's section 8 changes. Also holds the feature name lists and the per-level settings (spec 5.3). |
| `features.py` | `compute_features(invoice, case_file, session_history)`: the one function used for training, serving and the generators. |
| `tests/` | One or more tests per feature. `factories.py` builds a small Sunny Diner world. |

Run the tests from the repo root:

```bash
python3 -m pytest ml
```

Needs Python 3.10+ and `pip install -r ml/requirements.txt`.

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

## Next

Step 2: the legit generator, built as simulated runs (spec 3.1). It needs tell base rates of 8–15% (spec 2.1), and the same email style and empty-email rate in both classes (spec 3.2).
