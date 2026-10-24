# Which online-fraud model to ship

There are two independent builds of the online-fraud detector, both living in `ml/online/`:

- **`d/ml-online`** (+ `d/ml-robustness`) — this branch. One LightGBM model trained on the real
  IEEE-CIS data but **restricted to the columns a player's checkout can fill**, calibrated against
  simulated honest shoppers, wired straight into the game, with a retrain-from-players loop, a
  day-by-day evaluation, a report page, and an adversarial-robustness harness.
- **`ML-alt`** — a Kaggle-competitive build: ~200 engineered features (UID aggregations, target
  encoding, V-column selection) trained on all ~590K transactions, plus a separate logistic-
  regression "game model" trained on a synthetic generator.

They **cannot both be merged**: they redefine the same files (`ml/online/features.py`,
`model.py`, `__init__.py`, `server/services/online_data.py`, `.gitignore`). It is one or the other.

## Measured comparison

The decisive measurement is on **game orders** — identical row sets from the game's own simulator
(honest shoppers vs attackers), so it is a true head-to-head:

| | **Game orders — attacks caught** | Honest shoppers blocked |
| --- | --- | --- |
| **`d/ml-online`** | **92%** | 0.6% |
| **`ML-alt`** | **7%** | 3.2% |

On real fraud both are in the same range (`d/ml-online` ~65% recall @ 3.6% FPR on the device
segment; `ML-alt` ~58% @ 3.3% on all transactions), but those numbers are **not** directly
comparable — they're measured on different populations and base rates, so neither AUC (0.92 vs
0.88) is a fair head-to-head and we don't rely on it. The game-orders column is the one that
decides, because it's the same rows through both models.

The game-orders gap is decisive. `ML-alt`'s heavy features (V-columns, UID history, target encoding)
**cannot be computed from a single game checkout**, so at serving time it is nearly blind to the
choices players make (attacker score ≈ 0.12 vs honest ≈ 0.06 — almost no gap). `d/ml-online` shares
its feature space with the game by design, so it separates them cleanly (0.99 vs 0.003). On real
fraud the two are close, and `d/ml-online` is actually a bit stronger on the device segment the game
represents.

## Decision

**Ship `d/ml-online` + `d/ml-robustness`.** It is the model that works inside Forged and carries the
human-attacks → model-learns loop the AI/ML track is about. `ML-alt` would score well on a Kaggle
leaderboard but is effectively disconnected from the game.

Worth salvaging from `ML-alt` later (not blockers): its feature-engineering ideas (Bayesian-smoothed
target encoding, frequency encoding, amount log/cents) applied only to game-producible columns, and
its test ideas.

## Merge plan

1. **PR #2** — `d/ml-online` → `main` (merges cleanly; no conflicts).
2. **PR #3** — `d/ml-robustness` → `main` (based on #2; GitHub retargets it to `main` once #2 merges).
3. Do **not** merge `ML-alt`; it conflicts with the above and loses the game-fit.

Caveat: the two AUCs come from slightly different train/test splits (`ML-alt` uses all transactions;
`d/ml-online` uses the device segment), so read 0.92 vs 0.88 as "at least as strong on the game's
segment," not a precise gap. The game-orders numbers are on identical rows and are the ones that
matter here.
