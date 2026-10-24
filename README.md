# Forged

A third-person office game about online-order fraud, built at Cal Hacks 13. You work in the back office of a web shop and push fraudulent orders past **Gus**, the shop's risk engine. Gus is a real fraud model: LightGBM trained on the IEEE-CIS dataset (590K real transactions), which retrains on the orders players got past it and only goes live if it stays fair to honest customers. Before judging an order, Gus checks the buyer's identity with the CRS Credit API.

- **Play it:** [prototype/](prototype/), with the controls and the full round explained in [prototype/README.md](prototype/README.md)
- **The fraud model:** [ml/online/README.md](ml/online/README.md)
- **The model report** (versions, day-by-day evaluation, attack families): `/report` on the backend, or [ml/online/report.html](ml/online/report.html)
- **Design history:** [docs/online-fraud-redesign.md](docs/online-fraud-redesign.md) (why the game moved from forged invoices to online orders), [docs/ml-model-choice.md](docs/ml-model-choice.md) (which model, and why), [docs/contracts.md](docs/contracts.md) (API contracts), [the original design doc](Forged%20Game%20Design%20Doc%20(v0.1).md)

---

## How it works

1. **The office** (Three.js) is where you walk around, sit at your desk, print the order slip, sneak past the boss and drop it in Gus's IN tray. Up to 4 players can share one office (LAN or online).
2. **The computer** (FORGED OS, inside the office) is where you fill in the checkout: what you buy, who you pretend to be, what you shop on, where you shop from, where it ships, when. The game turns every order into one row in the IEEE-CIS format (`prototype/orders.js`).
3. **Gus judges it.** The backend checks the claimed identity with CRS, scores the row with the live model version and explains the score in game terms ("who shops at 3 AM?"). Gus's gut feeling in the address bar uses the same model while you type.
4. **Gus learns from your wins.** Orders that got through are saved and, every 25 wins, a retrain runs in the background (where the training data is). The new version goes live only if it passes the gate: no worse on real fraud, no more honest customers blocked, and better on held-out player attacks.

Without the backend, the game still plays: a scripted Gus in the browser judges the orders.

## Tech stack

What the code actually runs. Versions are the pinned ones from `deploy/requirements.txt` and `ml/online/requirements.txt`.

