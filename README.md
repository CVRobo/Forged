# Forged: the next 24 hours

You are a master forger in a third-person office. You sit at your computer to forge fake invoices, print them, and carry them past the boss to an AI inspector. Every time you beat the inspector, he's retrained on your trick and comes back smarter.

- Full design: [Forged Game Design Doc (v0.1).md](Forged%20Game%20Design%20Doc%20(v0.1).md)
- API contracts: [docs/contracts.md](docs/contracts.md)
- Playable prototype (no AI yet): [prototype/](prototype/)

---

## Team

| | Role | Owns | Name |
| --- | --- | --- | --- |
| **A** | Backend / lead | `server/`, `content/`, `frontend/src/lib/api.ts`, deploy | |
| **B** | ML | `ml/`, stats page (`frontend/src/app/stats/`) | |
| **C** | Computer UI ("FORGED OS") | `frontend/src/app/os/` and related components | |
| **D** | 3D office | `frontend/src/app/page.tsx` (3D office) or `frontend/public/office/` | |

---

## Tech stack

| Layer | Technology | Sponsor track |
| --- | --- | --- |
| Frontend | Next.js 15 (App Router) + Tailwind CSS + TypeScript | |
| Backend | FastAPI (Python) | |
| State & memory | Redis Cloud (Sorted Sets, RediSearch vector, agent memory) | **Redis** |
| LLM | Claude API (Anthropic) with structured JSON output | **Anthropic** |
| Voice | Deepgram Nova-2 STT + Aura TTS (clerk chat) | **Deepgram** |
| Observability | Arize Phoenix (LLM traces + evals) | **Arize** |
| Error tracking | Sentry (frontend + backend errors + performance) | **Sentry** |
| Deploy | Vercel (frontend) + Render or Fly (backend) + Redis Cloud | |

### Why these choices

**Next.js + Tailwind over raw HTML:** The prototype proved the game works. Now we need route-based code splitting (C's `/os` and D's `/` page live in separate routes), TypeScript for the 20-field invoice record, and Tailwind for fast UI iteration. The iframe + postMessage architecture from the prototype is preserved so C and D never touch each other's files.

**FastAPI over Express:** We need to call the ML model (Python) and the Claude API (best Python SDK) from the same process. FastAPI gives us Pydantic for request validation, automatic OpenAPI docs at `/docs`, and async support. The code is kept portable — no ORM, no metaclasses, all types in one file — so we can port to Go/Rust later if needed.

**Redis for 5 things (not just caching):** The Redis sponsor track requires "beyond caching." We use Redis for: (1) game state hashes, (2) leaderboard sorted sets, (3) retrain queue lists, (4) version tracking, (5) inspector memory. Vector search over past invoices comes in hours 16-20.

**Deepgram for voice clerk chat:** The clerk conversation is core gameplay (you persuade the clerk to approve your invoice). Adding voice makes it feel like talking to a real office worker. STT transcribes your voice, the existing clerk logic scores it, TTS speaks the reply. It's not tacked on — it's the primary interaction method.

---

## Project structure

```
Forged/
├── frontend/                 # Next.js + Tailwind app
│   ├── src/
│   │   ├── app/
│   │   │   ├── layout.tsx    # Root layout
│   │   │   ├── page.tsx      # 3D office (D owns)
│   │   │   ├── os/           # Computer UI route (C owns)
│   │   │   └── stats/        # Live ML stats page (B owns)
│   │   └── lib/
│   │       └── api.ts        # Typed fetch wrapper for backend (A provides)
│   ├── sentry.*.config.ts    # Sentry auto-instrumentation
│   └── package.json
│
├── server/                   # FastAPI backend (A owns)
│   ├── main.py               # App entry, CORS, Sentry, USE_STUBS routing
│   ├── config.py             # All env vars
│   ├── stubs.py              # Hardcoded stub responses (unblocks team)
│   ├── models/
│   │   └── schemas.py        # Pydantic models (single source of truth)
│   ├── routes/
│   │   ├── round.py          # POST /round/start, POST /submit
│   │   ├── clerk.py          # POST /clerk, POST /clerk/voice
│   │   └── meta.py           # GET /patch-notes, /metrics, /leaderboard
│   └── services/
│       ├── game_state.py     # Redis state management
│       └── deepgram_service.py  # STT/TTS wrapper
│
├── ml/                       # ML models and training (B owns)
│   ├── detector.py           # predict(record), retrain(examples)
│   ├── generator.py          # Invoice dataset generation
│   └── data/                 # Training data
│
├── content/                  # JSON content pools (A owns)
├── docs/
│   └── contracts.md          # API contract (everyone agrees before changing)
├── prototype/                # Original prototype (read-only reference)
├── docker-compose.yml        # Local Redis
└── .env.example              # All env vars documented
```

