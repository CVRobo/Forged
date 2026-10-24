# Forged: Game Design Doc (v0.1)

Working title. Draft for the Cal Hacks build. Decisions made so far are marked **\[Decided\]**, open items are in the last section.

## 1. One-line pitch

You are a master forger sneaking fake invoices past an AI inspector. Every time you beat it, the inspector is retrained on your trick and comes back smarter, so the game gets harder because of how you play.

## 2. Goals

**Player goal:** slip invoices past the inspector, earn money, and unlock new tools. Secondary goal: find the trick that forces the biggest patch (Hall of Shame).

**Project goals:**

- A playable loop a judge can understand in 30 seconds.
- A real, measurable improvement in the detector across versions.
- Clean evidence for sponsor tracks (see section 15).

**Tone \[Decided\]:** stylized, colorful, light heist comedy. Fictional companies and cartoonish paperwork only. It should read as a game about outsmarting a detector, not a how-to for real fraud.

## 3. Core loop (one round, about 60 to 90 seconds)

1. **Briefing.** The client company's file and the inspector's daily memo appear on the desk (section 9).
2. **Pick a scheme.** Choose from the level's available schemes (e.g., "vendor changed banks", "duplicate bill with small changes").
3. **Forge.** Use two to four tools on the invoice (section 5), within each tool's use limit.
4. **Pitch.** Write a short cover email, or talk the clerk NPC into it (section 10).
5. **Submit.** Drag the envelope into the outbox slot. A random event, like the boss walking by, may interrupt.
6. **Inspection.** The scanner whirs, then stamps the invoice PAID or FLAGGED, with the inspector's reaction line.
7. **Payout or patch.**
   - If PAID: money is added and the trick is logged as a success.
   - If FLAGGED: the inspector pins it to the corkboard, the trick joins the retraining queue, and the player sees what gave it away.
8. **Between rounds.** Patch notes show what the inspector learned, and the player spends money on unlocks and perks.

## 4. The desk (interface)

The desk is a set of objects the player handles, not a form to fill in: at most three typed fields (vendor, amount, cover email), and everything else is done with tools. Top-down 2D, built mostly with CSS and drag-and-drop.

**Layout**

- **Invoice sheet** (center): pre-filled from the scheme the player chose. The player edits it by using tools on it.
- **Case file** (left): the target company's normal vendors, amounts, and approvers. Reading it is the investigation part of the game.
- **Daily memo** (pinned top left): the boss's leaked instructions to the inspector. Partly true (see section 9).
- **Toolbox** (bottom): whiteout, coffee mug, photocopier, scissors and tape, stamp rack, burner pen. Tools unlock over time.
- **Cover email pad** (right): a short note to the clerk, scored by the LLM.
- **Outbox slot** (far right): the submit action. The scanner sits beside it and wears the inspector's face.
- **Heat meter** (top): suspicion that builds when the player repeats tricks.
- **Inspector panel:** name, version number, and a one-line reaction after every round.
- **Phone** (post-MVP): reserved for a voice mechanic.

**How the player forges**

1. Choose a scheme and read the case file.
2. Use two to four tools on the invoice (each tool has a limited number of uses per round).
3. Optionally edit the vendor, amount, and cover email.
4. Drag the envelope into the outbox slot.

The model never sees the gestures, only the final invoice state (section 5), so the tactile layer can be as silly as we like without changing the ML.

**Feedback rules:** every action has a sound, every submit has a *ka-chunk*, a stamp animation (PAID or FLAGGED), and a small screen shake on a catch. These carry a lot of the game feel for very little work.

**Visual evolution:** the desk gets messier as the run goes on (coffee rings, pinned notes, stacked envelopes), so progress is visible without any UI.

## 5. Forgery tools and the data they produce

Every tool is a front end for structured features, so the player's gestures turn into clean training data. Start with six tools; add more only if the first six are stable.

