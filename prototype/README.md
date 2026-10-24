# Forged: playable prototype

A third-person office game. The forging desk is the operating system of your in-game computer. There's no AI and no backend yet.

```
python -m http.server 8765
```

Then open http://localhost:8765. After pulling changes, hard-refresh (Ctrl+F5): the simple server lets the browser keep old copies of the files. It needs to be served over http (not opened as a file) so the office and the computer can talk to each other.

## Files

| File | What it is |
| --- | --- |
| `index.html`, `world.js`, `world.css` | The 3D office (Three.js r128 from a CDN): your character, desks, printer, inspector booth, clerk, boss, corkboard |
| `os.html`, `game.js`, `style.css` | The computer screen: FORGED OS with the desk, tools, memo, clerk chat, verdicts and shop. It also runs on its own if you open `os.html` directly |

## How a round plays

1. Walk to your desk and press **E** to sit. The camera moves in and the computer takes over the screen.
2. Pick a scheme and forge the invoice with the tools. Drag the envelope onto the outbox to **print** it. You stand up automatically.
3. Grab the invoice at the **printer** (E), carry it across the office, and drop it in the inspector's **IN tray** (E).
4. The inspector reads it and stamps PAID or FLAGGED above his head. Your trick gets pinned to the **corkboard** on the wall.
5. Sit back down to see the corkboard scene, patch notes and the shop on your computer.

**The boss** patrols out of his office with a vision cone on the floor. If he walks behind your chair while you're forging, the computer tells you to press **Space** to hide the invoice; miss it and you get +15 heat. If he spots you carrying the envelope inside his cone, he stops you for a few seconds and you get +10 heat.

**What the office shows:**
- A yellow diamond and floor ring always point at what to do next.
- The inspector's gear changes with his version: stapler (v1–3), magnifying glass (v4–6), UV lamp (v7–9), cyborg eye (v10+).
- The **DETECTOR LIVE** TV on the east wall charts every attempt and the catch rate.
- Your desk gets messier every round.
- Everyone is a chunky cartoon character with googly eyes that follow you around. The inspector's face changes with his version too: sleepy lids, then glasses, UV goggles, and finally a cyborg plate.
- **Why I caught you:** when you drop the envelope, the camera cuts to the counter. The inspector holds up your invoice and scans it, circles the fields that gave you away, and slams the stamp down: confetti on PAID, a red flash on FLAGGED.
- When the boss's suspicion builds, you hear a heartbeat and the screen edges turn red.

Controls: `WASD` move · `Shift` run · mouse look (click to capture it) · mouse wheel zoom · `E` interact · `Esc` stand up or free the mouse. On the computer: `1`–`6` tools · `D` detector view · `Space` hide the invoice.

## How the two halves talk

Both pages use `postMessage`:

| Direction | Message | Meaning |
| --- | --- | --- |
| Computer → office | `hud` | Money, heat, inspector version and face, level (the office recolors to the level's palette) |
| Computer → office | `phase` | `briefing` or `forging`, which drives the objective text |
| Computer → office | `print` | The envelope was dropped on the outbox; the printer starts |
| Computer → office | `verdict` | PAID or FLAGGED, the inspector's line, payout, and `tells` (the top reasons he caught you); drives the booth close-up, the bubble and the corkboard |
| Computer → office | `stand` | `Esc` was pressed on the computer |
| Office → computer | `heat` `{amount}` | The boss caught you with the envelope. **Not handled by `game.js` yet (C):** add it to the heat meter |
| Office → computer | `deliver` | The envelope reached the IN tray; the computer runs the inspection |
| Office → computer | `boss-near` | The boss is behind your chair; the computer starts the hide-the-invoice prompt |

## What is mocked (the backend team replaces these)

- `computeTells()` / `submit()` in `game.js`: a rule-based verdict that stands in for the detector
- Clerk replies and the persuasion score: keyword matching that stands in for the LLM
- Memo rules: a fixed pool per level instead of the detector's top features
- Inspector lines: a cached pool for each level

In the browser console, `forged` (in the office page) exposes the player and the boss state for quick testing.