---

## Running locally

### Prerequisites

- Python 3.11+
- Node.js 18+
- Docker (for Redis)

### Quick start

```bash
# 1. Copy env file
cp .env.example .env
# Fill in any API keys you have. The stub server works without any keys.

# 2. Start Redis (requires Docker)
docker compose up -d

# 3. Start the backend (stub mode — no ML, Claude, or Deepgram needed)
cd server
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cd ..
USE_STUBS=true uvicorn server.main:app --reload --port 8000

# 4. In another terminal, start the frontend
cd frontend
npm install
npm run dev
# Opens at http://localhost:3000
```

### What each env var does

| Variable | Required for stubs? | What it does |
| --- | --- | --- |
| `REDIS_URL` | No | Redis connection (defaults to `redis://localhost:6379`) |
| `ANTHROPIC_API_KEY` | No | Claude API for clerk scoring, inspector lines, validity gate |
| `DEEPGRAM_API_KEY` | No | Voice clerk chat (STT + TTS) |
| `ARIZE_SPACE_KEY` | No | Arize Phoenix LLM tracing |
| `ARIZE_API_KEY` | No | Arize Phoenix LLM tracing |
| `CRS_USERNAME`, `CRS_PASSWORD` | No | CRS sandbox for Gus's identity check (`ml/online/crs.py`); without them, an offline mirror of the sandbox answers |
| `SENTRY_DSN` | No | Error tracking (backend) |
| `NEXT_PUBLIC_SENTRY_DSN` | No | Error tracking (frontend) |
| `NEXT_PUBLIC_API_URL` | No | Backend URL (defaults to `http://localhost:8000`) |
| `USE_STUBS` | — | `true` = stub responses, `false` = real backend |
| `RETRAIN_THRESHOLD` | No | Submissions before auto-retrain (default 5) |

**The stub server needs zero API keys.** It returns hardcoded responses derived from the prototype so C and D can build immediately.

### Verifying everything works

```bash
# Health check
curl http://localhost:8000/health

# Start a round
curl -s -X POST http://localhost:8000/round/start \
  -H 'Content-Type: application/json' \
  -d '{"level":1}' | python3 -m json.tool

# Talk to the clerk (text)
curl -s -X POST http://localhost:8000/clerk \
  -H 'Content-Type: application/json' \
  -d '{"round_id":"test","text":"Hey quick sandwich question"}' | python3 -m json.tool

# Talk to the clerk (voice — stub returns canned transcript)
curl -s -X POST http://localhost:8000/clerk/voice \
  -H 'Content-Type: application/json' \
  -d '{"round_id":"test","audio_b64":"SGVsbG8="}' | python3 -m json.tool

# Submit an invoice
curl -s -X POST http://localhost:8000/submit \
  -H 'Content-Type: application/json' \
  -d '{"round_id":"test","record":{"level":1,"scheme":"changed_bank","vendor":"Pancake Pete","amount":1500,"bank_account":"9999","sender_domain":"petesflour.com","invoice_no":"INV-001","po_number":"","date":"Fri Oct 23","line_items":["Flour x10"],"field_altered":["bank"],"legibility":{"header":1,"meta":1,"items":1,"bank":0.4,"footer":1},"scan_quality":0.9,"copy_generation":1,"stamp_type":["APPROVED"],"stamp_position":[[100,100]],"domain_mismatch":false,"letterhead_match":true,"cover_email":"Quick payment","heat":10}}' | python3 -m json.tool

# Interactive API docs
open http://localhost:8000/docs
```

