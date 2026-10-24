# Forged: Game Design Doc (v1.0)

This document describes Forged as built. See [README.md](README.md) for setup and architecture. The original planning document was v0.1; this is the post-build record of what shipped.

## 1. One-line pitch

You are a fraudster in a third-person office, building fake online orders and sneaking them past a live ML fraud model. Every time you beat it, it retrains on your trick and comes back smarter.

## 2. The game

Forged is a browser-based 3D office game. The entire world is built from Three.js boxes, cylinders and spheres -- no art assets, no imported 3D models, no textures. All audio is synthesized in real-time with the WebAudio API -- no audio files. NPCs reply with synthesized voices via the Web Speech API, and the player can talk to them with their microphone.

The player controls a customizable character in a third-person (or first-person) office. They walk to their desk, sit down, and the camera transitions into a full-screen in-game computer running "FORGED OS." On the computer they build fraudulent checkout orders for an online store, then print them, carry the slip past the boss, and hand it to the inspector (Gus). Gus is backed by a real LightGBM model trained on 100k+ real credit card transactions.

**Tone:** stylized, colorful, light heist comedy. Fictional companies and cartoonish characters. The game reads as outsmarting a detector, not as a how-to for real fraud.

## 3. Core loop (one round, 60-90 seconds)

1. **Sit down.** Walk to your desk, press E. The camera transitions and the computer fills the screen.
2. **Read the briefing.** The daily memo shows 3 rules Gus is watching for (2 real, 1 decoy). The victim company's profile shows their normal patterns.
3. **Build the checkout.** One question per screen: what you buy, who you pretend to be, what device you shop on, where you shop from, where it ships, when and how many times. Type freely; suggestions help. Gus's gut-feeling face in the address bar reacts as you type.
4. **Print.** Drag the envelope onto the outbox. The printer whirs. You stand up automatically.
5. **Carry.** Pick up the slip at the printer (E), walk it across the office past the boss's patrol route.
6. **Submit.** Drop the slip in Gus's IN tray (E). The camera cuts to the counter.
7. **Verdict.** Gus holds up the slip, scans it, circles the rows that gave it away, and stamps it APPROVED (confetti) or DECLINED (red flash). He tells you why in plain words.
8. **Aftermath.** Your trick is pinned to the corkboard. If you fooled him, his version ticks up. Sit back down to see patch notes and spend money in the shop.

## 4. The office (world.js, 144 KB)

A single rectangular room with:

