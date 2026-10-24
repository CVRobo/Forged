# Forged: the next 24 hours

You are a master forger in a third-person office. You sit at your computer to forge fake invoices, print them, and carry them past the boss to an AI inspector. Every time you beat the inspector, he's retrained on your trick and comes back smarter.

- Full design: [Forged Game Design Doc (v0.1).md](Forged%20Game%20Design%20Doc%20(v0.1).md)
- Playable prototype (no AI yet): [prototype/](prototype/). Run `python -m http.server 8765` in that folder and open http://localhost:8765. The 3D office is `index.html`; the computer screen ("FORGED OS") is `os.html`.

This file splits the remaining work between four people. Put your name next to your letter.

| | Role | Owns | Name |
| --- | --- | --- | --- |
| **A** | Backend / lead | API, round logic, Redis, Claude calls, content pools, Arize, Sentry, deploy | |
| **B** | ML | Invoice generator, detector, retrain loop, held-out evals, stats page | |
| **C** | Computer UI ("FORGED OS") | `os.html` / `game.js`: wiring to the API, tools, verdicts, shop, feel | |
| **D** | 3D office | `index.html` / `world.js`: player, NPCs, printer and delivery, boss, playtests, demo video | |

**Frontend decisions:**
- **No framework:** we keep plain HTML, CSS and JavaScript (no Next.js port). The prototype already plays end to end.
- **Three.js r128 from a CDN, with no art assets:** characters are blocks with emoji heads, built in code. Swap in real models only after hour 16, and only if everything else is stable.
- **The office and the computer talk only through `postMessage`.** The messages are listed in [prototype/README.md](prototype/README.md). C and D can work in parallel without touching each other's files, as long as that list stays up to date.

---

## Hours 0–2: contracts (everyone, together)

Nothing else starts until these are written in `docs/contracts.md` and merged.

1. **Invoice record.** Start from the prototype's detector view (`record()` in `prototype/game.js`, press `D` on the computer). B confirms the final feature names and types.
2. **API shape (A writes it, everyone signs off):**

   | Method | Path | Returns |
   | --- | --- | --- |
   | `POST` | `/round/start` `{level}` | `round_id`, memo (3 rules, `decoy` hidden), inspector version, case file |
   | `POST` | `/clerk` `{round_id, text}` | clerk reply, persuasion score 0–100 |
   | `POST` | `/submit` `{round_id, record}` | verdict, top tells, inspector line, payout, new version |
   | `GET` | `/patch-notes?since=v` | what each new version learned |
   | `GET` | `/metrics` | per version: catch rate, false-positive rate, held-out catch rate |
   | `GET` | `/leaderboard` | money and patches caused, per player |

3. **Office ↔ computer messages:** C and D agree on any new message before adding it.
4. **Fake server:** A ships a stub that returns hard-coded JSON for every route by hour 2, so nobody waits on B.

---

## Hours 2–8: one invoice through every layer

Goal at hour 8: forge an invoice on the computer, walk it to the inspector, have a real model judge it, and trigger a real retrain. It can be ugly.

| | Tasks |
| --- | --- |
| **A** | FastAPI skeleton with the routes above. Redis for game state (rounds, history, leaderboard). Log every submission. Sentry on day one. |
| **B** | Generator: a few hundred legitimate and fraudulent invoices for level 1. Tool effects (stains, copies, stamps) go on legitimate invoices too, at realistic rates. Train v1 (logistic regression or LightGBM). Expose `predict(record)` and `retrain()`. |
| **C** | Replace the mocks in `game.js` with `fetch` calls to A's stub: `submit()`/`computeTells()`, the clerk chat handler, `dealMemo()`. Keep the mocks as offline fallbacks. Add a loading state while the inspector reads. |
| **D** | Tune movement, camera and collisions (no walking through glass, the camera never gets stuck in walls). Clear world signposting: a glow on the printer and the IN tray, an arrow toward the current objective. Time a full round; the walk should take 15 seconds or less. |

**Checkpoint (hour 8, 15 min):** play the end-to-end path. If it doesn't work, everyone helps fix it before moving on.

---

## Hours 8–16: the game

| | Tasks |
| --- | --- |
| **A** | Claude API: clerk persuasion scoring per personality, fresh inspector lines, the memo decoy rule, all with cached fallbacks. Validity gate (plausible invoice and money goes to the attacker). Background retrain that swaps versions between rounds. Content pools: 40 vendor names (silly and plausible, on both legitimate and fraudulent invoices), inspector lines (4 stages × pass/catch × 2 levels), clerk replies. |
| **B** | Retrain policy (missed attacks become fraud examples, legitimate invoices mixed in). Version storage. Top features per version, which feed the 2 real memo rules. Level 2 (St. Mercy) data. |
| **C** | Forensic replay driven by the real top tells. Corkboard scene and patch notes from real data. Perks that change real features. Make sure level 2 plays fully on the computer. |
| **D** | Boss tuning: patrol timing, a "sees your screen" cone, and a reaction when he catches you carrying the envelope. The inspector's look changes with his version (intern → magnifier → UV lamp → cyborg). The St. Mercy office layout and palette. **First playtest with 3 outside people**; report the top 5 problems to the team. |

**Checkpoint (hour 16, 15 min):** play two full rounds per level. Decide what to cut, using the cut line below.

---

## Hours 16–20: sponsor tracks and proof

| | Tasks |
| --- | --- |
| **A** | Arize traces for every attack and verdict, plus evals per detector version. Redis beyond caching: vector search over past invoices, attacker memory. Deploy (static hosting for the frontend, Render or Fly for the backend). |
| **B** | Fixed held-out attack set and legitimate set, never trained on. Live version chart on a stats page (catch rate, false positives, held-out catch rate; Chart.js from a CDN). Report it honestly if false positives rise. |
| **C** | Leaderboard and Hall of Shame screens on the computer. Bug fixes from the playtest. |
| **D** | Second playtest. Sound in the office: footsteps, printer, the inspector's stamp. Optional: a wall TV in the office showing B's live chart. |

---

## Hours 20–24: polish and demo (no new features)

| | Tasks |
| --- | --- |
| **A** | Freeze the backend. Warm the caches. Check the offline fallbacks with the API turned off. Submit the Devpost: problem, how it works, sponsor evidence. |
| **B** | Pre-seed the leaderboard and versions v1–v3 so the demo never starts empty. |
| **C** | Last visual polish on the computer. Test at the demo laptop's and projector's resolution. |
| **D** | Record the backup demo video. Run the 3-minute demo script (design doc, section 19) at least 3 times with the whole team. |

---

## Rules for the 24 hours

- **Branches:** `a/…`, `b/…`, `c/…`, `d/…`. Merge to `main` through small PRs; `main` must always run.
- **Ownership:** C owns `os.html`, `game.js` and `style.css`. D owns `index.html`, `world.js` and `world.css`. A owns `server/` and `content/`. B owns `ml/` and the stats page. Ask before editing someone else's files.
- **Blocked for more than 30 minutes?** Say so in the group chat, and use the mock or stub while you wait.
- **Sleep:** each person takes one 3-hour block, staggered so two people are always awake. Put yours here: A ___ · B ___ · C ___ · D ___

## Cut line (drop in this order if behind)

Clerk chat → perks → extra chaos events → duel mode → level 2 → scheme cards → Hall of Shame → **the 3D office** (`os.html` still plays the whole game on its own, with a fake boss and submit, so the demo survives).

**Never cut:** the tool-to-feature pipeline, the memo, the inspector evolution, the held-out evaluation.