---

## API endpoints (summary)

Full details with example JSON in [docs/contracts.md](docs/contracts.md).

| Method | Path | What it does |
| --- | --- | --- |
| `POST` | `/round/start` | Start a round: get memo, case file, inspector version |
| `POST` | `/clerk` | Send text to the clerk, get reply + persuasion score |
| `POST` | `/clerk/voice` | Send voice audio to clerk (Deepgram STT → clerk → TTS) |
| `POST` | `/submit` | Submit forged invoice, get verdict + tells + payout |
| `GET` | `/patch-notes?since=v` | What each inspector version learned |
| `GET` | `/metrics` | Per-version catch rate, FP rate, held-out rate |
| `GET` | `/leaderboard` | Player rankings by money and patches caused |
| `GET` | `/health` | Server status + whether stubs are active |

---

## How the pieces connect

```
┌─────────────────────────────────────────────────────────┐
│  Browser                                                │
│  ┌──────────────────┐    postMessage    ┌─────────────┐ │
│  │  / (3D office)   │ ◄──────────────► │  /os (desk)  │ │
│  │  D owns this     │                  │  C owns this │ │
│  │  Three.js        │                  │  React       │ │
│  └──────────────────┘                  └──────┬───────┘ │
│                                                │        │
└────────────────────────────────────────────────┼────────┘
                                                 │ fetch (api.ts)
                                                 ▼
                                    ┌────────────────────┐
                                    │  FastAPI :8000      │
                                    │  /round/start       │
                                    │  /clerk             │
                                    │  /clerk/voice ──────┼──► Deepgram STT/TTS
                                    │  /submit            │
                                    │  /patch-notes       │
                                    │  /metrics           │
                                    │  /leaderboard       │
                                    └───────┬─────────────┘
                                            │
                        ┌───────────────────┼───────────────────┐
                        ▼                   ▼                   ▼
                   ┌─────────┐      ┌──────────────┐    ┌──────────┐
                   │  Redis  │      │  Claude API  │    │  ml/     │
                   │  state  │      │  (Anthropic) │    │  B's     │
                   │  board  │      │  clerk score │    │  detector│
                   │  queue  │      │  lines, gate │    │  retrain │
                   │  memory │      └──────────────┘    └──────────┘
                   └─────────┘
```

The key architectural rule: **the office and the computer only talk through `postMessage`.** This means C and D never touch each other's code. The postMessage protocol is in [docs/contracts.md](docs/contracts.md) section 4.

---

## Instructions for each role

### B: ML

Your job is to build the fraud detector that the inspector uses, and make it learn from player attacks.

**Your files:** `ml/` (you own everything here)

**What A has set up for you:**
- `docs/contracts.md` section 3 defines the exact interface A will call:
  - `predict(record: dict) → {tells, suspicion, top_features}`
  - `retrain(examples: list[dict]) → {new_version, metrics, learned}`
  - `top_features(version?) → [str, str]`
- `server/models/schemas.py` has the `InvoiceRecord` Pydantic model — that's the 20-field dict your `predict()` receives
- `server/services/game_state.py` has `queue_for_retrain()` and `drain_retrain_queue()` — A queues submissions, you train on them
- The stub server's `_compute_stub_tells()` in `server/stubs.py` shows the 8 tells from the prototype (bank_changed, domain_mismatch, altered, copy_gen, low_legibility, heat, letterhead, unknown_vendor). Your real model should detect the same kinds of things

**What to build (hours 2-8):**
1. `ml/generator.py` — generate a few hundred legitimate and fraudulent invoices for level 1. Use the vendor data from `server/stubs.py` STUB_LEVELS. Tool effects (stains, copies, stamps) should appear on legitimate invoices too, at realistic rates
2. `ml/detector.py` — train v1 (logistic regression or LightGBM). Expose `predict(record)` and `retrain(examples)`. Save models to `ml/models/v1.pkl`
3. Test: `python3 -c "from ml.detector import predict; print(predict({...}))"`

