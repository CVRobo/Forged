/* Where the game's API lives (game.js, menu.js and lan.js read window.FORGED_API; ?api=<url> still wins).
 * Left blank here, so the computer plays offline against the scripted Gus. serve.py answers this file
 * itself when it fronts the backend (API_UPSTREAM, the Dockerfile at the repo root), pointing the game at
 * the same site, where the real fraud model judges every order. */
window.FORGED_API = window.FORGED_API || "";
