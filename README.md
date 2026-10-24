# Forged

A browser-based 3D office game about online-order fraud. You sit at your desk, build fake orders on your in-game computer, and sneak them past Gus, a live LightGBM fraud model trained on 100k+ real transactions. Every time you fool him, he retrains on your trick and comes back smarter. The game gets harder because of how you play.

The twist: while players think they're gaming, every order they send is a labeled row in the IEEE-CIS fraud dataset format. Forged turns adversarial red-teaming into a game loop -- the same idea behind reCAPTCHA (labeling books), Pokemon Go (mapping the world), and Duolingo (translating the web).

- **Playable prototype and LAN/online multiplayer:** [prototype/](prototype/) ([prototype README](prototype/README.md))
- **Design document:** [Forged Game Design Doc (v1.0).md](<Forged%20Game%20Design%20Doc%20(v1.0).md>)

---

## What it is

A third-person office where you walk around, sit at your desk, forge checkout orders on a fake e-commerce site, print them, carry the slip past your boss, and hand it to Gus the inspector. Gus is backed by a real fraud model. Beat him and he retrains. Get caught and he tells you why.

Everything you see is built from Three.js boxes, cylinders and spheres -- no art assets, no 3D models, no textures. All sound is synthesized in real-time with the WebAudio API -- no audio files. NPCs talk back using Web Speech synthesis, and you can talk to them with your microphone. Up to 4 players share one office over WebSockets.

---

## Tech stack

| Layer | Technology |
| --- | --- |
| 3D office | Three.js r128 (CDN), all geometry from primitives |
| Audio | WebAudio API (all synthesized: footsteps, doors, printer, heartbeat, ambient) |
| Voice | Web Speech API (SpeechSynthesis for NPC replies, SpeechRecognition for player mic input) |
| In-game computer | Vanilla HTML/CSS/JS, runs in an iframe, communicates via postMessage |
| Multiplayer | WebSocket server in `serve.py` (Python stdlib), up to 4 players per room |
| Backend | FastAPI (Python 3.12), serves fraud model predictions and round state |
| Fraud model | LightGBM (500 estimators, 0.04 learning rate, 63 leaves), trained on IEEE-CIS Kaggle data |
| Identity check | TransUnion TruValidate IDV + AtData Fraud Finder via CRS sandbox API |
| State | Redis (in-memory, embedded in the Docker container) |
| NPC dialogue | Claude API (Anthropic) for clerk scoring and inspector lines, with canned fallbacks |
| Error tracking | Sentry |
| Deploy | Docker on Render (free tier), one container runs the game server, FastAPI, and Redis |

---

## Architecture

```
Browser
  +---------------------+    postMessage    +-------------------+
  | index.html          | <===============> | os.html           |
  | Three.js office     |                   | FORGED OS         |
  | world.js (144 KB)   |                   | game.js (94 KB)   |
  | player, boss, Gus,  |                   | checkout, memo,   |
  | printer, corkboard,  |                   | orders.js, clerk  |
  | multiplayer (lan.js) |                   | chat, shop, ranks |
  +----------+----------+                   +---------+---------+
             |                                        |
             | WebSocket (lan.js)                     | fetch (/submit, /preview, /round/start)
             v                                        v
  +---------------------+             +------------------------------+
  | serve.py            |  proxies    | FastAPI (server/)            |
  | static files + WS   | ---------> | /submit    -> ml.detector    |
  | LAN room logic      |  /api/*    | /preview   -> ml.online      |
  | (lan_room.py)       |            | /clerk     -> Claude API     |
  +---------------------+            | /health    -> model status   |
                                     +-------------+----------------+
                                                   |
                              +--------------------+--------------------+
                              v                    v                    v
                        +-----------+     +--------------+     +--------+
                        | Redis     |     | ml/online/   |     | Claude |
                        | rounds,   |     | LightGBM v4  |     | API    |
                        | sessions  |     | CRS identity |     |        |
                        +-----------+     +--------------+     +--------+
```

---

## The fraud model

Two ML systems live in `ml/`:

### Online fraud model (`ml/online/`) -- the live one

A LightGBM classifier trained on the IEEE-CIS Kaggle fraud dataset (100,963 real credit card transactions) plus simulated and real player orders. This is the model that judges every order in the game.

