# Defender mode: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the role-swap mode from `docs/superpowers/specs/2026-10-24-defender-mode-design.md`: an AP inbox where the player pays or flags generated invoices, with two callbacks per shift and a reveal of the truth and the inspector's reasons.

**Architecture:** `ml/defender.py` builds a shift from `generate.simulate()`, using a new opt-in case-file snapshot hook, and scores it with the live detector. `POST /defend/shift` serves it, and a bundled `prototype/defend-shifts.json` covers offline play. The UI is a new `#screen-defend` in `os.html`, with its own `defend.js` and `defend.css`.

**Tech stack:** Python 3.10, pydantic, scikit-learn (the existing detector), FastAPI, and vanilla JS and CSS in the prototype.

## Global constraints

- Sunny Diner only (level 1). The detector judges with memory off, at `store.threshold(live, "sunny_diner")`.
- No event logging, no points and no money.
- The snapshot hook draws no RNG, so `build_dataset(seed)` stays byte-identical.
- No `Co-Authored-By` trailers in commits.
- `game.js` is not edited. `os.html` gets only a title button, the screen section, and the two new file includes.

## File map

| File | Change |
| --- | --- |
| `ml/generate.py` | `Run.snapshots`, `simulate(..., snapshots=False)`, and a deep copy in `_submit` |
| `ml/defender.py` | new: `build_shift`, `callback_line`, `export_shifts`, and a CLI |
| `ml/tests/test_defender.py` | new |
| `server/routes/defend.py` | new: `POST /defend/shift` |
| `server/main.py` | register the router |
| `docs/contracts.md` | a new section for the endpoint |
| `prototype/os.html` | title button, `#screen-defend`, includes |
| `prototype/defend.js`, `prototype/defend.css` | new |
| `prototype/defend-shifts.json` | generated with `python -m ml.defender --export` |

### Task 1: Snapshot hook

- **Produces:** `simulate(seed, index, attack_rate, levers=None, origin=..., snapshots=False) -> Run`. With snapshots on, `run.snapshots[k]` is the `CaseFile` before `run.rows[k]`.
- **Test** (`test_simulate_snapshots_change_nothing`): the rows match with snapshots on and off; `len(snapshots) == len(rows)`; `snapshots[k].paid_invoices` doesn't contain `rows[k].invoice`.
- **Run:** `ml/.venv/bin/python -m pytest ml/tests/test_defender.py -k snapshots`

### Task 2: `ml/defender.py`

- **Produces:** `build_shift(seed: int, size: int = 8) -> dict` (the spec's payload), `callback_line(invoice, case, truth, schemes) -> dict`, `export_shifts(path, seeds) -> None`, and `python -m ml.defender --export PATH --shifts N`.
- **Tests:**
  - deterministic per seed
  - size, fraud mix and schemes are in bounds
  - each item's truth matches `payload_schemes` on its snapshot
  - a `bank_change_fraud` item's bank on file equals its account, and its change is in the log
  - each scheme's callback line names the right fact
  - reasons have a feature, text and region
  - the payload passes `json.dumps`
- **Run:** `ml/.venv/bin/python -m pytest ml/tests/test_defender.py`

### Task 3: Server route and contract

- **Produces:** `POST /defend/shift` with body `{"seed": int | null}`, returning the `build_shift` dict.
- **Check:** `TestClient(app).post("/defend/shift", json={"seed": 1})` returns 200 with 8 items.

### Task 4: Defend screen

- **Consumes:** the payload from Task 2, plus `api`, `show`, `toast`, `sfx`, `$` and `$$` from `game.js`.
- **Check in the browser pane:** title → Defend; every item opens; callbacks count down to 0; PAY and FLAG reveal the truth, the inspector's call and the highlights; after item 8, the tally shows. Do this once with `?api=` and once offline.

### Task 5: Full verification

- `ml/.venv/bin/python -m pytest ml` and `ml/.venv/bin/python -m ml.checks` both pass.
