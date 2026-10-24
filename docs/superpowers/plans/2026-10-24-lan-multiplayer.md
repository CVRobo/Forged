# LAN Multiplayer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Up to 4 players, the LAN owner included, share the 3D office over a LAN: one desk each, one boss, one Gus who learns from everyone, and drop-in with no timer.

**Architecture:** `serve.py` (stdlib) hosts a room over a hand-rolled WebSocket at `/lan`. The room is pure Python logic that returns the messages to send. `lan.js` is a `window.FW` plugin: lobby, avatars, the boss mirror and relays. A few small hooks go into world.js, features.js, game.js and menu.js. Spec: `docs/superpowers/specs/2026-10-24-lan-multiplayer-design.md`.

**Tech Stack:** Python 3.10 standard library, plain browser JS with Three.js r128 (already loaded), pytest.

## Global Constraints

- 4 players at most, the owner included. A 5th gets `{"t": "full"}`.
- Drop-in, no timer.
- Hosting needs nothing beyond the Python standard library. `python3 serve.py [port]` keeps working as before.
- With `?api=` the server already shares Gus, so brain sync is off.
- No `Co-Authored-By` trailers in commits or PRs.
- Run fewer tests: one pytest file (5 tests), node syntax checks, one browser run.

---

### Task 1: The room (`prototype/lan_room.py`)

**Files:** Create `prototype/lan_room.py` and `prototype/tests/test_lan.py` (tests 1–4).

**Interfaces (produced):**
- `Room(share="")` has the attributes `players: dict[int, Player]` and `brains: dict[int, dict]`. `MAX_PLAYERS = 4`.
- `Room.join(name, look, local, now=0.0) -> (pid | None, out)` and `Room.leave(pid) -> out`.
- `Room.handle(pid, msg, now=0.0) -> out`, `Room.snapshot() -> out` and `Room.expire(now) -> (dropped_pids, out)`.
- `Room.owner() -> pid | None` is the earliest local player, or else the earliest player.
- `out` is a list of `(pids: list[int], message: dict)`.
- A player has `id`, `name`, `look`, `local`, `desk`, `state` (`[x, z, ry, sp, f]` or `None`), `money`, `patches` and `round`.

- [ ] Write tests 1–4: the cap with the owner, the owner hand-off, desks, and the shared brain.
- [ ] Run `python3 -m pytest prototype/tests/test_lan.py -q`. They fail because there's no module yet.
- [ ] Implement `lan_room.py`. Run the tests and they pass. Commit.

### Task 2: WebSocket and host (`lan_ws.py`, `serve.py`)

**Files:** Create `prototype/lan_ws.py`. Modify `prototype/serve.py`. Add test 5.

**Interfaces:**
- `lan_ws.accept_key(key) -> str`.
- `lan_ws.encode(payload: bytes, opcode=1, mask=None) -> bytes`.
- `lan_ws.Conn(sock)` with `recv_message() -> str | None` (it raises `Idle` or `Closed`), `send_text(str) -> bool` and `close(code=1000)`.
- `serve.make_server(port, bind="") -> ThreadingHTTPServer` with `.lan: LanHost`. `LanHost.tick_forever(stop: threading.Event)`.

- [ ] Write test 5: 5 raw clients get 4 `welcome` and 1 `full`. A state reaches another client's `snap`, and a verdict is relayed.
- [ ] Implement it. Run the test file and all 5 pass. Commit.

### Task 3: Hooks in the existing game files

**Files:** Modify `prototype/world.js`, `prototype/features.js`, `prototype/game.js` and `prototype/menu.js`.

- `world.js`:
  - `B.remote`: skip the movement and keep the checks.
  - `B.faceAt`, and `B.bustedAt = now` on a bust.
  - `P.live`: no freeze while paused.
  - `pinVerdict(m)` is split out of `onVerdict` and exported along with `setTag`.
- `features.js`: no random drill while `B.remote`.
- `game.js`:
  - After a win (not on the API path), post `gus-learned {level, version, tells, memory}`.
  - Handle `gus-brain` (apply it and set `S.lanBrain`) and `gus-solo` (reload your save).
  - `saveBrain` does nothing while `S.lanBrain`.
- `menu.js`: `ForgedMenu.setRoom(players | null)`. In a room the board and the Tab list show the room and skip the API fetch.
- [ ] Make the edits. Run `node -e "new Function(require('fs').readFileSync(f,'utf8'))"` on each file. Commit.

### Task 4: Client (`lan.js`, `lan.css`, `index.html`)

- `lan.js`:
  - A LAN game button and lobby on the Clock in card (it opens itself with `?lan`), with the name, the players, the share address and a Leave button.
  - The WebSocket and the hello. It sends state at 10 Hz and pings every 5 s.
  - Avatars use `makeChar` and `restyleChar`, a desk-coloured tag, a carried slip, and seated or walking poses.
  - `assignDesks` from the roster. An `onDeskChange` hook sends `desk`.
  - On the owner: send the boss and relay drills. On guests: mirror the boss, relay busts, and start relayed drills.
  - Relay verdicts, scores and `gus-learned`, and push `gus-brain`.
  - A HUD chip, and toasts for joins and leaves. `window.forgedLan` for debugging.
- [ ] Write it, syntax check it, commit.

### Task 5: Docs

- [ ] `prototype/README.md`: a LAN section (hosting, joining, what's shared, limits) and the new postMessage types.
- [ ] `prototype/PLUGINS.md`: the new `FW` hooks. Commit.

### Task 6: Final run test, then merge

- [ ] Run `serve.py` on a spare port and open several tabs: the owner and guests clock in. Check the avatars at their desks, the boss mirrored, a verdict relayed, a desk switch, and a 5th tab told the room is full. Take screenshots.
- [ ] Push `b/lan-multiplayer`, open a PR into main and merge it once the run test passes.