**Training data mix:**
- 100,963 real transactions from IEEE-CIS (the foundation)
- ~7,300 honest simulated shoppers (so the model doesn't learn "all game orders are fraud")
- ~5,500 simulated attackers with varied strategies
- ~2,300 real player orders collected during playtesting

**Model specs:**
- LightGBM with 500 estimators, learning rate 0.04, max 63 leaves
- Features: transaction amount, time-of-day, card type, device fingerprint, shipping distance, email domain age, CRS identity risk score, and ~40 more
- Evasion weight 3x (player tricks that got through are weighted triple during retraining)
- Per-player cap of 300 rows (prevents one player from dominating the training set)

**Identity verification (v3+):**
- TransUnion TruValidate IDV: checks if the name, address, SSN and DOB belong to a real person
- AtData Fraud Finder: email-based risk score
- 228 cached sandbox answers in `crs_cache.json`; falls back to an offline mirror when the API is down

**Benchmarks (v4, current live version):**

| Metric | Value |
| --- | --- |
| Real fraud recall (IEEE-CIS test set) | 64.3% at 3.6% FPR |
| Simulated attacker catch rate | 96.3% |
| Real player catch rate | 97.2% |
| Game false positive rate | 2.0% |

The model catches 97% of player attacks while only falsely flagging 2% of honest orders. Real-world recall on unseen IEEE-CIS fraud is 64% -- competitive for a model that also has to handle creative human attacks it has never seen before.

**Retrain loop and promotion gates:**

When a player fools Gus, the order is queued. After enough wins, the model retrains. A new version is only promoted if it passes all gates:
- Real recall must not drop more than 5% from the current version
- Real FPR must stay at or below 4%
- Game FPR must stay at or below 5%
- Player catch rate must improve on 30+ held-out orders

### Invoice fraud model (`ml/detector.py`) -- the original

A logistic regression classifier with 34 features and Platt calibration, plus a kNN memory system (K=10, cosine similarity) that adds 3 memory features per session. This was the first model, trained on synthetic invoice data for the Sunny Diner level. It is not included in the Docker image; the hosted version uses the online model exclusively. When running locally without the online model, the game falls back to a scripted rule-based Gus.

---

## Running locally

### Prerequisites

- Python 3.11+

### Quick start (game only, no backend)

```bash
cd prototype
python serve.py
# Open http://localhost:8765
```

This runs the game with the scripted Gus (rule-based, no ML). Add `?lan` for multiplayer.

### With the real fraud model

```bash
# 1. Install Python dependencies
pip install -r deploy/requirements.txt

# 2. Start the backend
USE_STUBS=false uvicorn server.main:app --reload --port 8000

# 3. In another terminal, start the game server pointing at the backend
cd prototype
python serve.py
# Open http://localhost:8765/?api=http://localhost:8000
```

Or connect the game directly: open `http://localhost:8765/?api=http://localhost:8000`.

### With Docker (full stack, same as production)

```bash
docker build -t forged .
docker run -p 10000:10000 forged
# Open http://localhost:10000
```

This runs the game server, FastAPI backend, Redis, and the live fraud model in one container.

### Environment variables

| Variable | Required? | What it does |
| --- | --- | --- |
| `USE_STUBS` | No | `true` = stub responses (default), `false` = real ML model |
| `REDIS_URL` | No | Redis connection (default: `redis://localhost:6379`) |
| `ANTHROPIC_API_KEY` | No | Claude API for clerk scoring and inspector dialogue |
| `SENTRY_DSN` | No | Error tracking |
| `RETRAIN_THRESHOLD` | No | Submissions before auto-retrain (default 5) |

No API keys are required. Without them, the game falls back to canned clerk replies, scripted inspector lines, and the rule-based Gus.

---

## Deployment

The `Dockerfile` at the repo root bundles everything into one container:
- `prototype/serve.py` on `$PORT` (default 10000) -- the game and WebSocket multiplayer
- FastAPI on `127.0.0.1:8000` -- the fraud model and round API
- `redis-server` -- in-memory state for rounds and sessions

`render.yaml` is a Render Blueprint that deploys from this Dockerfile on the free tier. Auto-deploys on every push. The free plan sleeps after 15 idle minutes; waking takes about a minute.

A lighter game-only image is at `prototype/Dockerfile` -- just the game with the scripted Gus, no backend.

---

## Project structure

```
Forged/
+-- prototype/               # The game (all client-side)
|   +-- index.html           # Entry point
|   +-- world.js             # 3D office: player, boss, Gus, furniture, collisions
|   +-- world.css            # Office HUD, monitor bezel, start screen, minimap
|   +-- os.html              # In-game computer (runs in iframe)
|   +-- game.js              # Computer UI: checkout, memo, chat, verdicts, shop
|   +-- style.css            # Computer screen styles
|   +-- orders.js            # Order content, IEEE-CIS row builder, scripted Gus
|   +-- audio.js             # All game audio (WebAudio synthesis)
|   +-- voice.js             # Voice chat with NPCs (Web Speech API)
|   +-- customize.js/css     # Character customization screen
|   +-- menu.js/css          # Esc menu, options, controls, dossier
|   +-- keys.js              # Rebindable keybindings
|   +-- features.js          # Feature display for orders
|   +-- lan.js/css           # WebSocket multiplayer client
|   +-- serve.py             # Static server + WebSocket room host
|   +-- lan_room.py          # Room rules (boss sync, shared Gus, shirts)
|   +-- lan_ws.py            # WebSocket frame handler (stdlib)
|   +-- Dockerfile           # Game-only container
|   +-- README.md            # Prototype docs, LAN/online multiplayer guide
|
+-- server/                  # FastAPI backend
|   +-- main.py              # App entry, CORS, Sentry, model warming
|   +-- config.py            # Environment variables
|   +-- stubs.py             # Hardcoded stub responses for offline dev
|   +-- routes/
|   |   +-- round.py         # POST /round/start, /submit, /preview
|   |   +-- clerk.py         # POST /clerk, /clerk/voice
|   |   +-- meta.py          # GET /patch-notes, /metrics, /leaderboard
|   +-- services/
|       +-- game_state.py    # Redis state management
|       +-- online_data.py   # Fraud model interface
|
+-- ml/                      # ML models
|   +-- detector.py          # Invoice fraud model (logistic regression + kNN)
|   +-- online/              # Online fraud model (LightGBM on IEEE-CIS)
|       +-- model.py         # Model loading, prediction, versioning
|       +-- features.py      # Feature engineering from checkout data
|       +-- train.py         # Train v1 from scratch
|       +-- retrain.py       # Retrain on player orders with promotion gates
|       +-- crs.py           # CRS identity verification (TransUnion, AtData)
|       +-- report.py/html   # Attack analysis and model report
|       +-- briefing.py      # Claude-generated analyst briefing
|       +-- robustness.py    # Red-team testing and hardening
|       +-- models/          # Saved model versions (v1-v4.joblib)
|
+-- deploy/
|   +-- requirements.txt     # Pinned Python dependencies for production
|   +-- start.sh             # Container entrypoint (starts all 3 services)
|
+-- Dockerfile               # Full stack: game + backend + Redis
+-- render.yaml              # Render Blueprint for one-click deploy
+-- docs/                    # API contracts and design specs
```

---

## How the game works

1. Walk to your desk, press E to sit. The camera moves in and the computer takes over.
2. Fill in a checkout order one field at a time: what you buy, who you pretend to be, what device you use, where you ship. Gus's gut-feeling face reacts as you type.
3. Print the order slip. You stand up automatically.
4. Grab the slip at the printer (E), carry it across the office past the boss, drop it in Gus's IN tray (E).
5. Gus stamps it APPROVED or DECLINED, circles the rows that gave you away, and tells you why in plain words.
6. Your trick gets pinned to the corkboard. If you fooled Gus, his version ticks up and he retrains.

The boss patrols the office with a vision cone. Get caught forging or carrying the slip and your heat goes up. Fire drills happen randomly -- everyone evacuates for a coffee run and comes back.

Ranks unlock checkout fields progressively (Rookie sees 2 fields, Mastermind sees all 8), so new players aren't overwhelmed.

### Multiplayer

Up to 4 players share one office over WebSockets. The boss, Gus, verdicts, and the corkboard are shared. Everyone sees each other walking around in their customized character. One player's trick that fools Gus makes him harder for everyone.

### Voice chat

Hold the mic key to talk to NPCs. They hear you through the Web Speech API, process what you said, and reply with synthesized voices. The clerk NPC scores your pitch for how convincing it sounds.

---

## API endpoints

| Method | Path | What it does |
| --- | --- | --- |
| `POST` | `/round/start` | Start a round: get memo rules, case file, inspector version |
| `POST` | `/submit` | Submit an order, get verdict + tells + payout |
| `POST` | `/preview` | Preview: get Gus's gut feeling without committing |
| `POST` | `/clerk` | Text chat with the clerk, get reply + persuasion score |
| `POST` | `/clerk/voice` | Voice chat (STT -> scoring -> TTS) |
| `GET` | `/patch-notes` | What each model version learned |
| `GET` | `/metrics` | Per-version catch rate, FP rate |
| `GET` | `/leaderboard` | Player rankings |
| `GET` | `/health` | Server status + model version |
| `GET` | `/report` | Fraud model analysis report |

---

## Version history

### v4 (current, live)
Retrained on live CRS sandbox answers. Fixed v3's over-blocking of honest shoppers (28.4% false block rate down to 2.0%). Player catch rate 97.2%.

### v3
Added CRS identity verification (TransUnion TruValidate + AtData Fraud Finder). Player catch rate jumped from 54% to 97%.

### v2
First retrain on 300 real player orders. Learned `new_address`, `gift_card`, `far_ship` patterns.

### v1
Baseline trained on IEEE-CIS data + simulated shoppers. Real recall 64.8% at 3.6% FPR.
