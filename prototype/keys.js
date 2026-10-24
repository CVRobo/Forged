/* Forged — key bindings shared by the office (index.html) and the computer (os.html).
 * Minecraft-style defaults; every action can be rebound in Game Menu → Options → Controls.
 * Bindings live in localStorage, which both pages share, so a change in one shows up in
 * the other right away (the `storage` event, plus a direct call in the same page).
 * A binding is a KeyboardEvent.code ("KeyE", "ShiftLeft") or "Mouse2" for right-click.
 */
(() => {
"use strict";
const KEY = "forged-keys";
const MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

// Ctrl+W closes the browser tab on Windows and Linux, so sprint is Ctrl only on a Mac
const ACTIONS = [
  { id: "forward", group: "office", name: "Walk forward", keys: ["KeyW", "ArrowUp"] },
  { id: "left", group: "office", name: "Strafe left", keys: ["KeyA", "ArrowLeft"] },
  { id: "back", group: "office", name: "Walk backward", keys: ["KeyS", "ArrowDown"] },
  { id: "right", group: "office", name: "Strafe right", keys: ["KeyD", "ArrowRight"] },
  { id: "sprint", group: "office", name: "Sprint", keys: MAC ? ["ControlLeft", null] : ["ShiftLeft", null] },
  { id: "interact", group: "office", name: "Interact", keys: ["KeyE", "Mouse2"] },
  { id: "camera", group: "office", name: "Toggle first/third person", keys: ["F5", "KeyV"] },
  { id: "playerList", group: "office", name: "Leaderboard (hold)", keys: ["Tab", null] },
  { id: "tool1", group: "computer", name: "Whiteout", keys: ["Digit1", null] },
  { id: "tool2", group: "computer", name: "Coffee mug", keys: ["Digit2", null] },
  { id: "tool3", group: "computer", name: "Photocopier", keys: ["Digit3", null] },
  { id: "tool4", group: "computer", name: "Scissors & tape", keys: ["Digit4", null] },
  { id: "tool5", group: "computer", name: "Stamp rack", keys: ["Digit5", null] },
  { id: "tool6", group: "computer", name: "Burner pen", keys: ["Digit6", null] },
  { id: "drop", group: "computer", name: "Put tool down", keys: ["KeyQ", null] },
  { id: "chat", group: "computer", name: "Talk to the clerk", keys: ["KeyT", null] },
  { id: "detector", group: "computer", name: "Detector view", keys: ["F3", "KeyD"] },
  { id: "hide", group: "computer", name: "Hide the invoice", keys: ["Space", null] },
  { id: "standUp", group: "computer", name: "Stand up", keys: ["ShiftLeft", null] },
];
// fixed, shown in Controls but not rebindable
const FIXED = [
  { group: "both", name: "Game menu / free the mouse", label: "Esc" },
  { group: "computer", name: "Cycle tools", label: "Mouse wheel" },
  { group: "office", name: "Look around", label: "Mouse" },
];

let binds = load();
const listeners = new Set();

function defaults() { return Object.fromEntries(ACTIONS.map(a => [a.id, [...a.keys]])); }
function load() {
  const d = defaults();
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "{}");
    for (const id in d) if (Array.isArray(saved[id])) d[id] = [saved[id][0] ?? null, saved[id][1] ?? null];
  } catch (e) { /* defaults */ }
  return d;
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(binds)); } catch (e) { /* only kept for this visit */ }
  listeners.forEach(fn => fn());
}
addEventListener("storage", e => { if (e.key === KEY || e.key === null) { binds = load(); listeners.forEach(fn => fn()); } });

const NAMES = { Space: "Space", Escape: "Esc", Tab: "Tab", Enter: "Enter", Backspace: "Backspace",
  ShiftLeft: "Left Shift", ShiftRight: "Right Shift", ControlLeft: "Left Ctrl", ControlRight: "Right Ctrl",
  AltLeft: MAC ? "Left Option" : "Left Alt", AltRight: MAC ? "Right Option" : "Right Alt",
  MetaLeft: MAC ? "Left Cmd" : "Left Win", MetaRight: MAC ? "Right Cmd" : "Right Win",
  ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", CapsLock: "Caps Lock",
  Mouse0: "Left Click", Mouse1: "Middle Click", Mouse2: "Right Click", Mouse3: "Mouse 4", Mouse4: "Mouse 5",
  Backquote: "`", Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Backslash: "\\", Semicolon: ";",
  Quote: "'", Comma: ",", Period: ".", Slash: "/" };
function keyName(code) {
  if (!code) return "";
  if (NAMES[code]) return NAMES[code];
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad")) return "Num " + code.slice(6);
  return code;
}

window.ForgedKeys = {
  MAC, ACTIONS, FIXED,
  /** does this keyboard code (or "Mouse<n>") trigger the action? */
  is(action, code) { const b = binds[action]; return !!b && !!code && (b[0] === code || b[1] === code); },
  /** which action of a group does this code trigger (first match) */
  actionFor(code, group) { const a = ACTIONS.find(x => (!group || x.group === group) && this.is(x.id, code)); return a ? a.id : null; },
  get(action) { return [...(binds[action] || [null, null])]; },
  set(action, slot, code) { if (!binds[action]) return; binds[action][slot] = code; save(); },
  reset() { binds = defaults(); save(); },
  /** label for the action's main key, e.g. "Left Shift" */
  label(action) { const b = binds[action] || []; return keyName(b[0] || b[1]) || "unbound"; },
  /** both keys, e.g. "E / Right Click" */
  labels(action) { return (binds[action] || []).filter(Boolean).map(keyName).join(" / ") || "unbound"; },
  keyName,
  /** actions in the same group (or "both") that share a key with this one */
  clashes(action) {
    const a = ACTIONS.find(x => x.id === action); if (!a) return [];
    const mine = (binds[action] || []).filter(Boolean);
    return ACTIONS.filter(o => o.id !== action && o.group === a.group && (binds[o.id] || []).some(c => c && mine.includes(c))).map(o => o.id);
  },
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
};
})();
