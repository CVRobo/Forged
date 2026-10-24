# Building on the 3D office (plugins)

New rooms and features live in their own files and build on `window.FW`, which `world.js` exposes at the end of the file. That way several people can work at the same time without editing the same lines. Each file is already loaded by `index.html`, after `world.js`:

| File | Owner | What goes in it |
| --- | --- | --- |
| `rooms/boss-office.js` | Boss office | The room west of the main office |
| `rooms/break-room.js` | Break room | The room south of the main office |
| `rooms/records-room.js` | Records & mail room | The room east of the main office |
| `audio.js` | Sound + voice | Ambience, music, better sound effects |
| `voice.js` | Sound + voice | Talking to NPCs with the microphone |
| `features.js` | Gameplay features | Office life and events that don't belong to one room |
| `lan.js` | LAN multiplayer | The other players, the shared boss and Gus (README.md, "LAN multiplayer") |
| `world.js` | 3D polish | Only the furniture, props, characters and lighting sections |

Wrap your file in an IIFE (`(() => { ... })();`) and read everything from `FW`. Don't edit `index.html`, `os.html`, `game.js` or `style.css`.

## Map layout (metres; y is up, the floor is y = 0, walls are 3.2 high)

- **Main office:** x −13…13, z −9…9. The walls already have doorways:
  - **West**, at x = −13, z = −5, 1.8 wide, to the boss office.
  - **South**, at z = 9, x = −6, 2.2 wide, to the break room.
  - **East**, at x = 13, z = 5.5, 2 wide, to the records room.
- **Boss office:** x −22…−13, z −10…0. Call `FW.room({ x0: -22, x1: -13, z0: -10, z1: 0, skip: ["east"] })`.
- **Break room:** x −13…0, z 9…17. Call `FW.room({ x0: -13, x1: 0, z0: 9, z1: 17, skip: ["north"] })`.
- **Records & mail room:** x 13…22, z 0…10. Call `FW.room({ x0: 13, x1: 22, z0: 0, z1: 10, skip: ["west"] })`.
- Stay inside your rectangle. Keep 1 m clear in front of your doorway.

## The `FW` API

**Building:**
- `FW.box(w, h, d, mat, x, y, z, parent?)` and `FW.cyl(rTop, rBot, h, mat, x, y, z, parent?)` add an outlined, shadowed mesh.
- `FW.sphere(r, mat, x, y, z, parent)` adds a sphere.
- `FW.M(color, opts)` makes a toon material.
- `FW.outline(mesh)` adds the black outline to any mesh.
- `FW.collide(cx, cz, w, d)` adds an axis-aligned blocker for the player.
- `FW.signPlane(text, sub, w, h, bg)` makes a plane with a printed sign.
- `FW.canvasTex(w, h, draw)` and `FW.redraw(tex)` make and refresh a canvas texture.
- `FW.room({ x0, x1, z0, z1, floor: [c1, c2], wallColor, skip, doors })` builds the floor, ceiling and walls. Wall segments collide and fade automatically when they block the camera.
- `FW.wallRun(axis, fixed, from, to, doors)` builds an extra wall, for example an internal partition.

**Characters:**
- `FW.makeChar({ shirt, pants, skin, tie, look: { hair, hairColor, brows, mouth, nose, glasses, mustache, teeth, lids, earrings, wide }, name, tagColor, scale })` creates a character.
- `FW.animWalk(ch, dt, speed)`, `FW.seatPose(ch, typing)` and `FW.standPose(ch)` pose it.
- The existing characters are in `FW.npcs`: `kevin`, `dana`, `inspector`, `clerk` and `boss`.

**State:**
- The player: `FW.player` (`.g` is the group) and `FW.P`. `P.phase` is one of `idle`, `briefing`, `forging`, `printing`, `pickup`, `carrying`, `judging` or `result`. Also `P.carrying`, `P.seated`, `P.fp` and `P.frozenUntil`.
- The boss: `FW.B` (`state`, `sus`, `pauseUntil`) and `FW.BOSS_PATH`, an array of `[x, z]` points you may replace. In a LAN game `B.remote` is true when another player's game walks him: don't move him or start events that do (like a fire drill) then.
- `P.live` is true in a LAN game, where the Game Menu doesn't freeze the office.
- Locations: `FW.CHAIR`, `FW.PRINTER`, `FW.BOOTH`, `FW.IN_TRAY`, `FW.CLERK_DESK`.

**Hooks:**
- `FW.onUpdate((dt, now) => {})` runs every frame.
- `FW.onMessage(m => {})` receives every message from the computer (`hud`, `phase`, `print`, `verdict`, `stand`; see README.md).
- `FW.addInteraction({ label: () => "Do thing", can: () => bool, act: () => {} })` adds an action for the **E** key. The first interaction whose `can()` is true wins, so keep `can()` tight: use `FW.near({ x, z }, radius)`.

**Effects:**
- `FW.say(ch, html, ms, kind)` shows a speech bubble; `kind` is `""`, `"paid"` or `"flagged"`.
- `FW.wtoast(text, kind)` shows a toast; `kind` is `""`, `"good"` or `"bad"`.
- `FW.sfx(kind)` plays a sound effect. `FW.setSfx(kind, fn)` overrides or adds one, and `FW.audio()` gives you the AudioContext.
- `FW.flashVignette()` flashes the screen edges red. `FW.burstConfetti(x, y, z)` fires confetti.
- `FW.pinVerdict({ caught, scheme, vendor })` pins a verdict to the corkboard and the TV. `FW.setTag(ch, label, color)` rewrites a character's name tag.
- `FW.toOS(type, data)` sends a message to the computer. A new message type does nothing until C handles it in `game.js`, so list it in your report.
- Helpers: `FW.rand`, `FW.pick`, `FW.clamp`, `FW.money`.

## Rules

- Rooms must help the player's main job: forging, printing, delivering, and avoiding the boss and the inspector. Every room needs at least one interaction that matters to that loop, not just decoration.
- The style is chunky, cartoonish and outlined, using primitives only. Use no external models, images or libraries; plain Three.js r128 is already loaded.
- Performance: build meshes once and only move them in `onUpdate`. Never create geometry, materials or textures every frame.
- Check syntax with `node -e "new Function(require('fs').readFileSync('FILE','utf8'))"`.
