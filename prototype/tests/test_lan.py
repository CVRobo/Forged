"""LAN multiplayer: the room's rules and one end-to-end run over real WebSockets.

    python3 -m pytest prototype/tests/test_lan.py -q
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

import lan_room  # noqa: E402


def test_room_holds_four_players_including_the_owner():
    room = lan_room.Room()
    ids = [room.join(f"P{i}", {}, local=(i == 0))[0] for i in range(4)]
    assert None not in ids
    assert room.owner() == ids[0]
    assert room.join("Fifth", {}, local=False) == (None, [])
    assert len(room.players) == 4


def test_owner_is_the_player_on_the_host_machine_and_hands_off():
    room = lan_room.Room()
    guest, _ = room.join("Guest", {}, local=False)
    assert room.owner() == guest  # nobody plays on the host machine yet
    host, _ = room.join("Host", {}, local=True)
    assert room.owner() == host
    out = room.leave(host)
    assert room.owner() == guest
    assert out == [([guest], room.roster())] and out[0][1]["owner"] == guest


def test_desks_follow_join_order_and_free_ones_can_be_taken():
    room = lan_room.Room()
    a, _ = room.join("A", {}, True)
    b, _ = room.join("B", {}, False)
    c, _ = room.join("C", {}, False)
    assert [room.players[p].desk for p in (a, b, c)] == [1, 2, 3]
    room.leave(b)
    d, _ = room.join("D", {}, False)
    assert room.players[d].desk == 2  # the lowest free desk
    out = room.handle(c, {"t": "desk", "n": 1})  # A's: refused, and only C hears back
    assert room.players[c].desk == 3 and [pids for pids, _ in out] == [[c]]
    room.handle(c, {"t": "desk", "n": 4})
    assert room.players[c].desk == 4


def test_everyone_teaches_the_same_gus():
    room = lan_room.Room()
    a, _ = room.join("A", {}, True)
    b, _ = room.join("B", {}, False)
    room.handle(a, {"t": "learned", "level": 1, "tells": {"new_account": 1}, "memory": [["gmail.com", 3]]})
    out = room.handle(b, {"t": "learned", "level": 1, "tells": {"new_account": 2, "proxy": 1}, "memory": [["yahoo.com", 5]]})
    brain = room.brains[1]
    assert brain["version"] == 3  # v1, then one version per win, whoever won
    assert brain["learned"] == {"new_account": 3, "proxy": 1}
    assert brain["memory"] == [["gmail.com", 3], ["yahoo.com", 5]]
    assert out == [([a, b], {"t": "brain", "level": 1, "brain": brain, "by": "B"})]
    for _ in range(6):  # he keeps his last 40 fooled orders, like game.js
        room.handle(a, {"t": "learned", "level": 1, "tells": {}, "memory": [["x", i] for i in range(10)]})
    assert len(room.brains[1]["memory"]) == lan_room.MEMORY_KEEP
