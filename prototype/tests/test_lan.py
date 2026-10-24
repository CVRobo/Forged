"""LAN multiplayer: the room's rules and one end-to-end run over real WebSockets.

    python3 -m pytest prototype/tests/test_lan.py -q
"""
import base64
import json
import os
import socket
import sys
import threading
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

import lan_room  # noqa: E402
import lan_ws  # noqa: E402
import serve  # noqa: E402


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
    red, blue, green, yellow = "#e0352b", "#2f6fd6", "#3fae6a", "#ffd23f"
    assert [room.players[p].color for p in (a, b, c)] == [red, blue, green]  # everyone wears a different shirt
    room.leave(b)
    d, _ = room.join("D", {}, False)
    assert (room.players[d].desk, room.players[d].color) == (2, blue)  # the lowest free desk and colour
    out = room.handle(c, {"t": "look", "look": {"shirt": red}})  # A's colour (picked in Customize): refused
    assert room.players[c].color == green and [m.get("shirtTaken") for _, m in out] == [None, "A"]
    room.handle(c, {"t": "look", "look": {"shirt": yellow}})  # a free one: theirs
    assert room.players[c].color == yellow
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


def test_the_invite_link_is_the_address_people_used():
    lan = "http://10.0.18.42:8765/?lan"
    assert serve.share_url("localhost:8765", "", lan) == lan  # the owner on localhost invites with the LAN address
    assert serve.share_url("[::1]:8765", "", lan) == lan
    assert serve.share_url("10.0.18.42:8765", "", lan) == "http://10.0.18.42:8765/?lan"
    assert serve.share_url("forged-prototype.onrender.com", "https", lan) == "https://forged-prototype.onrender.com/?lan"


# ---------------------------------------------------------------- end to end, over real sockets

def ws_connect(port):
    sock = socket.create_connection(("127.0.0.1", port), timeout=3)
    key = base64.b64encode(os.urandom(16)).decode()
    sock.sendall((f"GET /lan HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                  f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
    head = b""
    while b"\r\n\r\n" not in head:
        head += sock.recv(1)  # a byte at a time, so no frame gets swallowed with the headers
    assert head.startswith(b"HTTP/1.1 101") and lan_ws.accept_key(key).encode() in head
    return lan_ws.Conn(sock)


def send(conn, msg):
    conn.sock.sendall(lan_ws.encode(json.dumps(msg).encode(), mask=os.urandom(4)))  # browsers mask their frames


def next_msg(conn, kind, where=lambda m: True, timeout=3.0):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        try:
            raw = conn.recv_message()
        except lan_ws.Idle:
            continue
        assert raw is not None, f"closed while waiting for {kind}"
        msg = json.loads(raw)
        if msg["t"] == kind and where(msg):
            return msg
    raise AssertionError(f"no {kind} within {timeout} s")


def test_four_players_share_a_room_over_websockets():
    stop = threading.Event()
    srv = serve.make_server(0, bind="127.0.0.1")
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    threading.Thread(target=srv.lan.tick_forever, args=(stop,), daemon=True).start()
    port, conns = srv.server_address[1], []
    try:
        welcomes = []
        for i in range(4):  # one at a time, so the join order (and the desks) are fixed
            conns.append(ws_connect(port))
            send(conns[-1], {"t": "hello", "name": f"P{i}", "look": {"shirt": "#2f6fd6"}})
            welcomes.append(next_msg(conns[-1], "welcome"))
        assert [w["desk"] for w in welcomes] == [1, 2, 3, 4]
        assert welcomes[0]["owner"] == welcomes[0]["id"]  # the first player on the host machine owns the room
        conns.append(ws_connect(port))
        send(conns[-1], {"t": "hello", "name": "P4"})
        assert next_msg(conns[-1], "full")["max"] == 4

        ana, ben = conns[0], conns[1]
        send(ana, {"t": "state", "x": 1.5, "z": -2, "ry": 0, "sp": 4, "f": 4})
        next_msg(ben, "snap", lambda m: [welcomes[0]["id"], 1.5, -2.0, 0.0, 4.0, 4] in m["p"])
        send(ben, {"t": "verdict", "caught": False, "payout": 120, "scheme": "Card testing", "line": "Looks fine."})
        verdict = next_msg(ana, "verdict")
        assert (verdict["name"], verdict["payout"], verdict["caught"]) == ("P1", 120, False)
    finally:
        stop.set()
        for conn in conns:
            conn.sock.close()
        srv.shutdown()
        srv.server_close()
