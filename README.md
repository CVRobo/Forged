# Forged: the next 24 hours

You are a fraudster in a third-person office. You sit at your computer to build fake online orders with stolen cards, print the order slip, and carry it past the boss to **Gus**, the shop's risk engine. Every time you beat Gus, he retrains on your trick and comes back smarter.

Gus is a real fraud model: LightGBM trained on the IEEE-CIS dataset (590K real transactions). He checks every buyer's identity with the CRS Credit API, explains every verdict in game terms, and a new version only goes live if it stays fair to honest customers.

- Playable game: [prototype/](prototype/) (controls and the full round in [prototype/README.md](prototype/README.md))
- The fraud model: [ml/online/README.md](ml/online/README.md), and the model report at `/report` on the backend
- Why the game moved from invoices to online orders: [docs/online-fraud-redesign.md](docs/online-fraud-redesign.md)
- Which model and why: [docs/ml-model-choice.md](docs/ml-model-choice.md)
- API contracts: [docs/contracts.md](docs/contracts.md)
- Original design: [Forged Game Design Doc (v0.1).md](Forged%20Game%20Design%20Doc%20(v0.1).md)

---

## Team

| | Role | Owns | Name |
| --- | --- | --- | --- |
| **A** | Backend / lead | `server/`, `deploy/`, `Dockerfile`, `render.yaml`, Claude and Cartesia integration | |
| **B** | ML (invoice detector), multiplayer, hosting | `ml/*.py` (invoice detector), LAN rooms (`prototype/lan*`), hosted backend, "Gus is learning" panel | |
| **C** | Computer UI ("FORGED OS") and office features | `prototype/os.html`, `game.js`, `style.css`, desks, customization, doors | |
| **D** | 3D office, then the online fraud model | `prototype/index.html`, `world.js`, `world.css`; `ml/online/` | |

The plan had the game rebuilt in Next.js (`frontend/`). We kept the prototype instead: it already played well, and plain JS let everyone ship without a build step. `frontend/` is still the empty scaffold.

---

## Tech stack

| Layer | Technology | Sponsor track |
| --- | --- | --- |
| Game client | Plain HTML, CSS and JavaScript (no build step) + **Three.js r128** from a CDN | |
| Game server and multiplayer | Python standard library: `prototype/serve.py` (static files, caching off), a WebSocket server for rooms of 4, and a pass-through to the backend | |
| Backend | **FastAPI** 0.162 + Uvicorn + Pydantic 2 | |
| State | **Redis**: rounds, sessions, leaderboard (sorted sets), NPC conversations, retrain queue, inspector memory | |
| Fraud model | **LightGBM** 4.7 + pandas, NumPy, scikit-learn, joblib, on the **IEEE-CIS** dataset; Node.js runs the game's own code for simulated shoppers | **Hyphenate** |
| Identity check | **CRS Credit API** sandbox: TransUnion TruValidate + AtData Fraud Finder, as model inputs | **CRS** |
| LLM | **Claude API** (`anthropic` SDK): `claude-haiku-4-5` for the clerk, NPCs, Gus's lines, the memo decoy and the validity check; `claude-opus-5-5` for the model report's analyst briefing | **Anthropic** |
| Voice | **Cartesia** speech-to-text + text-to-speech for the clerk and the office NPCs; the browser's Web Speech API when there's no key | **Cartesia** |
| Error tracking | **Sentry** (backend), when `SENTRY_DSN` is set | |
| Deploy | **Docker**, one container (game server + backend + Redis) on **Render** (free plan, Blueprint) | |

### Why these choices

**Plain JS over Next.js:** The prototype proved the game works, and porting it to Next.js would have cost the hours we spent on the game itself. The office and the computer are still separate pages that only talk through `postMessage`, so C and D never touch each other's files, which is what the Next.js routes were for.

**FastAPI over Express:** The fraud model (Python) and the Claude API run in the same process. FastAPI gives Pydantic validation, OpenAPI docs at `/docs`, and async calls to Claude, Cartesia and CRS.

**Redis beyond caching:** game state hashes, leaderboard sorted sets, the retrain queue, version tracking, inspector memory and NPC conversations. Vector search over past invoices belonged to the invoice game and was dropped with it.

**Cartesia for voice (instead of Deepgram):** One API for both directions (speech-to-text and text-to-speech) over plain `httpx`, which keeps the hosted image small. The NPCs and the clerk talk through it; without a key, the browser's own voice speaks, so the game never goes silent.

