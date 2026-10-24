"""The LAN room behind serve.py: up to 4 players, the owner included, in one office.

Pure logic, no sockets. join, leave, handle, snapshot and expire return the messages to send
as (player ids, message) pairs: serve.py does the sending, and the tests drive a room directly.
Protocol and decisions: docs/superpowers/specs/2026-10-24-lan-multiplayer-design.md
"""
from __future__ import annotations

import copy
import math

MAX_PLAYERS = 4
DESKS = (1, 2, 3, 4)  # world.js's four cubicles
SILENCE_S = 120  # drop a player who has sent nothing for this long (clients ping every 5 s)
MEMORY_KEEP = 40  # Gus remembers the last 40 orders that fooled him (game.js saveBrain)
LOOK_KEYS = ("skin", "hair", "hairColor", "brows", "mouth", "nose", "glasses", "earrings", "mustache", "shirt", "pants", "tie")
BOSS_STATES = ("wait", "walk", "drill")
KINDS = ("state", "desk", "name", "look", "score", "verdict", "learned", "boss", "bust", "drill", "ping")


def fresh_brain() -> dict:
    """Gus before anyone in the room has beaten him (game.js loadBrain's default)."""
    return {"version": 1, "learned": {}, "memory": []}


def text(value, limit: int) -> str:
    """A printable one-line string of at most `limit` characters ("" for anything else)."""
    if not isinstance(value, str):
        return ""
    return "".join(c for c in " ".join(value.split()) if c.isprintable())[:limit]


def number(value, lo: float, hi: float, default: float = 0.0) -> float:
    try:
        v = float(value)
    except (TypeError, ValueError):
        return default
    return min(hi, max(lo, v)) if math.isfinite(v) else default


def angle(value) -> float:
    return round(math.remainder(number(value, -1e6, 1e6), 2 * math.pi), 2)


def clean_look(look) -> dict:
    """The look keys world.js knows. Values are short strings, booleans, or None (no tie)."""
    if not isinstance(look, dict):
        return {}
    out = {}
    for key in LOOK_KEYS:
        if key not in look:
            continue
        v = look[key]
        if isinstance(v, bool) or v is None:
            out[key] = v
        elif isinstance(v, str):
            out[key] = text(v, 24)
    return out


def clean_signature(sig):
    """One remembered order (orders.js signature): a short list of plain values."""
    if not isinstance(sig, list) or not 0 < len(sig) <= 16:
        return None
    out = []
    for v in sig:
        if isinstance(v, bool) or v is None:
            out.append(v)
        elif isinstance(v, (int, float)) and math.isfinite(v):
            out.append(v)
        elif isinstance(v, str):
            out.append(text(v, 40))
        else:
            return None
    return out


class Player:
    def __init__(self, pid: int, name: str, look: dict, local: bool, desk: int, now: float):
        self.id, self.name, self.look, self.local, self.desk = pid, name, look, local, desk
        self.state = None  # [x, z, ry, sp, flags] once they send one; flags: 1 seated, 2 carrying, 4 clocked in
        self.money = self.patches = self.round = 0
        self.seen = now

    @property
    def started(self) -> bool:
        return bool(self.state and self.state[4] & 4)

    def public(self) -> dict:
        return {"id": self.id, "name": self.name, "desk": self.desk, "look": self.look, "money": self.money,
                "patches": self.patches, "round": self.round, "started": self.started}