- **4 desks** (multiplayer seats, occupied in join order)
- **Printer** on the back wall
- **Inspector booth** (Gus's counter with the IN tray)
- **Corkboard** on the wall behind the inspector
- **Boss's office** with a glass door
- **Break room** door (coffee runs)
- **Records room** door
- **Changing room** door (opens the character customizer with a fade transition)
- **DETECTOR LIVE TV** on the east wall showing a chart of attempts and catch rate
- **Minimap** in the corner showing the room layout, players, boss cone, and key locations

**Player character:** chunky cartoon figure with googly eyes. Fully customizable: 8 skin tones, 10 hair colors, 7 hair styles, 4 eyebrow shapes, 5 mouth shapes, 2 nose shapes, 10 shirt colors, 7 trouser colors, 6 tie colors, glasses, earrings, mustache. The customizer has a 3D turntable preview with face-zoom when editing hair/face options.

**The boss:** patrols out of his office with a visible vision cone on the floor. If he walks behind your chair while you're forging, the computer prompts you to press Space to hide the screen (miss it: +15 heat). If he spots you carrying the slip: he stops you for a few seconds (+10 heat). When suspicion builds, the player hears a heartbeat and the screen edges pulse red.

**Inspector evolution:** Gus's gear changes with his model version:
- v1-3: sleepy intern with a stapler
- v4-6: clerk with a magnifying glass
- v7-9: auditor with a UV lamp
- v10+: cyborg with a monocle

His face evolves too: sleepy lids, then glasses, UV goggles, and a cyborg plate.

**Random events:**
- Fire drills: everyone evacuates for a coffee run, comes back after
- Boss patrol timing varies; he can surprise you

**Visual feedback:**
- Yellow diamond and floor ring always point at the current objective
- Desks get messier each round (coffee rings, pinned notes, stacked envelopes)
- Everyone's googly eyes follow you around

**Camera:** third-person default, first-person toggle (F5/V), mouse-wheel zoom. Click to capture pointer for mouse look. Minecraft-style WASD movement with sprint.

## 5. The computer (os.html + game.js, 94 KB)

A full fake operating system ("FORGED OS") running inside an iframe. The office and the computer communicate exclusively through postMessage (see section 12).

**The checkout** is one-screen-per-field:
1. What you buy (product, quantity)
2. Who you pretend to be (name, email)
3. What device / browser
4. Where you shop from (IP / location)
5. Where it ships (address)
6. When (time of day, day of week)
7. How many orders / days apart
8. Which stolen card to use (at Mastermind rank)

Fields unlock progressively with rank (section 8).

**Gus's gut feeling:** a face in the address bar that reacts as you type. It calls the model's `/preview` endpoint with a 4-second timeout, giving real-time feedback on how suspicious the current order looks.

**Other screens:**
- Daily memo with 3 rules (2 real from the model + 1 decoy)
- Victim company profile (normal vendors, amounts, patterns)
- Support chat with the clerk NPC (text or voice)
- Verdict replay with Gus's annotations
- Corkboard review (all past tricks)
- Shop for unlocks
- Patch notes showing what each Gus version learned

## 6. The checkout order format

Every order the player builds maps to one row in the IEEE-CIS fraud dataset format. The columns include:

- TransactionID through V339 (the original IEEE-CIS features)
- id_01 through id_38 (identity features)
- DeviceType, DeviceInfo
- Game columns: session_id, scheme_id, campaign_id, step, verdict, score, top_reasons

This means every order a player sends is a labeled training example in a real fraud dataset format. The game is a data collection pipeline disguised as entertainment.

## 7. Levels and shops

Each level is a shop with its own product catalog, color palette, and inspector personality.

| Level | Shop | Theme | Notes |
| --- | --- | --- | --- |
| 1 | Sunny Diner Supply | Warm amber, teal, cream | Tutorial level, simple products |

Additional levels were designed (St. Mercy Hospital, Port Nocturne Shipping, Neon Arcade Holdings) but level 1 is the fully built and ML-backed level. The scripted Gus supports all levels; the live model backs level 1.

## 8. Ranks and progression

Ranks gate which checkout fields the player can fill in, so new players start simple and complexity grows with skill.

| Rank | Stars | Fields unlocked | Also unlocks |
| --- | --- | --- | --- |
| Rookie | 1 | what you buy, where it goes | |
| Hustler | 2 | + name and email | support chat |
| Schemer | 3 | + device, where you shop from | leaked memo |
| Operator | 4 | + when, how many orders, days apart | |
| Mastermind | 5 | + which stolen card to use | |

XP: 1 for getting caught, 2 for getting away with it. Rank thresholds: 2, 4, 7, 11 XP. Gus goes easier on Rookies and Hustlers.

Add `?rank=1` through `?rank=5` to the URL to test any rank.

## 9. The daily memo

At the start of each round, a leaked memo lists 3 rules Gus is watching for:
- 2 rules are real, derived from the model's actual top features
- 1 rule is a decoy (generated by Claude or from a canned pool)

The player is told one rule is wrong, but not which. Figuring out which rules are real by watching which tricks get caught is the deduction puzzle, borrowed from Papers Please. It makes the model's internal behavior visible and fun.

## 10. The fraud model

### Live model (ml/online/)

LightGBM classifier trained on the IEEE-CIS Kaggle fraud dataset.

**Training data:**
- 100,963 real credit card transactions
- ~7,300 honest simulated shoppers
- ~5,500 simulated attackers (random, clever, honest strategies)
- ~2,300 real player orders

**Hyperparameters:** 500 estimators, 0.04 learning rate, max 63 leaves, evasion weight 3x, per-player cap 300 rows.

**Identity verification (v3+):**
- TransUnion TruValidate IDV: checks if the identity belongs to a real person
- AtData Fraud Finder: email-based fraud risk score
- 228 cached sandbox responses; offline mirror fallback

**Benchmarks (v4, live):**

| Metric | Value |
| --- | --- |
| Real fraud recall | 64.3% at 3.6% FPR |
| Simulated attacker catch rate | 96.3% |
| Real player catch rate | 97.2% |
| Game false positive rate | 2.0% |

**Retrain loop and promotion gates:**

When a player fools Gus, the order is queued. After enough wins, the model retrains. A new version is only promoted if it passes all gates:
- Real recall must not drop more than 5% from the current version
- Real FPR must stay at or below 4%
- Game FPR must stay at or below 5%
- Player catch rate must improve on 30+ held-out orders

This prevents the model from overfitting to game attacks at the expense of catching real fraud.

**Version history:**

| Version | What changed | Player catch |
| --- | --- | --- |
| v1 | Baseline on IEEE-CIS + simulated shoppers | -- |
| v2 | First retrain on 300 player orders. Learned new_address, gift_card, far_ship | 54.2% |
| v3 | Added CRS identity check (TransUnion + AtData) | 96.8% |
| v4 | Retrained on live CRS sandbox answers. Fixed v3's 28% honest-shopper block rate | 97.2% |

### Invoice fraud model (ml/detector.py) -- the original

Logistic regression with 34 features and Platt calibration, plus a kNN memory system (K=10, cosine similarity) that adds 3 memory features per session. Built for the Sunny Diner invoice-forging gameplay. Not used in the hosted version.

### Scripted Gus (orders.js)

A rule-based fallback that runs entirely in the browser. No backend needed. Checks for suspicious patterns (unusual timing, mismatched addresses, repeated tricks) using weighted heuristics. Learns from player wins by increasing weights on the signals that were present in successful attacks, plus a kNN memory of past orders. This is what players get when running the game without a backend.

## 11. Voice and dialogue

**NPC voice:** all NPCs speak through the Web Speech API (SpeechSynthesis). No audio files. Each NPC has a distinct voice pitch and rate.

**Player voice input:** hold the mic key to talk. Web Speech API (SpeechRecognition) transcribes what you say. The clerk NPC processes the transcript and responds. The `/clerk/voice` endpoint uses Deepgram STT when available, falling back to the browser's built-in recognition.

**Claude API integration:** when `ANTHROPIC_API_KEY` is set, the clerk's persuasion scoring and the inspector's reaction lines are generated by Claude. Without the key, canned lines from a pre-written pool are used. The game plays identically either way.

## 12. Multiplayer (lan.js + lan_room.py)

Up to 4 players share one office over WebSockets. The server is `serve.py` (Python stdlib, no dependencies).

**What's shared:**
- The office: everyone sees each other walking, sitting, carrying slips
- Character appearance: each player has their own customized look and shirt color
- The boss: one player's game drives the boss patrol, everyone else follows
- Gus: one shared model per shop. A trick that fools him makes him harder for everyone
- Verdicts: every stamp, corkboard pin, and TV chart point is visible to all
- Leaderboard: hold Tab for room standings

**What's per-player:**
- Desk assignment (join order)
- Coffee runs, doors, printer interactions
- Rank and XP
- Saved Gus brain (your solo Gus is untouched while in a room)

**Shirt colors:** everyone wears their own color. In a room, the customizer fades colors other players wear so you can't pick the same one.

**Hosting:**
- **LAN:** one player runs `python serve.py` and shares their local IP. Others open the URL in a browser. Only the host needs Python.
- **Online:** deploy via Docker (see README). The first player to join owns the room. The button reads "Online game" instead of "LAN game."

## 13. Random events and chaos

- **Boss patrol:** the boss leaves his office on a timer, walks the room with a visible vision cone. Timing varies so you can't perfectly predict it.
- **Fire drill:** the alarm sounds, everyone evacuates to the break room for a coffee run. Random field gets smudged on your current order.
- **Boss catches you forging:** if the boss walks behind your chair while the computer is open, you have ~2 seconds to press Space to hide the screen. Miss it and you get +15 heat.
- **Boss catches you carrying:** if he spots you inside his vision cone while carrying the slip, he stops you for a few seconds and adds +10 heat.
- **Heat system:** heat builds from suspicious activity and risky orders. Higher heat means the boss pays more attention and Gus looks more carefully. The screen edges pulse red and a heartbeat plays.

## 14. Controls

Minecraft-style defaults, all rebindable in Esc > Options > Controls:

**Office:**
- WASD: move
- Left Ctrl (macOS) / Left Shift (Windows/Linux): sprint
- Mouse: look (click to capture)
- Mouse wheel: zoom
- E or right-click: interact
- F5/V: toggle first/third person
- Hold Tab: leaderboard
- Esc: Game Menu (pauses solo, not LAN)

**Computer:**
- Type: fill in fields
- Enter: next step
- 1-7 or mouse wheel: jump between steps
- T: write to support chat
- Space: hide screen (when boss is near)
- Left Shift: stand up

Bindings are stored in `keys.js`. The menu system is `menu.js` / `menu.css`.

## 15. Technical notes

**No art pipeline.** Every visual element is a Three.js primitive. Characters are stacked boxes and spheres. Furniture is boxes. The printer is boxes. Eyes are spheres that track the nearest character. This was a deliberate choice: it means anyone can add content without art tools, and the entire game loads in seconds with no asset downloads.

**No audio files.** Every sound -- footsteps, doors, the printer whirring, stamp impacts, the heartbeat, ambient office noise -- is synthesized at runtime using the WebAudio API (OscillatorNode, noise buffers, filters). This keeps the download at zero bytes of audio and lets sounds be parameterized (footstep pitch varies with speed, heartbeat rate varies with heat).

**Iframe architecture.** The office (index.html + world.js) and the computer (os.html + game.js) are separate pages communicating through postMessage. This separation means the 3D engine and the game logic never touch each other's code. The computer can also run standalone by opening os.html directly.

**PostMessage protocol:**

| Direction | Type | Purpose |
| --- | --- | --- |
| Computer -> Office | `hud` | Money, heat, inspector version, level |
| Computer -> Office | `print` | Envelope dropped on outbox, start printer |
| Computer -> Office | `verdict` | Gus's decision, tells, payout |
| Computer -> Office | `stand` | Player pressed stand-up key |
| Computer -> Office | `gus-learned` | A win taught Gus something (shared in LAN) |
| Office -> Computer | `deliver` | Envelope reached the IN tray |
| Office -> Computer | `boss-near` | Boss is behind your chair |
| Office -> Computer | `heat` | Boss caught you, add heat |
| Office -> Computer | `paused` | Game Menu opened/closed |
| Both ways | `tutorial-*` | First-round tutorial coordination |

**Data collection.** Every order the player submits is mapped to a row in the IEEE-CIS fraud dataset format. Add `?debug` to the URL, then press D on the computer to see the raw rows. Console access: `forgedRows.all()`, `.csv()`, `.clear()`.

## 16. What was cut from v0.1

The original design doc proposed features that were descoped or changed during the build:

- **Next.js frontend:** replaced with vanilla HTML/CSS/JS. No build step, no npm, no React.
- **2D desk interface:** replaced with a full 3D office with third-person movement.
- **Deepgram voice:** replaced with the Web Speech API (browser-native, no API key needed).
- **Arize Phoenix observability:** not integrated in the shipped version.
- **Redis vector search:** Redis is used for state only, not vector search.
- **Duel mode:** not built. Solo and multiplayer co-op are the shipped modes.
- **Perks system:** not built. Progression is through ranks and shop unlocks.
- **Mini-tasks (signature tracing, stamp alignment):** not built.
- **Multiple levels with full ML backing:** only level 1 (Sunny Diner) has a trained model. Other levels use the scripted Gus.
- **Scheme cards and Hall of Shame:** not built.
- **Role swap mode (play as auditor):** not built.
- **Team of 4 with role assignments (A/B/C/D):** the game was built as a unified codebase.

What survived from v0.1: the core loop, tool-to-feature pipeline, daily memo with real + decoy rules, inspector evolution, heat system, boss patrol, clerk chat, corkboard, patch notes, held-out evaluation, and the honest-limit philosophy (we say up front this is a game, not a fraud manual).
