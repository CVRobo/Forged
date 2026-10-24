# LAN multiplayer: design

Date: 2026-10-24. Branch: `b/lan-multiplayer`, cut from main after PR #6 (the c/desks merge).

## Goal

Up to 4 people play in the same 3D office over a local network. The LAN owner is one of the 4.

The desk system from c/desks drives the design. Each player gets one of the four cubicles. The coworker at a desk steps away while a player has it, and `FW.assignDesks` / `FW.onDeskChange` were built for this. Each player's saved look (customize.js) is what the others see.

## Decisions

| Question | Decision |
| --- | --- |
| Mode | One shared office, solo scores. Each player forges at their own desk on their own computer. There's one boss and one Gus for everyone. Gus's brain (version, learned warning signs, memory of fooled orders) is shared per shop, so a win by anyone teaches him and a trick someone else burned gets you caught too. The Tab list shows the room's live standings. |
| Session | Drop-in, no timer. Players join and leave any time. Desks go in join order, and any free desk can be taken with E. |
| Hosting | `python3 serve.py` already serves the game on every network interface. It now also runs the room at `ws://<host>:<port>/lan`, using only the standard library, so nothing needs installing. Whoever runs it is the LAN owner. Friends open the LAN address it prints. |
| Owner | The earliest player connected from the host machine, or the earliest player if nobody plays on the host. The owner's browser runs the boss and the fire drills, and everyone else mirrors them. When the owner leaves, the next player takes over. |
| Capacity | 4 players, the owner included. A 5th is told the room is full. |

## Architecture

- **`prototype/lan_room.py`**: the room, as pure logic with no sockets. `join`, `leave`, `handle(pid, msg)` and `snapshot()` return `(targets, message)` pairs. It owns players, desks, the owner, scores, the boss state and Gus's brains.
- **`prototype/lan_ws.py`**: the server side of RFC 6455 that a browser needs. It computes the accept key, reads a masked frame (with 16- and 64-bit lengths and continuations), writes a text frame, and handles ping/pong and close.
- **`prototype/serve.py`**: unchanged for files. A `GET /lan` with `Upgrade: websocket` becomes a room connection. A tick thread sends snapshots 15 times a second. At startup it prints the LAN address.
- **`prototype/lan.js` + `lan.css`**: the client, a plugin on `window.FW`. It puts a LAN game button and lobby on the Clock in card and opens the WebSocket. It sends your state 10 times a second and draws the other players (their look, name tag, walking, seated, carrying). It relays verdicts, scores and what Gus learned. On guests it mirrors the boss.
- **Small hooks in existing files:**
  - `world.js`:
    - `B.remote`: guests skip the boss's movement but keep the per-player checks (behind your chair, vision cone, small talk).
    - `B.faceAt`: the owner's boss turns to the remote player he stopped.
    - `P.live`: the Esc menu doesn't freeze a shared office.
    - `pinVerdict()`: corkboard pin and TV point for someone else's verdict.
    - `FW.setTag` and `FW.envelopeMat` are exposed.
  - `features.js`: guests don't roll random fire drills. The owner's drill is relayed to them.
  - `game.js`: posts `gus-learned` (what a win taught Gus) and accepts `gus-brain` (the room's Gus for your shop). While in a room it doesn't overwrite your solo save. With `?api=` the server already shares Gus, so none of this runs.
  - `menu.js`: `ForgedMenu.setRoom(players)` makes the leaderboard and the Tab list show the room.
  - `index.html`: loads `lan.css` and `lan.js`.

## Protocol

JSON text frames. Client → server:

| `t` | Fields | Effect |
| --- | --- | --- |
| `hello` | `name`, `look` | First message. Reply `welcome` or `full` (then close). |
| `state` | `x`, `z`, `ry`, `sp`, `f` (flags, as in `snap`) | Where you are. Goes into the snapshots. |
| `desk` | `n` | Take desk n if it's free. Everyone gets `players`. |
| `name`, `look` | `name` / `look` | Profile change. Everyone gets `players`. |
| `score` | `money`, `patches`, `round` | Standings. Everyone gets `players`. |
| `verdict` | `caught`, `payout`, `scheme`, `line` | Relayed to the others with your name. |
| `learned` | `level`, `tells {name: n}`, `memory [signature]` | Gus studied your win. The room's brain for that shop goes up one version, and everyone gets `brain`. |
| `boss` | `x`, `z`, `ry`, `vis`, `st`, `i`, `pz` | Owner only: the boss for the snapshots. |
| `bust` | `x`, `z` | The boss caught you with the slip. Relayed to the owner so he stops for everyone. |
| `drill` | | Owner only: a fire drill started. Relayed to the others. |
| `ping` | | Keep-alive. |

Server → client: `welcome {id, desk, owner, players, brains}`, `full`, `players {players, owner}`, `snap {p: [[id, x, z, ry, sp, flags]], b}`, `verdict`, `brain {level, brain, by}`, `bust`, `drill`. In `snap`, the flags are bits: 1 seated, 2 carrying, 4 clocked in.

## Errors and edges

- **No room at this address** (another static server, or `file://`): the lobby explains how to host.
- **Connection lost:** a toast. The other players vanish and your game carries on solo.
- **Desk race:** the server decides who gets a desk. A refused move snaps back to your server-assigned desk.
- **Silence:** a player is dropped after 120 s without a message, and clients ping every 5 s. Closed sockets drop at once.
- **Validation:** frames are capped at 64 KB. Names are capped at 16 characters, positions are clamped, unknown look keys are dropped, and list sizes are bounded. Names render with `textContent` or escaped.

## Testing

Run fewer tests, as asked:

- One pytest file with five tests: the 4-player cap including the owner, the owner hand-off, desks, the shared brain, and an end-to-end WebSocket run with 5 raw clients.
- `node` syntax checks.
- One browser run with several tabs.

## Out of scope for v1

Text or voice chat, synced coffee runs, phone, doors and printer, a match timer, a dedicated server, and play over the internet.