class Room:
    def __init__(self, share: str = ""):
        self.share = share  # the address friends open (serve.py fills it in)
        self.players: dict[int, Player] = {}
        self.brains: dict[int, dict] = {}  # Gus per shop (level), shared by everyone in the room
        self.boss: dict | None = None  # the owner's boss, passed on in the snapshots
        self._next = 1

    # ---------------------------------------------------------------- who's here

    def ids(self, but: int | None = None) -> list[int]:
        return [pid for pid in self.players if pid != but]

    def owner(self) -> int | None:
        """The earliest player on the host machine, else the earliest player (ids follow join order)."""
        local = [pid for pid, p in self.players.items() if p.local]
        pool = local or list(self.players)
        return min(pool) if pool else None

    def roster(self) -> dict:
        return {"t": "players", "owner": self.owner(),
                "players": [p.public() for p in sorted(self.players.values(), key=lambda p: p.desk)]}

    def join(self, name, look, local: bool, now: float = 0.0):
        """Seat a new player at the lowest free desk. Returns (their id, out), or (None, []) when full."""
        if len(self.players) >= MAX_PLAYERS:
            return None, []
        pid, self._next = self._next, self._next + 1
        taken = {p.desk for p in self.players.values()}
        desk = min(d for d in DESKS if d not in taken)
        self.players[pid] = Player(pid, text(name, 16) or f"Forger {pid}", clean_look(look), bool(local), desk, now)
        welcome = {**self.roster(), "t": "welcome", "id": pid, "desk": desk, "share": self.share, "max": MAX_PLAYERS,
                   "brains": {str(level): copy.deepcopy(b) for level, b in self.brains.items()}}
        return pid, self._out(([pid], welcome), (self.ids(but=pid), self.roster()))

    def leave(self, pid: int):
        if self.players.pop(pid, None) is None:
            return []
        if not self.players:
            self.boss = None
        return self._out((self.ids(), self.roster()))

    def expire(self, now: float):
        """Drop players who went silent. Returns (their ids, out)."""
        gone = [pid for pid, p in self.players.items() if now - p.seen > SILENCE_S]
        out = []
        for pid in gone:
            out += self.leave(pid)
        return gone, out

    def snapshot(self):
        """Everyone's position and the boss, sent to everyone on every tick."""
        if not self.players:
            return []
        moving = [[p.id, *p.state] for p in self.players.values() if p.state]
        return [(self.ids(), {"t": "snap", "p": moving, "b": self.boss})]

    # ---------------------------------------------------------------- messages from a player

    def handle(self, pid: int, msg, now: float = 0.0):
        p = self.players.get(pid)
        if p is None or not isinstance(msg, dict) or msg.get("t") not in KINDS:
            return []
        p.seen = now
        return getattr(self, "_on_" + msg["t"])(p, msg)

    def _on_state(self, p: Player, m: dict):
        was = p.started
        p.state = [round(number(m.get("x"), -60, 60), 2), round(number(m.get("z"), -60, 60), 2), angle(m.get("ry")),
                   round(number(m.get("sp"), 0, 10), 1), int(number(m.get("f"), 0, 7))]
        return self._out((self.ids(), self.roster())) if p.started != was else []

    def _on_desk(self, p: Player, m: dict):
        n = int(number(m.get("n"), 0, 99))
        if n in DESKS and n != p.desk and all(q.desk != n for q in self.players.values()):
            p.desk = n
            return self._out((self.ids(), self.roster()))
        return [([p.id], self.roster())]  # taken (or no change): only they hear back, and snap back

    def _on_name(self, p: Player, m: dict):
        name = text(m.get("name"), 16)
        if not name or name == p.name:
            return []
        p.name = name
        return self._out((self.ids(), self.roster()))

    def _on_look(self, p: Player, m: dict):
        p.look = clean_look(m.get("look"))
        return self._out((self.ids(), self.roster()))

    def _on_score(self, p: Player, m: dict):
        p.money = round(number(m.get("money"), -1e9, 1e9))
        p.patches = int(number(m.get("patches"), 0, 1e6))
        p.round = int(number(m.get("round"), 0, 1e6))
        return self._out((self.ids(), self.roster()))

    def _on_verdict(self, p: Player, m: dict):
        msg = {"t": "verdict", "id": p.id, "name": p.name, "caught": bool(m.get("caught")),
               "payout": round(number(m.get("payout"), 0, 1e9)), "scheme": text(m.get("scheme"), 40), "line": text(m.get("line"), 160)}
        return self._out((self.ids(but=p.id), msg))

    def _on_learned(self, p: Player, m: dict):
        """A win taught Gus something: one version up for everyone, plus what he studied."""
        level = int(number(m.get("level"), 0, 99))
        if not 1 <= level <= 9:
            return []
        tells = m.get("tells") if isinstance(m.get("tells"), dict) else {}
        memory = m.get("memory") if isinstance(m.get("memory"), list) else []
        brain = self.brains.setdefault(level, fresh_brain())
        brain["version"] += 1
        for name, n in list(tells.items())[:8]:
            key = text(name, 40)
            if key:
                brain["learned"][key] = brain["learned"].get(key, 0) + int(number(n, 0, 10))
        brain["memory"] += [s for s in map(clean_signature, memory[:10]) if s]
        del brain["memory"][:-MEMORY_KEEP]
        return self._out((self.ids(), {"t": "brain", "level": level, "brain": copy.deepcopy(brain), "by": p.name}))

    def _on_boss(self, p: Player, m: dict):
        if p.id != self.owner():
            return []
        self.boss = {"x": round(number(m.get("x"), -60, 60), 2), "z": round(number(m.get("z"), -60, 60), 2),
                     "ry": angle(m.get("ry")), "vis": bool(m.get("vis")),
                     "st": m.get("st") if m.get("st") in BOSS_STATES else "wait", "i": int(number(m.get("i"), 0, 999)),
                     "pz": int(number(m.get("pz"), 0, 10000)), "mv": bool(m.get("mv"))}
        return []

    def _on_bust(self, p: Player, m: dict):
        owner = self.owner()
        if owner is None or owner == p.id:
            return []
        return [([owner], {"t": "bust", "id": p.id, "name": p.name,
                           "x": round(number(m.get("x"), -60, 60), 2), "z": round(number(m.get("z"), -60, 60), 2)})]

    def _on_drill(self, p: Player, m: dict):
        return self._out((self.ids(but=p.id), {"t": "drill"})) if p.id == self.owner() else []

    def _on_ping(self, p: Player, m: dict):
        return []

    @staticmethod
    def _out(*pairs):
        return [(pids, msg) for pids, msg in pairs if pids]