**LightGBM on IEEE-CIS:** A real fraud dataset makes Gus a real fraud model, not a game rule. LightGBM is what wins on this data, trains in seconds (so Gus can retrain during play), and explains every score per feature, which becomes Gus's reasons in the game.

**CRS for identity:** Gus's blind spot is who the buyer really is. The CRS sandbox answers exactly that, and every victim in the game is a CRS test person.

**Not used anymore:** Deepgram (replaced by Cartesia; `server/services/deepgram_service.py` is no longer called), Arize Phoenix (in `server/requirements.txt`, never imported), the Next.js `frontend/`, and the invoice detector in `ml/*.py` (the original invoice game; the server still serves it for invoice submissions, but the game now sends online orders).

---

## Project structure

```
Forged/
├── prototype/                # The game (plain JS, no build)
│   ├── index.html, world.js  # 3D office: player, desks, printer, boss, Gus's booth, NPCs (D)
│   ├── os.html, game.js      # FORGED OS: the typed checkout, Gus's gut feeling, verdicts, shop (C)
│   ├── orders.js             # Shops, stolen cards (CRS test people), checkout → IEEE-CIS rows, scripted Gus
│   ├── serve.py              # Local server + pass-through to the backend (API_UPSTREAM)
│   ├── lan.js, lan_ws.py, lan_room.py   # Multiplayer rooms of 4 (B)
│   ├── voice.js, voice-server.js        # Talk to the NPCs: browser speech, or the backend's Cartesia voice
│   └── learning.html/js      # "Gus is learning": the model's versions (B)
│
├── server/                   # FastAPI backend (A)
│   ├── main.py               # App entry, CORS, Sentry, /health, /report
│   ├── config.py             # Env vars
│   ├── stubs.py              # Canned responses (USE_STUBS=true)
│   ├── models/schemas.py     # Pydantic models
│   ├── routes/
│   │   ├── round.py          # POST /round/start, /submit, /preview
│   │   ├── clerk.py          # POST /clerk, /clerk/voice
│   │   ├── npc.py            # POST /npc/chat, /npc/voice, /npc/speak
│   │   └── meta.py           # GET /patch-notes, /metrics, /leaderboard
│   └── services/
│       ├── online_data.py    # The fraud model behind /submit and /preview, background retrains
│       ├── game_state.py     # Redis state
│       ├── claude_service.py, npc_voice.py   # Claude: clerk, NPCs, lines, memo, validity
│       └── cartesia_service.py               # Speech-to-text / text-to-speech
│
├── ml/
│   ├── online/               # The fraud model (D): features, training, retrain gate, CRS check,
│   │                         # red-team harness, report, shipped versions models/v1–v4
│   └── *.py                  # The invoice detector (B), from the invoice game
│
├── frontend/                 # Next.js scaffold (unused)
├── deploy/                   # Hosted image: requirements + start script
├── docs/                     # Design notes, contracts, specs
├── Dockerfile, render.yaml   # The hosted game in one container, on Render
├── docker-compose.yml        # Local Redis
└── .env.example              # Env vars, documented
```

---

## Running locally

### Prerequisites

- Python 3.12+
- Docker (for Redis), only to run the backend
- Node.js 18+, only to train the model

### Quick start

```bash
# Just the game: a scripted Gus in the browser judges the orders
python prototype/serve.py
# Opens at http://localhost:8765
```

With the real fraud model:

```bash
# 1. Copy env file. Every key is optional.
cp .env.example .env

# 2. Start Redis (the backend keeps rounds there; starting a round fails without it)
docker compose up -d

# 3. Install and start the backend with the real model
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r deploy/requirements.txt
USE_STUBS=false uvicorn server.main:app --port 8000

# 4. In another terminal, start the game pointed at the backend
API_UPSTREAM=http://127.0.0.1:8000 python prototype/serve.py
# Opens at http://localhost:8765
```

Everything in one container (what Render runs):

```bash
docker build -t forged .
docker run -p 10000:10000 forged
# Opens at http://localhost:10000
```

The trained versions ship in `ml/online/models/`, so playing never needs the Kaggle dataset. Training does: see [ml/online/README.md](ml/online/README.md).

### What each env var does

