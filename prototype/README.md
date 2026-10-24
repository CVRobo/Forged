# Forged: UI/UX prototype

A playable mockup of the desk, with no AI and no backend. Open `index.html` in a browser, or serve the folder:

```
python -m http.server 8765
```

## What works

- Title screen, level select (Sunny Diner and St. Mercy are playable; levels 3 and 4 are shown as locked), and a separate color palette for each level
- Round flow: briefing and scheme pick → forging → cover email → drag the envelope into the outbox → PAID/FLAGGED stamp → corkboard "Never again" scene with the version going up → patch notes and shop
- Six tools with per-round caps and a shared edit budget: whiteout, coffee, photocopier, scissors and tape, stamp rack, and burner pen (unlocked in the shop)
- Leaked memo with three rules, one of them a decoy, plus real/fake marking
- Heat meter, the "boss walks by" event (Space to hide), perks and unlocks, scheme cards, and a desk that gets messier each round
- **Detector view** (press `D`): the structured record the model would receive (design doc, section 5)

## What is mocked (the backend team replaces these)

- `computeTells()` / `submit()` in `game.js`: a rule-based verdict that stands in for the detector
- Clerk replies and the persuasion score: keyword matching that stands in for the LLM
- Memo rules: a fixed pool per level instead of the detector's top features
- Inspector lines: a cached pool for each level

Hotkeys: `1`–`6` select tools · `Esc` drops the current tool · `D` opens the detector view · `Space` hides the invoice
