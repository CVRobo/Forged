"""Serve the prototype with browser caching turned off, so edits show up on a normal reload.

It also hosts LAN games, for up to 4 players with you included. Friends on your network open the
LAN address printed at startup and press LAN game on the Clock in card. The room lives at
ws://<host>:<port>/lan (lan_room.py, lan_ws.py; docs/superpowers/specs/2026-10-24-lan-multiplayer-design.md).

    python serve.py          # http://localhost:8765
    python serve.py 9000     # another port
"""
from __future__ import annotations

import http.server
import ipaddress
import json
import os
import socket
import sys
import threading
import time

import lan_room
import lan_ws

HERE = os.path.dirname(os.path.abspath(__file__))
TICK_HZ = 15  # snapshots of everyone's position per second


def lan_address() -> str:
    """This machine's address on the local network (no packet is sent), or 127.0.0.1 when offline."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"


class LanHost:
    """The room and its open connections. The room is only touched under the lock; sending happens outside it."""

    def __init__(self, share: str = ""):
        self.room = lan_room.Room(share)
        self.lock = threading.Lock()
        self.conns: dict[int, lan_ws.Conn] = {}
        self.own_ips = {"127.0.0.1", "::1", lan_address()}

    def is_local(self, ip: str) -> bool:
        """Is this browser on the host machine? Its first player is the LAN owner."""
        try:
            return ip in self.own_ips or ipaddress.ip_address(ip).is_loopback
        except ValueError:
            return False

    def deliver(self, out):
        for pids, msg in out:
            text = json.dumps(msg, separators=(",", ":"))
            for pid in pids:
                conn = self.conns.get(pid)
                if conn:
                    conn.send_text(text)  # a failed send closes it, and that player's own thread then leaves

    def play(self, conn: lan_ws.Conn, ip: str):
        """One player's connection, from their hello until they leave."""
        pid = None
        try:
            hello, deadline = None, time.monotonic() + 10
            while hello is None and time.monotonic() < deadline:
                hello = self._read_json(conn)
            if not hello or hello.get("t") != "hello":
                return
            with self.lock:
                pid, out = self.room.join(hello.get("name"), hello.get("look"), self.is_local(ip), time.monotonic())
                if pid is not None:
                    self.conns[pid] = conn
                    who = self.room.players[pid]
            if pid is None:
                conn.send_text(json.dumps({"t": "full", "max": lan_room.MAX_PLAYERS}))
                print(f"[lan] turned away {ip}: the room is full", flush=True)
                return
            print(f"[lan] {who.name} joined from {ip} at desk {who.desk}", flush=True)
            self.deliver(out)
            while conn.open:
                msg = self._read_json(conn)
                if msg is False:
                    break
                if msg:
                    with self.lock:
                        out = self.room.handle(pid, msg, time.monotonic())
                    self.deliver(out)
        except (lan_ws.Closed, OSError):
            pass
        finally:
            if pid is not None:
                with self.lock:
                    self.conns.pop(pid, None)
                    out = self.room.leave(pid)
                print(f"[lan] {who.name} left", flush=True)
                self.deliver(out)
            conn.close()

    def tick_forever(self, stop: threading.Event | None = None):
        """Send everyone's position and the boss, and drop players who went silent."""
        stop = stop or threading.Event()
        while not stop.wait(1 / TICK_HZ):
            with self.lock:
                gone, out = self.room.expire(time.monotonic())
                dropped = [self.conns.pop(pid, None) for pid in gone]
                out += self.room.snapshot()
            for conn in dropped:
                if conn:
                    conn.close(1001)
            self.deliver(out)

    @staticmethod
    def _read_json(conn: lan_ws.Conn):
        """The next message as a dict: None when idle or not a JSON object, False once the peer has closed."""
        try:
            raw = conn.recv_message()
        except lan_ws.Idle:
            return None
        if raw is None:
            return False
        try:
            msg = json.loads(raw)
        except ValueError:
            return None
        return msg if isinstance(msg, dict) else None


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=HERE, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Expires", "0")
        super().end_headers()

    def do_GET(self):
        if self.path.split("?", 1)[0] == "/lan" and "websocket" in self.headers.get("Upgrade", "").lower():
            return self.join_lan()
        super().do_GET()

    def join_lan(self):
        key = self.headers.get("Sec-WebSocket-Key", "")
        if not key:
            return self.send_error(400, "Expected a WebSocket handshake")
        self.wfile.write(("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                          f"Sec-WebSocket-Accept: {lan_ws.accept_key(key)}\r\n\r\n").encode())
        self.log_request(101)
        self.close_connection = True
        self.connection.settimeout(5)  # reads wake every 5 s; a send stuck for 5 s drops that player
        self.server.lan.play(lan_ws.Conn(self.connection), self.client_address[0])


def make_server(port: int, bind: str = "") -> http.server.ThreadingHTTPServer:
    server = http.server.ThreadingHTTPServer((bind, port), Handler)
    server.lan = LanHost(share=f"http://{lan_address()}:{server.server_address[1]}/?lan")
    return server


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    server = make_server(port)
    threading.Thread(target=server.lan.tick_forever, daemon=True).start()
    print(f"Forged prototype on http://localhost:{port} (caching off)")
    print(f"LAN game: friends on your network open {server.lan.room.share} (up to {lan_room.MAX_PLAYERS} players, you included)", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