**Hours 8-16:** Retrain policy (missed attacks become fraud examples, legitimate invoices mixed in). Version storage. `top_features()` per version — A uses these for the 2 real memo rules. Level 2 (St. Mercy) data.

**Hours 16-20:** Fixed held-out attack set + legitimate set (never trained on). Build the stats page at `frontend/src/app/stats/page.tsx` — live version chart showing catch rate, FP rate, held-out catch rate per version. Use Chart.js from CDN or npm. Report honestly if false positives rise.

**How to run your stuff:**
```bash
cd ml
python3 -m venv .venv && source .venv/bin/activate
pip install scikit-learn lightgbm pandas numpy
# Train: python3 generator.py && python3 detector.py
```

A will import your module from the server like this:
```python
from ml.detector import predict, retrain, top_features
result = predict(invoice_record_dict)
```

---

### C: Computer UI ("FORGED OS")

Your job is to build the in-game computer interface where the player forges invoices, talks to the clerk, and manages their perks.

**Your files:** `frontend/src/app/os/` (create this directory — you own everything in it)

**What A has set up for you:**
- `frontend/src/lib/api.ts` — typed fetch functions you import directly:
  ```typescript
  import { roundStart, clerkChat, clerkVoiceChat, submitInvoice, getPatchNotes } from "@/lib/api";

  // Start a round
  const round = await roundStart(1);
  // round.case_file, round.memo, round.round_id, round.inspector_version

  // Text clerk chat
  const clerk = await clerkChat(round.round_id, "Hey, quick sandwich question");
  // clerk.reply, clerk.persuasion_score (0-100)

  // Voice clerk chat (record audio with MediaRecorder, send base64)
  const voice = await clerkVoiceChat(round.round_id, audioBase64String);
  // voice.transcript, voice.reply, voice.persuasion_score, voice.reply_audio_b64

  // Submit invoice
  const result = await submitInvoice(round.round_id, invoiceRecord);
  // result.verdict ("PAID" | "FLAGGED"), result.top_tells, result.inspector_line, result.payout
  ```
- The stub server is running at `localhost:8000` with hardcoded but realistic responses. You don't need to wait for B's model or A's Claude integration.
- `prototype/game.js` is your reference for all game logic. The key functions to port: `dealMemo()` (line 316), `submit()` (line 778), `record()` (line 968), clerk chat (line 656), `computeTells()` (line 751)
- `prototype/os.html` has the HTML structure of the desk UI

**What to build (hours 2-8):**
1. Create `frontend/src/app/os/page.tsx` — this is the computer screen route
2. Replace the prototype's mock functions with the api.ts imports above
3. Keep the mocks as offline fallbacks (check if fetch fails, fall back to local logic)
4. Add a loading spinner while the inspector reads the submission

**Voice clerk chat (Deepgram integration):**
The `/clerk/voice` endpoint is ready. To use it from the browser:
```typescript
// Record audio
const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
const recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
const chunks: Blob[] = [];
recorder.ondataavailable = (e) => chunks.push(e.data);
recorder.start();
// ... user speaks ...
recorder.stop();

// Convert to base64 and send
const blob = new Blob(chunks, { type: "audio/webm" });
const buffer = await blob.arrayBuffer();
const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
const result = await clerkVoiceChat(roundId, base64);

// Play the reply audio
if (result.reply_audio_b64) {
  const audio = new Audio(`data:audio/mp3;base64,${result.reply_audio_b64}`);
  audio.play();
}
```

**postMessage: how you talk to the 3D office (D):**