| Tool | What the player does | Features it changes | Tradeoff for the player |
| --- | --- | --- | --- |
| Whiteout | Erase a field, then write over it | `field_altered` flag, edited field value | Fixes a field, but altered fields raise suspicion |
| Coffee mug | Drag onto a region to stain it | `legibility` score for that region (0 to 1) | Hides a tell, but heavy stains look odd |
| Photocopier | Run the invoice through it | `scan_quality`, `copy_generation` count | Hides edits, but copies of copies look fake |
| Scissors and tape | Cut in a different bank number | `bank_account`, `field_altered` | Redirects the money, the core of most schemes |
| Stamp rack | Pick and place a stamp (PAID, APPROVED, URGENT) | `stamp_type`, `stamp_position`, `stamp_matches_vendor` | The right stamp calms the inspector, the wrong one is a tell |
| Burner pen | Spoof the sender domain or letterhead | `domain_mismatch`, `letterhead_match` | Better disguise, higher heat |

**Invoice record (one row per submission):** level, scheme, vendor, amount, bank account, line items, dates, PO number, sender domain, the feature flags above, cover email text, detector version, verdict, and whether the player was paid.

**Training rules**

- A missed attack is stored as a fraud example. A caught attack is stored too, because it tells us what the current version already handles.
- Legitimate invoices come from the same generator and pass through the same tools and renderer, at realistic rates (some real invoices are coffee-stained, photocopied, or stamped).
- Tool flags carry no label by themselves. If only forged invoices used tools, the detector would learn "stain means fraud" instead of fraud.
- The ML person and the frontend person agree on this feature list before building, so the game and the model stay connected.
- Judging uses structured features and text only, not image analysis of the rendered invoice, which is too heavy for a weekend.

**Honest limit:** the detector learns how players in this game forge invoices, not how real fraudsters do. We say so in the demo.

## 6. Levels and visual themes

**\[Decided\]** Each level is a client industry with its own color palette, desk props, inspector personality, and invoice style. Two levels are polished first, with more added if time allows.

| Level | Setting | Palette | Inspector personality | Notes |
| --- | --- | --- | --- | --- |
| 1 | Sunny Diner Supply | Warm amber, teal, cream | Cheerful, easily distracted (easy) | Tutorial level, simple invoices |
| 2 | St. Mercy Hospital | Mint, clinical blue, white | Procedural, rule-driven | Strict formats, higher amounts |
| 3 (stretch) | Port Nocturne Shipping | Navy, sodium orange | Gruff, remembers everything | Many vendors, line-item heavy |
| 4 (stretch) | Neon Arcade Holdings | Magenta, cyan, black | Paranoid, flags anything unusual | Boss-style level |

Colors are defined as CSS variables per level so adding a level means adding a palette, a case file, and a scheme list, not rebuilding the UI.

## 7. Schemes (what the player chooses each round)

Each scheme has different weak points, so players cannot repeat one trick forever.

- **Changed bank details:** a known vendor "updates" their account.
- **Duplicate with tweaks:** a slightly altered repeat of a real invoice.
- **Phantom supplier:** a new vendor that does not exist.
- **Boss request:** an urgent payment that appears to come from an executive.

Levels expose different subsets of schemes. Later levels add combinations.

## 8. Rules that make it a puzzle, not a text box