| Part | Technology | Where |
| --- | --- | --- |
| Game client | Plain HTML, CSS and JavaScript (no framework, no build step); **Three.js r128** from a CDN for the 3D office | `prototype/` |
| Voice in the game | **Web Speech API** (speech recognition and the browser's own voice) and **MediaRecorder** for the mic | `prototype/voice.js`, `voice-server.js` |
| Game server and multiplayer | **Python standard library**: a static server with caching off, a WebSocket server for rooms of 4, and a pass-through to the backend | `prototype/serve.py`, `lan_ws.py`, `lan_room.py` |
| Backend API | **FastAPI** 0.162, **Uvicorn** 0.54, **Pydantic** 2.14 | `server/` |
| Game state | **Redis** (redis-py): rounds, sessions, the leaderboard (sorted sets), NPC conversations, the retrain queue, inspector memory | `server/services/game_state.py` |
| Fraud model | **LightGBM** 4.7, **pandas** 3.1, **NumPy** 2.5, **scikit-learn** 1.9, **joblib** 1.6, on the **IEEE-CIS Fraud Detection** dataset (Kaggle) | `ml/online/` |
| Simulated shoppers | **Node.js**, running the game's own `orders.js`, so simulated orders have exactly the shape real players send (training only) | `ml/online/simulate.js` |
| Identity check | **CRS Credit API** (sandbox): TransUnion TruValidate identity verification and AtData Fraud Finder | `ml/online/crs.py` |
| LLM | **Claude API** (`anthropic` SDK): `claude-haiku-4-5` for the support clerk's persuasion score, NPC replies, Gus's lines, the memo decoy and the validity check; `claude-opus-5-5` writes the model report's analyst briefing. All have canned fallbacks without a key | `server/services/claude_service.py`, `npc_voice.py`, `ml/online/briefing.py` |
| NPC voices | **Cartesia** speech-to-text and text-to-speech (over `httpx`); the browser's voice speaks when there's no key | `server/services/cartesia_service.py` |
| Error tracking | **Sentry** (`sentry-sdk`, backend), on when `SENTRY_DSN` is set | `server/main.py` |
| Hosting | **Docker** (one container: game server, backend, Redis) on **Render** (Blueprint) | `Dockerfile`, `render.yaml`, `deploy/` |
| Tests | **pytest** | `ml/online/tests`, `server/tests`, `prototype/tests`, `ml/tests` |

**In the repo but not used by the game:**
- **`frontend/`** is an untouched Next.js scaffold from the first plan. The game is `prototype/`.
- **Deepgram** was replaced by Cartesia. `server/services/deepgram_service.py` is no longer called.
- **Arize Phoenix** is listed in `server/requirements.txt` but never imported.
- **The invoice detector in `ml/`** (scikit-learn, by B) belongs to the original forged-invoice game. The server still serves it for invoice submissions, but the current game sends online orders, which go to `ml/online`.

## Project structure

```
Forged/
├── prototype/            the game: 3D office, FORGED OS, orders → IEEE-CIS rows, scripted Gus, LAN rooms, serve.py
├── server/               FastAPI backend
│   ├── main.py           app, CORS, Sentry, /health, /report
│   ├── routes/           round.py (/round/start, /submit, /preview), clerk.py, npc.py, meta.py
│   ├── services/         online_data.py (the fraud model behind /submit and /preview), game_state.py (Redis),
│   │                     claude_service.py, npc_voice.py, cartesia_service.py
│   ├── stubs.py          canned responses when USE_STUBS=true
│   └── models/schemas.py the API's Pydantic models
├── ml/
│   ├── online/           the fraud model: features, training, the retrain gate, CRS check, red-team harness,
│   │                     report, shipped versions (models/v1–v4)
│   └── *.py              the earlier invoice detector
├── deploy/               the hosted image's requirements and start script
├── docs/                 design notes, contracts, specs
├── Dockerfile            the hosted game in one container
├── render.yaml           Render Blueprint
└── docker-compose.yml    Redis for local development
```

---

## Running it

### Just the game (no backend)

```bash
python prototype/serve.py
```

Open http://localhost:8765. The scripted Gus in the browser judges the orders. Use `serve.py` rather than `python -m http.server`: it turns off browser caching and hosts multiplayer rooms.

### The game with the real fraud model

Needs Python 3.12+ and Redis: the backend keeps rounds and sessions there, and starting a round fails without it. Docker is the easy way to get Redis.

```bash
# 1. Redis
docker compose up -d

# 2. Python packages (the same pinned set as the hosted game)
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r deploy/requirements.txt

# 3. Optional keys: cp .env.example .env, then fill in what you have (see below)

# 4. The backend, with the real model (USE_STUBS defaults to true)
USE_STUBS=false uvicorn server.main:app --port 8000

# 5. In another terminal: the game, pointed at the backend
API_UPSTREAM=http://127.0.0.1:8000 python prototype/serve.py
```

Open http://localhost:8765. `http://localhost:8000/health` shows the live model version, and `http://localhost:8000/report` shows the model report. Without `API_UPSTREAM`, add `?api=http://localhost:8000` to the game's URL instead.

The trained versions ship in `ml/online/models/`, so none of this needs the Kaggle dataset. Training and retraining do: see [ml/online/README.md](ml/online/README.md).

### Everything in one container

```bash
docker build -t forged .
docker run -p 10000:10000 forged
```

Open http://localhost:10000. This is what Render runs: `render.yaml` deploys it as one free web service. The hosted game judges with the shipped versions and doesn't retrain, because there's no training data in the image.

### Environment variables

All optional. The game and the backend run without any of them.

| Variable | What it does |
| --- | --- |
| `USE_STUBS` | `false` serves the real model and services; `true` (the default) serves canned responses |
| `REDIS_URL` | Redis connection, default `redis://localhost:6379` |
| `ANTHROPIC_API_KEY` | Claude for the clerk, the NPCs, Gus's lines and the report's briefing; without it, canned lines |
| `CARTESIA_API_KEY` | Cartesia NPC voices; without it, the browser's own voice |
| `CRS_USERNAME`, `CRS_PASSWORD` | Live CRS sandbox calls for the identity check. Without them, the answers saved in `ml/online/crs_cache.json` and an offline mirror of the sandbox. Keep the quotes in `.env` |
| `SENTRY_DSN` | Sentry error tracking for the backend |
| `API_UPSTREAM` | Makes `prototype/serve.py` pass API calls to this backend and point the game at it |
| `PORT` | The game server's port (default 8765; Render sets it) |
| `FORGED_RETRAIN_EVERY` | Wins between background retrains (default 25) |
| `FORGED_DATA_DIR` | Where player orders are saved (default `server/data/`, as `ieee_rows.csv`) |
| `FORGED_CRS` | `off` never calls the CRS sandbox, even with the keys |

### Tests

```bash
python -m pytest ml/online/tests server/tests prototype/tests -q
```

---

## API

The game uses these; the full shapes are in `server/models/schemas.py` and at `/docs` on a running backend.

| Method | Path | What it does |
| --- | --- | --- |
| `POST` | `/round/start` | Start a round: the leaked memo (two of the live model's real rules and a decoy), the live version |
| `POST` | `/preview` | Gus's gut feeling: the same score, nudges and threshold as the verdict, without saving anything |
| `POST` | `/submit` | Judge a campaign of orders: verdict and reasons per order, payout; saves the rows for retraining |
| `POST` | `/clerk` | Talk to the support clerk: reply and persuasion score |
| `POST` | `/npc/chat`, `/npc/voice`, `/npc/speak` | Talk to the office NPCs, by text or voice |
| `GET` | `/patch-notes`, `/metrics` | What each version learned; each version's test results |
| `GET` | `/leaderboard` | Player standings |
| `GET` | `/health` | Backend status, live model version, whether it can learn here, where CRS answers come from |
| `GET` | `/report` | The model report page |

## Sponsor tracks

Cal Hacks 13 tracks this project is built for, and the evidence for each:

| Track | What Forged shows |
| --- | --- |
| **Hyphenate: Autonomous Systems for Finance** | A fraud model on real data that retrains itself from attacks behind a safety gate, explains every decision, records every version, and is honest about what's real and what's simulated (`ml/online/README.md`, the model report) |
| **CRS: Best Identity / Fraud Innovation** | Gus checks every order's identity with the CRS sandbox (TruValidate and Fraud Finder) as model inputs. On the same data, CRS cuts honest shoppers blocked from 4.2% to 2.9% and catches every attack on a deceased, synthetic or mismatched identity |
| **Anthropic** | Claude writes Gus's and the NPCs' lines, scores the clerk conversation, and writes the model report's analyst briefing. The whole project was built with Claude Code |
| **Cartesia** | The office NPCs speak and listen through Cartesia |

## Team and branches

- Branches are `a/…`, `b/…`, `c/…`, `d/…` (by teammate) or `feat/…`. Merge to `main` through pull requests; `main` must always run.
- Don't edit someone else's area without asking. If you're blocked for more than 30 minutes, say so in the group chat.
