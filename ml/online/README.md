# ml/online: Gus learns from players' attacks

The fraud model behind the typed checkout. It starts from the real IEEE-CIS dataset, judges every order players send, and retrains on the orders that fooled it. A new version only goes live if it is better on players **and** no worse for real customers.

| File | What it is |
| --- | --- |
| `features.py` | The model's inputs: the IEEE-CIS columns a player's choices change (amount, product, card, distances, email domains, device, browser, proxy, hour, the C and D history counts). Constant or random game columns are left out. |
| `simulate.js` | Simulated shoppers made by the game's own code (`prototype/orders.js`): `players` (random attackers), `clever` (quiet attackers) and `honest` (the cardholders themselves). |
| `game_rows.py` | Loads simulated rows and real player orders (`server/data/ieee_rows.csv`), split by session. |
| `model.py` | LightGBM model, saved versions, thresholds, and Gus's reasons (per-order feature contributions mapped to the game's tells). |
| `train.py` | Trains v1. |
| `retrain.py` | Retrains on player orders and promotes the new version only if it passes the gate. |
| `report.py` | The attacks players found: trick families, dollars, and each version's catch rate. |
| `probe.js` | Turns hand-written checkouts into rows, to test specific tricks. |

## Setup

From the repo root (Python 3.10+, Node for the simulators). Put the Kaggle files `train_transaction.csv` and `train_identity.csv` in `ml/online/data/` (git-ignored; the competition requires a Kaggle account).

```bash
python -m venv ml/.venv
ml/.venv/Scripts/python -m pip install pandas numpy scikit-learn lightgbm joblib fastapi uvicorn pydantic python-dotenv redis
ml/.venv/Scripts/python -m ml.online.train
```

Then run the server from the same environment, and the game with `?api=http://localhost:8000`:

```bash
USE_STUBS=true ml/.venv/Scripts/python -m uvicorn server.main:app --port 8000
```

`/submit` scores each order with the live version. Every 25 orders that get through (`FORGED_RETRAIN_EVERY`), a retrain runs in the background. Without a trained model the server answers with the browser's scripted Gus.

## How it learns

1. **v1** trains on three kinds of rows:
   - real transactions with device info (the dataset's online segment: 144k rows, 7.8 % fraud), split by time;
   - simulated honest shoppers in the game's format;
   - simulated attackers in the game's format, weighted down to 8 % of the game-format rows, like the real fraud rate.
2. **Players attack it.** Every player order is fraud by construction, so the labels are free and can't be poisoned into "this is fine".
3. **Retrain.** The orders that got through weigh 3× (`EVASION_WEIGHT`). One player gives at most 300 rows per retrain.
4. **The gate.** On data no version trained on, the new version must:
   - catch real fraud at most 2 points less than the live version;
   - block at most 4 % of real honest customers;
   - block at most 5 % of honest game-format shoppers;
   - catch more held-out player orders than the live version, judged on at least 30 of them.

   Versions that fail are kept on record with `promoted: false`.
5. **Patch notes.** `learned` lists the tells whose share of the model's attention grew most.

## Why honest game shoppers matter

The game fills some columns in ways real data never does. For example, `dist2` is always set in the game but mostly blank in real data, and product `W` never has device info in real data. A model trained on real data plus player orders (all fraud) learns "looks like the game = fraud": a classifier separated game rows from real fraud with AUC 1.0. Adding honest shoppers in the game's format removes that shortcut. v1 blocks about 1 % of them, close to its real-world rate.

## Two thresholds

- **The real-shop threshold** blocks 3 % of honest customers (`TARGET_FPR`). The gate and the report use it.
- **The game threshold** depends on rank (`RANK_CUTOFF`):

  | Rank | Gus blocks orders he's at least this sure are fraud |
  | --- | --- |
  | Rookie | 90 % |
  | Hustler | 80 % |
  | Schemer | 65 % |
  | Operator | 50 % |
  | Mastermind | the real-shop threshold |

  As versions learn, the same tricks score higher, so the game gets harder.

## v1 numbers (seed data, Oct 2026)

- **Real test (last 15 % of days):** catches 64.8 % of fraud and blocks 3.7 % of honest customers. Only the columns the game can fill are used.
- **Clever simulated attackers caught, by rank:** 49 % (Rookie) → 79 % (Mastermind). Random attackers: 75 % → 93 %.
- **One retrain on 400 clever simulated sessions:** held-out clever orders caught 79 % → 95 %, real recall 64.8 % → 63.3 %, honest game shoppers blocked 1.3 % → 4.4 %.

## Known limits

- The column mapping in `prototype/orders.js` (`toRows`) is a documented guess, because IEEE-CIS columns are anonymized.
- The simulated honest shoppers' habits (how often they use a VPN or ship elsewhere) are assumptions, and they set how suspicious "ships elsewhere" looks.
- The gut feeling in the checkout is still the browser's scripted Gus, so it can disagree with the model's verdict.