| Variable | Required? | What it does |
| --- | --- | --- |
| `USE_STUBS` | — | `false` = the real model and services, `true` (default) = canned responses |
| `REDIS_URL` | No | Redis connection (defaults to `redis://localhost:6379`) |
| `ANTHROPIC_API_KEY` | No | Claude for the clerk, NPCs, Gus's lines, memo decoy, validity gate, report briefing |
| `CARTESIA_API_KEY` | No | Cartesia voices for the clerk and NPCs; without it, the browser's voice |
| `CRS_USERNAME`, `CRS_PASSWORD` | No | Live CRS sandbox calls; without them, the saved answers in `ml/online/crs_cache.json`. Keep the quotes |
| `SENTRY_DSN` | No | Error tracking (backend) |
| `API_UPSTREAM` | No | Makes `prototype/serve.py` pass API calls to this backend and point the game at it |
| `PORT` | No | The game server's port (default 8765; Render sets it) |
| `FORGED_RETRAIN_EVERY` | No | Wins between background retrains (default 25) |
| `FORGED_DATA_DIR` | No | Where player orders are saved (default `server/data/ieee_rows.csv`) |
| `FORGED_CRS` | No | `off` never calls the CRS sandbox, even with keys |
| `RETRAIN_THRESHOLD` | No | Invoice game only: submissions before a retrain (default 5) |

**The game needs zero API keys.** Every service has a fallback, so a missing key never breaks a round.

### Verifying everything works

```bash
# Health: the live model version, whether it can learn here, where CRS answers come from
curl http://localhost:8000/health

# Start a round (needs Redis): leaked memo from the live model, version
curl -s -X POST http://localhost:8000/round/start \
  -H 'Content-Type: application/json' \
  -d '{"level":1}' | python -m json.tool

# Gus's gut feeling on one order: a quiet order on Harold Pettigrew, a deceased CRS test person
curl -s -X POST http://localhost:8000/preview \
  -H 'Content-Type: application/json' \
  -d '{"record":{"mode":"online","level":1,"scheme":"typed","rank":5,"rows":[{"TransactionAmt":50,"ProductCD":"W","crs_id":"P14","buyer_is_holder":true}]}}' | python -m json.tool
# → a high score, with "identity" as the top reason

# Talk to the clerk (text)
curl -s -X POST http://localhost:8000/clerk \
  -H 'Content-Type: application/json' \
  -d '{"round_id":"test","text":"Hey quick question about my order"}' | python -m json.tool

# The model report page, and the interactive API docs
open http://localhost:8000/report
open http://localhost:8000/docs

# Tests
python -m pytest ml/online/tests server/tests prototype/tests -q
```

---

## API endpoints (summary)

Full shapes in `server/models/schemas.py` and at `/docs`.