Your page runs inside an iframe on D's page. Communicate through postMessage:
```typescript
// Send to office (always include src)
window.parent.postMessage({ type: "print", src: "forged-os" }, "*");
window.parent.postMessage({ type: "verdict", src: "forged-os", caught: false, line: "Looks fine!", payout: 1200, scheme: "changed_bank", vendor: "Pancake Pete" }, "*");

// Receive from office
window.addEventListener("message", (e) => {
  if (e.data.src !== "forged-world") return;
  if (e.data.type === "deliver") { /* envelope arrived at IN tray */ }
  if (e.data.type === "boss-near") { /* minimize the screen or hide */ }
});
```

Full protocol in [docs/contracts.md](docs/contracts.md) section 4. **Do not add new message types without telling D first.**

---

### D: 3D Office

Your job is to build the third-person office world where the player walks around, carries envelopes, and interacts with the inspector and boss.

**Your files:** `frontend/src/app/page.tsx` (the main `/` route) and anything in `frontend/public/office/` if you prefer raw HTML/JS

**What A has set up for you:**
- The main page at `/` is yours. It should render the 3D office and embed C's computer UI as an iframe: `<iframe src="/os" />`
- The stub server is running — you can test the full loop (forge → print → walk → inspect → verdict) without waiting for anyone
- `prototype/world.js` is your reference for the existing office: player movement, camera, furniture, boss AI, printer, inspector, collisions
- `prototype/style.css` lines 2-31 have the 4 level color palettes

**Two options for Three.js:**

*Option 1: React wrapper (if comfortable with React)*
```tsx
// frontend/src/app/page.tsx
"use client";
import { useEffect, useRef } from "react";
import * as THREE from "three"; // npm install three

export default function OfficePage() {
  const mountRef = useRef<HTMLDivElement>(null);
  // ... init Three.js scene, embed <iframe src="/os" />
}
```

*Option 2: Raw HTML/JS (if React + Three.js feels like fighting two things)*
Place your files in `frontend/public/office/index.html`, `world.js`, `world.css`. Then in `page.tsx`, just redirect or wrap:
```tsx
export default function OfficePage() {
  return <iframe src="/office/index.html" className="w-full h-full" />;
}
```
Both approaches work. Pick whichever lets you move fastest.

**postMessage: how you talk to the computer (C):**
```javascript
// Embed the computer UI
const osFrame = document.querySelector("iframe");

// Send to computer (always include src)
osFrame.contentWindow.postMessage({ type: "deliver", src: "forged-world" }, "*");
osFrame.contentWindow.postMessage({ type: "boss-near", src: "forged-world" }, "*");

// Receive from computer
window.addEventListener("message", (e) => {
  if (e.data.src !== "forged-os") return;
  if (e.data.type === "print") { /* start printer animation, create envelope */ }
  if (e.data.type === "verdict") { /* inspector reacts: e.data.caught, e.data.line */ }
  if (e.data.type === "stand") { /* player stood up from computer */ }
  if (e.data.type === "hud") { /* update HUD: e.data.money, e.data.heat, etc. */ }
});
```

Full protocol in [docs/contracts.md](docs/contracts.md) section 4. **Do not add new message types without telling C first.**

