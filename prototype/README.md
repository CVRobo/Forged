# Forged: playable prototype

A third-person office game about online-order fraud. You build fake orders on your in-game computer and sneak them past Gus, the shop's risk engine. Every order is saved as a row in the IEEE-CIS fraud dataset format (see `docs/online-fraud-redesign.md`). There's no AI and no backend yet.

```
python serve.py
```

Then open http://localhost:8765. `serve.py` is a plain static server with browser caching turned off, so a normal reload always shows the latest code (`python -m http.server` lets the browser keep old copies of the files, especially inside the computer screen). It needs to be served over http (not opened as a file) so the office and the computer can talk to each other.

## Files

| File | What it is |
| --- | --- |
| `index.html`, `world.js`, `world.css` | The 3D office (Three.js r128 from a CDN): your character, desks, printer, inspector booth, clerk, boss, corkboard |
| `os.html`, `game.js`, `style.css` | The computer screen: FORGED OS with the plan, the hand of cards, the victim, memo, support chat, verdicts and shop. It also runs on its own if you open `os.html` directly |
| `orders.js` | The online-order content (shops, stolen cards, plan cards, ranks), the IEEE-CIS row builder and the scripted Gus. Loaded before `game.js` |

## How a round plays

1. Walk to your desk and press **E** to sit. The camera moves in and the computer takes over the screen.
2. Fill in **the plan**, a sentence with blanks ("I'll pose as … and buy … at … then send it to … with the trick …"), by clicking cards from your hand of 3 (or keys `1`–`3`). Drag the envelope onto the outbox to **print** the order slip. You stand up automatically.
3. Grab the slip at the **printer** (E), carry it across the office, and drop it in Gus's **IN tray** (E).
4. Gus approves the plan or catches it, and says why in plain words ("who shops at 3 AM?"). Your trick gets pinned to the **corkboard** on the wall.

**Ranks** (saved in the browser) unlock one blank at a time, so new players start with two choices:

| Rank | Plan | Also unlocks |
| --- | --- | --- |
| ⭐ Rookie | what, where | |
| ⭐⭐ Hustler | + who (the disguise) | support chat |
| ⭐⭐⭐ Schemer | + when | leaked memo |
| ⭐⭐⭐⭐ Operator | + trick (plans with several orders) | |
| ⭐⭐⭐⭐⭐ Mastermind | + tweak the disguise piece by piece (card, email, device, VPN) | |

A round gives 1 XP when caught and 2 when you get away with it (ranks at 2, 4, 7 and 11 XP). Gus goes easier on Rookies and Hustlers. Add `?rank=1`…`?rank=5` to either page's URL to try a rank.
5. Sit back down to see the corkboard scene, patch notes and the shop on your computer.

**The boss** patrols out of his office with a vision cone on the floor. If he walks behind your chair while you're forging, the computer tells you to press **Space** to hide the screen; miss it and you get +15 heat. If he spots you carrying the envelope inside his cone, he stops you for a few seconds and you get +10 heat.

**What the office shows:**
- A yellow diamond and floor ring always point at what to do next.
- The inspector's gear changes with his version: stapler (v1–3), magnifying glass (v4–6), UV lamp (v7–9), cyborg eye (v10+).
- The **DETECTOR LIVE** TV on the east wall charts every attempt and the catch rate.
- Your desk gets messier every round.
- Everyone is a chunky cartoon character with googly eyes that follow you around. The inspector's face changes with his version too: sleepy lids, then glasses, UV goggles, and finally a cyborg plate.
- **Why I caught you:** when you drop the envelope, the camera cuts to the counter. Gus holds up your order slip and scans it, circles the rows that gave you away (card, buyer, ship to, device / IP, cart, timing), and slams the stamp down: confetti on APPROVED, a red flash on DECLINED.
- When the boss's suspicion builds, you hear a heartbeat and the screen edges turn red.

Controls (Minecraft-style defaults, all rebindable in **Esc → Options → Controls**): `WASD` move · `Left Ctrl` sprint (`Left Shift` on Windows/Linux, where Ctrl+W closes the tab) · mouse look (click to capture it) · mouse wheel zoom · `E` or right-click interact · `F5`/`V` first ⇄ third person · hold `Tab` leaderboard · `Esc` Game Menu (pauses the office). On the computer: `1`–`3` or click play a card · mouse wheel moves between the blanks · `T` write to support · `Space` hide the screen · `Left Shift` stand up. Bindings live in `keys.js`; the menu is `menu.js`/`menu.css`.

## How the two halves talk

Both pages use `postMessage`:

| Direction | Message | Meaning |
| --- | --- | --- |
| Computer → office | `hud` | Money, heat, inspector version and face, level (the office recolors to the level's palette) |
| Computer → office | `phase` | `briefing` or `forging`, which drives the objective text |
| Computer → office | `print` | The envelope was dropped on the outbox; the printer starts |
| Computer → office | `verdict` | `caught` (declined), Gus's line, payout, `vendor` (an order summary) and `tells` (the top reasons, names from `orders.js`); drives the booth close-up, the bubble and the corkboard |
| Computer → office | `stand` | The Stand up key (default Left Shift) was pressed on the computer |
| Computer → office | `menu` | Esc on the computer: open the Game Menu (the office page owns it) |
| Office → computer | `paused` | The Game Menu opened or closed: freeze or resume the computer's timers |
| Office → computer | `quit` / `tour` | Game Menu → Quit to Title / Tutorial |
| Office → computer | `heat` `{amount}` | The boss caught you with the envelope: add heat |
| Office → computer | `deliver` | The envelope reached the IN tray; the computer runs the inspection |
| Office → computer | `boss-near` | The boss is behind your chair; the computer starts the hide-the-screen prompt |

## Connecting to the backend

Add `?api=<server url>` to either page, e.g. http://localhost:8765/?api=http://localhost:8000 (the office passes it on to the computer). The computer then calls `POST /round/start`, `POST /clerk` and `POST /submit`. The `/submit` body's `record` now has `mode: "online"`, the `orders` and `rows` (one IEEE-CIS row per order); a response can add `results` (one `{declined, reason, tells, score}` per order). With no `api`, or when a call fails or times out, it falls back to the mocks below and shows a "playing offline" toast once. The server needs CORS enabled for the frontend's origin.

## What is mocked (the backend team replaces these)

- `judgeOrders()` in `orders.js`: the scripted Gus, a rule-based verdict per order that stands in for the detector
- Clerk replies and the persuasion score: keyword matching that stands in for the LLM
- Memo rules: a fixed pool per level instead of the detector's top features
- Inspector lines: a cached pool for each level

In the browser console, `forged` (in the office page) exposes the player and the boss state for quick testing.

## The data

Players never see the data. Every order sent is one row with the IEEE-CIS columns (`TransactionID` … `V339`, `id_01` … `id_38`, `DeviceType`, `DeviceInfo`) plus game columns (`session_id`, `scheme_id`, `campaign_id`, `step`, `verdict`, `score`, `top_reasons`…). For the team: add `?debug` to the page URL, then **D** at the computer shows the plan's rows and **⬇ CSV** downloads every order sent from this browser. The console also has `forgedRows.all()`, `.csv()` and `.clear()` (in the computer's frame: `os.html`). How the anonymized C, D and M columns are filled is documented at the top of `toRows()` in `orders.js`.