- **Validity gate:** an invoice only scores if it still looks plausible (checked by a cheap LLM or rule check) and still carries the fraud payload (money goes to the attacker's account).
- **Edit budget:** a limited number of tool uses per round (each tool has its own cap), so choices matter.
- **Heat:** bigger amounts pay more but raise suspicion. Repeating the same trick raises heat faster.
- **Case file matters:** invoices that match the target company's normal patterns are harder to detect, which rewards reading the file.

## 9. The inspector and the daily memo

The inspector is the game's main character, and the memo turns the detector into something the player has to figure out, borrowing the changing rulebook from Papers, Please.

**Daily memo**

- At the start of each round, a leaked memo from the inspector's boss lists three rules, such as "Alert: wire transfers over $5,000" or "Check anything from a .biz domain."
- Two lines are generated from the detector's actual top features (the real tells). One line is a decoy written by the LLM. The player is told that one rule is wrong, but not which.
- Players work out which rules are real by watching which earlier tricks got stamped. That deduction is the puzzle, and it makes the model's behavior visible and fun.
- Cost: top features from the classifier (a few lines of code) plus one cached LLM call per round.

**Inspector evolution (the model improving, made visible)**

| Detector versions | Look | Behavior |
| --- | --- | --- |
| v1 to v3 | Sleepy intern with a stapler | Misses obvious tricks, easy to impress |
| v4 to v6 | Clerk with a magnifying glass | Checks amounts and bank changes |
| v7 to v9 | Auditor with a UV lamp | Catches tool traces like whiteout and copies |
| v10 and up | Cyborg with a monocle | Remembers the player's favorite tricks |

Art is one sprite per stage plus reaction lines, so the cost is low.

**Corkboard scene (the retrain, as a moment)**

After a catch, the inspector pins the trick to a corkboard with red string, says "Never again," and the version number ticks up. It lasts about three seconds and makes the retrain feel like something he did because of this player. If the retrain is still running, the scene plays anyway and the new version goes live at the start of the next round.

**Dialogue**

Reaction lines come from the cached pool, with the LLM generating a few fresh ones per level. Each level's inspector has a distinct voice (distracted by pie, reads everything in a monotone, grunts). If the API is slow, the cached lines are used.

## 10. The fun layer

Every feature here borrows from an existing game and must change what the detector sees, so the silliness is gameplay and not decoration. Features are ranked by fun per hour of work; build them in this order.

| Priority | Feature | Borrowed from | What it adds | Build cost |
| --- | --- | --- | --- | --- |
| 1 | Tactile tools (section 5) | Untitled Goose Game | Replaces forms with objects | Medium, mostly frontend |
| 2 | Inspector evolution and corkboard | Phoenix Wright | Makes the retrain a scene | Low |
| 3 | Daily memo | Papers, Please | Deduction puzzle, shows the model | Low |
| 4 | Boss walks by | Hitman | A 3-second panic moment | Low |
| 5 | Perks | Balatro | Stacking modifiers, varied runs | Medium |
| 6 | Clerk chat | Phoenix Wright | The LLM at its best | Medium |
| 7 | Mini-tasks | WarioWare | Variety between rounds | Medium to high |

**Boss walks by:** a random event during forging. A shadow crosses the desk and the player has two seconds to hit a key to slide a newspaper over the invoice. Success is free. Failure adds heat.

**Perks (stack up to three per run).** Each perk changes a feature or a rule:

- **Coffee Connoisseur:** stains are twice as effective at lowering legibility.
- **Rubber Stamp Collector:** official stamps lower heat.
- **Night Shift:** invoices sent late pay double and raise suspicion.
- **Copy Machine Whisperer:** photocopies do not count toward the generation penalty.
- **Smooth Talker:** the clerk's persuasion score gets a bonus.
- **Paper Shredder:** one caught trick per level is not added to training (limited use, so the player cannot starve the detector).

**Chaos events (one per round at most):** the printer jams (lose a tool use), a pigeon lands on the desk (it moves your invoice), the fire alarm sounds (grab one extra envelope, but a random field gets smudged).

**Clerk chat.** The cover email becomes a short exchange with a clerk NPC who has a quirk (loves puns, afraid of the manager, always on lunch break). The LLM scores whether the pitch fits that personality. Fallback: if the API is slow, use a single scored text box.

**Mini-tasks (stretch):** a five to ten second task before submit, such as tracing a signature or aligning a stamp. Task accuracy sets a feature (for example `signature_match`). Cut first if time runs short.

**Wacky content:** vendor names like Dave's Discount Anvils, Existential Dread Consulting LLC, and Gary's Totally Real Plumbing. Write about 40 for the pre-generated pool, mixing silly and plausible so the detector cannot learn "funny name means fraud." Use legitimately silly names on real invoices too.

**Test for any new feature:** does it change what the detector sees, and does it give the player a real choice? If not, cut it.

## 11. The detector (the model)

**Input:** structured invoice fields (not PDFs or images) plus the tool flags from section 5 and the cover email text.

**Model \[suggested\]:** sentence embeddings for text fields plus engineered features (amount versus vendor history, new bank account, domain mismatch, urgency language, timing), fed to a fast classifier (logistic regression or LightGBM). Retrains in seconds. A fine-tuned transformer is a stretch goal only.

**Versioning:** every retrain creates a numbered version (v1, v2, ...). Versions are stored so they can be compared and replayed.

**Retraining policy:**

- Missed attacks are added as positive (fraud) examples.
- Legitimate invoices are mixed in so the detector does not learn to flag everything.
- Retrain in the background and swap the new version in between rounds, so the game never freezes.

**Evaluation (important, this is the proof of improvement):**

- A fixed held-out set of attacks that were never used in training.
- A separate set of legitimate invoices, to measure false positives.
- Per version: catch rate, false-positive rate, and catch rate on the held-out attacks.
- Show these as a live chart. If catch rate rises but false positives also rise, say so honestly.

**Cold start:** pre-train v1 on a few hundred generated invoices and pre-seed the leaderboard so the demo never begins empty.

## 12. The attacker side (LLM)

**\[Decided\]** Hybrid generation:

- **Pre-generated pool:** a batch of invoices per level and scheme, generated ahead of time and cached. This gives reliability and low cost.
- **Live LLM for the cover email:** scores the player's email for how well it fits the clerk NPC (section 10) and generates the inspector's dialogue lines. Falls back to cached lines if the API is slow.

The LLM also plays the rival in duel mode (section 14).

## 13. Progression and rewards

- **Money:** earned from invoices that get through, spent on unlocks.
- **Unlocks that add options, not just stats:** new letterhead styles, the spoof tool, a dossier revealing the inspector's recent blind spots, extra edit budget.
- **Patch notes as reward:** when a player's trick forces a retrain, show "Inspector v7 now catches \[pattern\], learned from N invoices." Attribute the biggest ones to the player in the **Hall of Shame**.
- **Case file cards:** each successful scheme becomes a collectible card (name, method, payout).
- **Streaks:** bonus for consecutive successful rounds with different schemes.
- **Leaderboard:** total money and number of patches caused.
- **Forensic replay:** after a catch, highlight which fields tipped off the detector, so the player gets a hint for the next attempt.

Perks (section 10) are the main unlock: up to three stack per run and change how the tools behave, so every run plays differently.

## 14. Modes

**\[Decided\]** Solo is the main mode. Duel is the finale and the spectator-friendly mode.

- **Solo:** the player versus the inspector across levels.
- **Duel:** the player and the LLM race on the same detector for 60 seconds, scored by money siphoned. Spectators can watch both sides on a split screen.
- **Role swap (stretch):** the player acts as the auditor, sorting real from fake invoices against the detector.

## 15. Sponsor tracks and what each needs

| Track | What we need to show |
| --- | --- |
| Arize | Evidence it was used and improved the app: traces of attacks and verdicts, evals per detector version, catch rate rising |
| Redis | Use beyond caching: agent memory for the attacker, vector search over past invoices, game state and leaderboard |
| Sentry | Reliability and observability, plus clear teamwork under pressure |
| Anthropic | Built with Claude Code, a meaningful problem (protecting small businesses from invoice fraud), ambition |
| Band (maybe) | At least 2 agents collaborating on their platform. Only if it improves the game, e.g., forger and investigator agents |
| Terac (maybe) | Training data must come from annotations collected during the event. Conflicts with synthetic data, so ask the sponsor before building around it |
| Deepgram (later) | Voice must be essential, not tacked on. Only for the optional phone mechanic |

Confirm each track's exact requirements with the sponsors at the start of the event.

## 16. Tech stack (suggested)

- **Frontend:** Next.js, Tailwind, WebSockets, Recharts for the live chart.
- **Backend:** FastAPI (Python) with WebSockets for round updates.
- **State and memory:** Redis Cloud.
- **Attacker and dialogue:** Claude API with structured JSON output, plus a cheap model for the validity gate.
- **Detector:** embeddings plus LightGBM or logistic regression, retrained in the background.
- **Observability:** Arize and Sentry.
- **Deploy:** Vercel for the frontend, Render or Fly for the backend.

## 17. Team roles

- **ML:** detector, retraining loop, held-out evals, version tracking.
- **Backend/lead (you):** FastAPI, attacker and validity gate, Redis, Arize and Sentry instrumentation, round logic.
- **Frontend:** desk screen, stamp and scanner animations, heat meter, patch notes, live accuracy chart, level palettes.

## 18. Build order and cut line (36 hours)

**Hours 0 to 2: contracts**

- ML and frontend agree on the invoice record and the six tool features (section 5), and the verdict API shape. Nothing else starts before this is written down.

**Hours 2 to 10: minimum loop**

- One level, one scheme, three tools (whiteout, scissors and tape, stamp rack), template invoices, a baseline detector, one retrain, and an accuracy chart. The desk can be ugly. Get one invoice through every layer end to end before anything else.

**Hours 10 to 22: the game**

- All six tools on the desk, the outbox and scanner stamp animation, heat meter, validity gate, cover email scoring, daily memo, inspector sprites and the corkboard scene, boss-walks-by event, second level with its own palette.

**Hours 22 to 28: tracks and proof**

- Arize evals, Sentry, Redis memory, held-out test set and the version chart. Perks and the clerk chat go here if the core is stable.

**Hours 28 to 36: polish and demo**

- No new features. Duel mode only if everything else is stable. Rehearse the demo at least three times and record a backup video.

**Cut line (drop in this order if behind):** mini-tasks, clerk chat, perks, extra chaos events, duel mode, extra levels, case file cards, Hall of Shame, voice mechanic, Band or Terac integration. Never cut: the tool-to-feature pipeline, the memo, the inspector evolution, and the held-out evaluation.

## 19. Demo script (3 minutes)

1. Open with the problem: invoice fraud costs businesses real money.
2. Show Inspector v1, the sleepy intern, catching only part of the attacks.
3. A judge plays one round: reads the memo, uses two tools, drops the envelope in the outbox.
4. Their trick gets through. We hit retrain and the inspector pins it to the corkboard.
5. The same trick is stamped FLAGGED by v2, and the judge sees the patch note.
6. Show the version chart: catch rate up on the held-out attacks, false positives under control.
7. Close with the sponsor tooling (Arize traces, Redis memory) and one sentence on next steps.

Keep a recorded backup of a full run in case Wi-Fi or an API fails.

## 20. Risks and mitigations

- **The game turns into a form again:** keep typed fields to three, and cut any feature that does not change the detector's input or give the player a real choice (section 10 test).
- **Silly tools become shortcuts for the model:** apply tool effects to legitimate invoices at realistic rates so "coffee stain" does not mean fraud (section 5).
- **Game is not fun:** playtest early with teammates and other hackers, and cut anything that feels like filling out a form.
- **Improvement looks fake:** use the held-out set and legitimate invoices, and report the numbers honestly.
- **Retraining is slow:** keep the model small and retrain in the background. The corkboard scene covers the wait.
- **Memo decoys confuse judges:** tell the player that one rule is false, and make the real tells match the detector's top features.
- **API failure or latency:** cached invoices, clerk replies, and dialogue as fallbacks.
- **Scope creep:** respect the cut line, and ship two polished levels before adding a third.
- **Realism question from judges:** be upfront that this is a training and red-teaming harness on synthetic data, and that real invoice data is the next step.

## 21. Open questions

- Final game name.
- Final list of six tools and their feature names (ML and frontend settle this in the first two hours).
- Art approach: hand-drawn sprites, a free asset pack, or generated images, and who owns it.
- Whether to pursue Band or Terac after checking with sponsors.
- Whether the duel mode ships in the first demo.
- How judges will experience the project (play at the table, scripted demo, or both). The design supports either.
- Which model the detector uses if the lightweight classifier is not good enough.

## 22. Decisions log

- Visual theme: stylized and colorful, with a different color palette per level.
- Main mode: solo against the detector, with a duel finale.
- Invoice generation: hybrid, with a pre-generated pool and a live LLM cover email.
- Levels: two polished first, more if time allows.
- Voice mechanic: maybe later, after the core is stable.
- Desk design: tactile tools instead of form fields, with at most three typed fields.
- Tools feed structured features to the detector, never image analysis.
- Fun features are built in the priority order of section 10, and each must change what the detector sees.
- The daily memo uses real detector features plus one decoy rule.