**What to build (hours 2-8):**
1. Get the Three.js office rendering at `/`
2. Embed C's computer UI: `<iframe src="/os" style="..." />`
3. Tune movement, camera, collisions (no walking through glass, camera doesn't get stuck)
4. Signposting: glow on printer and IN tray, arrow toward current objective
5. Time a full round — the walk should take 15 seconds or less

**Hours 8-16:** Boss patrol timing, "sees your screen" cone, reaction when caught carrying the envelope. Inspector visual evolution per version (intern → magnifier → UV lamp → cyborg). St. Mercy office layout/palette. **First playtest with 3 outside people** — report top 5 problems.

---

## Branch rules

- **Branches:** `a/…`, `b/…`, `c/…`, `d/…`. Merge to `main` through small PRs. `main` must always run.
- **Ownership:** Don't edit someone else's files without asking. See the ownership table above.
- **Blocked for more than 30 minutes?** Say so in the group chat. Use the stub while you wait.
- **Sleep:** each person takes one 3-hour block, staggered. Put yours here: A ___ · B ___ · C ___ · D ___

---

## Sponsor checklist

These are the hackathon sponsor tracks we're targeting. Each needs evidence in the demo.

| Sponsor | What we use it for | Evidence needed |
| --- | --- | --- |
| **Anthropic** (Claude API) | Clerk persuasion scoring, inspector dialogue, validity gate, memo decoy generation | Show Claude calls in code, structured JSON output, cached fallbacks |
| **Redis** | 5 uses: game state, leaderboard, retrain queue, version tracking, inspector memory (+ vector search later) | Show Redis usage goes beyond caching |
| **Sentry** | Frontend + backend error tracking, performance traces | Show Sentry dashboard with captured errors/traces |
| **Arize** | LLM traces on every /submit and /clerk call, per-version evals | Show Arize Phoenix dashboard with traces and eval metrics |
| **Deepgram** | Voice-powered clerk chat (STT → clerk logic → TTS) | Show voice is essential to gameplay, not tacked on |
| **Ddoski's Playground** | Grand prize track ($5K) — games and interactive experiences | The game itself is the submission |

---

## Timeline

### Hours 0-2: contracts (everyone together)

Already done. See [docs/contracts.md](docs/contracts.md).

### Hours 2-8: one invoice through every layer

Goal: forge an invoice on the computer, walk it to the inspector, have a real model judge it, trigger a retrain. Can be ugly.

| | Tasks |
| --- | --- |
| **A** | Wire up real routes (Redis state, Claude API calls with fallbacks). Sentry + Arize tracing on day one. |
| **B** | Generate training data for level 1. Train v1 detector. Expose `predict()` and `retrain()`. |
| **C** | Port prototype desk UI to `frontend/src/app/os/`. Replace mocks with api.ts fetch calls. Loading state while inspector reads. |
| **D** | Get Three.js office rendering at `/` with embedded iframe. Tune movement, camera, collisions. Signposting. |

**Checkpoint (hour 8, 15 min):** play the end-to-end path. If it doesn't work, everyone helps fix it.

### Hours 8-16: the game

| | Tasks |
| --- | --- |
| **A** | Claude API: clerk persuasion per personality, inspector lines, memo decoy, validity gate. Background retrain. Content pools. Deepgram voice clerk integration. |
| **B** | Retrain policy. Version storage. Top features per version (feeds the memo). Level 2 data. |
| **C** | Forensic replay from real tells. Corkboard + patch notes. Perks. Voice clerk UI (mic button, audio playback). Level 2. |
| **D** | Boss tuning (patrol, screen cone, caught reaction). Inspector visual evolution. St. Mercy layout. **First playtest** — report top 5 problems. |

**Checkpoint (hour 16, 15 min):** play two full rounds per level. Decide what to cut.

### Hours 16-20: sponsor proof

| | Tasks |
| --- | --- |
| **A** | Arize traces + evals. Redis vector search over past invoices. Deploy (Vercel + Render). |
| **B** | Held-out eval set. Stats page with live version chart. Report FP honestly. |
| **C** | Leaderboard + Hall of Shame on the computer. Playtest bug fixes. |
| **D** | Second playtest. Sound (footsteps, printer, stamp). Optional: wall TV showing B's chart. |

### Hours 20-24: polish and demo (no new features)

| | Tasks |
| --- | --- |
| **A** | Freeze backend. Warm caches. Test offline fallbacks. Submit Devpost. |
| **B** | Pre-seed leaderboard + versions v1-v3 so demo never starts empty. |
| **C** | Final visual polish. Test at demo laptop + projector resolution. |
| **D** | Record backup demo video. Run 3-minute demo script 3x with whole team. |

---

## Cut line (drop in this order if behind)

Clerk chat → perks → extra chaos events → duel mode → level 2 → scheme cards → Hall of Shame → **the 3D office** (`/os` still plays the whole game on its own, with a fake boss and submit, so the demo survives).

**Never cut:** the tool-to-feature pipeline, the memo, the inspector evolution, the held-out evaluation.