| Method | Path | What it does |
| --- | --- | --- |
| `POST` | `/round/start` | Start a round: leaked memo (two of the live model's real rules + a decoy), Gus's version |
| `POST` | `/preview` | Gus's gut feeling while you type: the verdict's own score and threshold, nothing saved |
| `POST` | `/submit` | Judge the orders: verdict and reasons per order, payout; saves the rows for retraining |
| `POST` | `/clerk` | Text to the support clerk, get reply + persuasion score |
| `POST` | `/clerk/voice` | Voice to the clerk (Cartesia STT → Claude → Cartesia TTS) |
| `POST` | `/npc/chat`, `/npc/voice`, `/npc/speak` | Talk to the office NPCs, by text or voice |
| `GET` | `/patch-notes?since=v` | What each Gus version learned |
| `GET` | `/metrics` | Per-version real fraud caught, honest customers blocked, held-out attacks caught |
| `GET` | `/leaderboard` | Player rankings |
| `GET` | `/health` | Server status, live model version, stubs on or off |
| `GET` | `/report` | The model report page |

---

## How the pieces connect

```
┌──────────────────────────────────────────────────────────────┐
│  Browser                                                     │
│  ┌───────────────────┐   postMessage   ┌──────────────────┐  │
│  │  index.html       │ ◄─────────────► │  os.html (iframe) │  │
│  │  3D office (D)    │                 │  FORGED OS (C)    │  │
│  │  Three.js, voice  │                 │  checkout, Gus    │  │
│  └─────────┬─────────┘                 └────────┬─────────┘  │
└────────────┼────────────────────────────────────┼────────────┘
             │ WebSocket (rooms of 4)             │ fetch
             ▼                                    ▼
   ┌──────────────────────────────────────────────────────┐
   │  prototype/serve.py :8765   game files, rooms,        │
   │                             pass-through to the API   │
   └───────────────────────────┬──────────────────────────┘
                               ▼
                 ┌────────────────────────────┐
                 │  FastAPI :8000              │
                 │  /round/start /preview      │
                 │  /submit /clerk /npc/*      │
                 │  /patch-notes /metrics      │
                 └──┬──────┬────────┬───────┬──┘
                    ▼      ▼        ▼       ▼
               ┌──────┐ ┌──────┐ ┌───────┐ ┌──────────────────────┐
               │Redis │ │Claude│ │Cartesia│ │ ml/online            │
               │state │ │lines │ │ voices │ │ LightGBM fraud model │
               │board │ │clerk │ └───────┘ │  ├─ CRS sandbox       │
               │queue │ │NPCs  │           │  └─ retrain + gate    │
               └──────┘ └──────┘           └──────────────────────┘
```

The key architectural rule still holds: **the office and the computer only talk through `postMessage`.** The full message table is in [prototype/README.md](prototype/README.md#how-the-two-halves-talk).

---

## Where each area stands

### A: Backend

**Done:** real routes for rounds, `/submit` and `/preview` on the fraud model, the clerk and NPCs on Claude, Cartesia voices, Sentry, Redis state, the one-container deploy on Render with the real model behind the game.

**Next:** check the Render deploy serves v4 (`/health`), set `ANTHROPIC_API_KEY` and `CARTESIA_API_KEY` there for the demo, warm the service before judging (the free plan sleeps after 15 minutes).

### ML: the fraud model (`ml/online/`)

**Done:** LightGBM on the real IEEE-CIS data (v1), the retrain loop with the safety gate, the red-team harness that hardened v2 (held-out attacks caught 9% → 54%), the CRS identity check (v4, live sandbox), the model report with an AI analyst briefing, and the "Gus is learning" panel. Details in [ml/online/README.md](ml/online/README.md).

**How the server calls it:**
```python
from ml.online import model as M
v = M.load()                      # the newest promoted version
scores = v.scores(rows)           # rows: the game's IEEE-CIS rows
reasons = v.explain(rows)         # per order: [[tell, weight], ...]
```

**Next:** collect real player orders at the event and retrain on them (so far the attack orders came from the red-team search and simulated players), refresh `prototype/gus-versions.json` after each retrain, and test how sensitive the honest-shopper numbers are to the simulated shoppers. Account takeover on a clean identity is still the open weakness, and the report says so.

### C: Computer UI ("FORGED OS")

**Done:** the typed checkout (one question per screen), Gus's gut feeling from the model while you type, verdicts with Gus's reasons, the leaked memo, the support chat, the shop and perks, ranks that unlock the checkout one blank at a time, desks, customization, doors.

**How it talks to the backend** (`game.js`, with `?api=<url>` or `API_UPSTREAM`): `POST /round/start`, `POST /preview` while typing, `POST /submit` with `record.mode = "online"` and one IEEE-CIS row per order. If a call fails or times out, the scripted Gus in `orders.js` answers and a "playing offline" toast shows once.

**Next:** playtest fixes, and test at the demo laptop's and projector's resolution.

### D: 3D Office

**Done:** the office with the boss's patrol and vision cone, the printer and IN tray, Gus's booth close-up ("why I caught you"), the inspector's gear by version, the DETECTOR LIVE TV, NPCs you can talk to, level 2's glass office.

**postMessage: how the office talks to the computer (C):**
```javascript
// Send to the computer (always include src)
osFrame.contentWindow.postMessage({ type: "deliver", src: "forged-world" }, "*");
osFrame.contentWindow.postMessage({ type: "boss-near", src: "forged-world" }, "*");

// Receive from the computer
window.addEventListener("message", (e) => {
  if (e.data.src !== "forged-os") return;
  if (e.data.type === "print") { /* printer starts, slip appears */ }
  if (e.data.type === "verdict") { /* Gus reacts: e.data.caught, e.data.line, e.data.tells */ }
  if (e.data.type === "stand") { /* player stood up from the computer */ }
  if (e.data.type === "hud") { /* money, heat, Gus's version, level */ }
});
```

**Do not add new message types without telling C first.**

**Next:** record the backup demo video, and time a full round (the walk should take 15 seconds or less).

---

## Branch rules

- **Branches:** `a/…`, `b/…`, `c/…`, `d/…` (or `feat/…`). Merge to `main` through small PRs. `main` must always run.
- **Ownership:** Don't edit someone else's files without asking. See the ownership table above.
- **Blocked for more than 30 minutes?** Say so in the group chat. Use the scripted Gus or the stubs while you wait.
- **Sleep:** each person takes one 3-hour block, staggered. Put yours here: A ___ · B ___ · C ___ · D ___

---

## Sponsor checklist

The Cal Hacks 13 tracks we're targeting. Each needs evidence in the demo.

| Track | What we use it for | Evidence needed | Status |
| --- | --- | --- | --- |
| **Hyphenate**: Autonomous Systems for Finance ($8K / $5K / $3K) | A fraud model on real data that retrains itself from attacks behind a safety gate and explains every decision | A demo video that opens with the moment Gus catches a trick he missed before; "what's real, what's simulated, how we know" (`ml/online/README.md`) | Model and report done; video to record |
| **CRS**: Best Identity / Fraud Innovation (interviews) | Gus checks every order's identity with the CRS sandbox, as model inputs | CRS working **live** in the demo: run the backend on the laptop that has the keys in `.env` | Done (v4, live sandbox) |
| **Anthropic** ($5K in credits) | Claude writes Gus's and the NPCs' lines, scores the clerk chat, writes the report's analyst briefing | A named community and a real problem in the pitch: small online shops that can't afford a fraud team | Done; pitch to write |
| **Cartesia** | The clerk and the office NPCs speak and listen through Cartesia | Voice is core, not tacked on; README lists the Cartesia features used | Done; needs `CARTESIA_API_KEY` on the demo machine |
| General: Most Technically Complex, overall | The whole loop: game → real model → learns from players → safety gate | A live demo | — |

Redis, Sentry, Arize and Deepgram were in the first plan's checklist. They aren't Cal Hacks 13 sponsors. Redis and Sentry are still used; Deepgram was replaced by Cartesia; Arize was dropped.

---

## Timeline

### Done

- **Contracts** ([docs/contracts.md](docs/contracts.md)) and the playable prototype.
- **The redesign** from forged invoices to online orders in the IEEE-CIS format ([docs/online-fraud-redesign.md](docs/online-fraud-redesign.md)).
- **One order through every layer:** typed checkout → IEEE-CIS row → the real model's verdict → saved for retraining.
- **The game:** ranks, memo, support chat, perks, corkboard, boss, Gus's booth, level 2, desks, customization, doors.
- **Multiplayer** (rooms of 4, LAN or online) and **hosting** on Render.
- **The fraud model:** v1 on real data, the retrain gate, the red-team harness (v2), the CRS identity check (v4), the model report, "Gus is learning".
- **Voices:** Claude for the NPCs and Cartesia for speech.

### What's next (submission Sunday 9:00 AM, judging 10:30 AM – 12:30 PM)

| | Tasks |
| --- | --- |
| **Everyone** | Draft the Devpost submission tonight and keep editing it until 9 AM. Add every teammate on Devpost. The whole team must be at the table for judging. |
| **A** | Render deploy with v4, `ANTHROPIC_API_KEY` and `CARTESIA_API_KEY` set; warm it before judging. Freeze the backend. |
| **ML** | Retrain on real player orders from playtests. Keep `prototype/gus-versions.json` in sync. Run the CRS demo order live. |
| **C** | Final visual polish. Test at the demo laptop's and projector's resolution. |
| **D** | Record the backup demo video (Hyphenate wants it to open with the moment Gus catches what he missed). Run the 2-minute pitch with a live demo 3 times with the whole team. |

**Branches not merged yet:** `b/ml-generator` (defender mode), `f/changing-room-customizer`. `ML-alt` stays unmerged: it conflicts with `ml/online` and catches 7% of game attacks against 92% ([docs/ml-model-choice.md](docs/ml-model-choice.md)).

---

## Cut line (drop in this order if behind)

Support chat → perks → extra chaos events → level 2 → NPC voices (the browser's voice takes over) → multiplayer → **the 3D office** (`os.html` still plays the whole game on its own, so the demo survives).

**Never cut:** the checkout-to-row pipeline, the real model's verdicts, the memo, Gus's evolution, the held-out evaluation and the safety gate.
