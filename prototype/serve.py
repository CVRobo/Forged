"""Serve the prototype with browser caching turned off, so edits show up on a normal reload.

It also hosts LAN games, for up to 4 players with you included. Friends on your network open the
LAN address printed at startup and press LAN game on the Clock in card. The room lives at
ws://<host>:<port>/lan (lan_room.py, lan_ws.py; docs/superpowers/specs/2026-10-24-lan-multiplayer-design.md).
On a hosting service (Dockerfile) the same room is an online game, shared at the service's address.

With API_UPSTREAM set (the Dockerfile at the repo root does), it also fronts the FastAPI backend: API
calls go through to it, and config.js tells the game its API is this same site, so the hosted game
plays against the real fraud model on one address.

    python serve.py          # http://localhost:8765
    python serve.py 9000     # another port (or set PORT, as hosting services do)
"""
from __future__ import annotations

import http.client
import http.server
import ipaddress
import json
import os
import socket
import sys
import threading
import time
import urllib.parse

import lan_room
import lan_ws

HERE = os.path.dirname(os.path.abspath(__file__))
TICK_HZ = 15  # snapshots of everyone's position per second
API_UPSTREAM = os.environ.get("API_UPSTREAM", "").rstrip("/")  # the backend behind this server, e.g. http://127.0.0.1:8000
# headers that belong to one hop, not the whole trip (and the ones send_response writes itself)
HOP_HEADERS = {"connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailers",
               "transfer-encoding", "upgrade", "host", "content-length", "server", "date"}


def lan_address() -> str:
    """This machine's address on the local network (no packet is sent), or 127.0.0.1 when offline."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"


def share_url(host: str, proto: str, lan_url: str) -> str:
    """The address to invite people with. Opened as localhost, that's this machine's LAN address
    (lan_url); opened through any other name (a LAN IP, a tunnel, a hosting service), it's that name."""
    name = (host or "").rsplit(":", 1)[0].strip("[]").lower()
    if name in ("", "localhost", "127.0.0.1", "::1"):
        return lan_url
    return f"{'https' if proto.strip().lower() == 'https' else 'http'}://{host}/?lan"


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

    def play(self, conn: lan_ws.Conn, ip: str, share: str | None = None):
        """One player's connection, from their hello until they leave. `share` is how they reached us."""
        pid = None
        try:
            hello, deadline = None, time.monotonic() + 10
            while hello is None and time.monotonic() < deadline:
                hello = self._read_json(conn)
            if not hello or hello.get("t") != "hello":
                return
            with self.lock:
                pid, out = self.room.join(hello.get("name"), hello.get("look"), self.is_local(ip), time.monotonic(), share)
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
        path = self.path.split("?", 1)[0]
        if path == "/lan" and "websocket" in self.headers.get("Upgrade", "").lower():
            return self.join_lan()
        if API_UPSTREAM and path == "/config.js":
            return self.send_config()
        if API_UPSTREAM and not os.path.exists(self.translate_path(self.path)):
            return self.proxy()  # not a game file: an API call (/health, /leaderboard, /report…)
        super().do_GET()

    def do_HEAD(self):
        if API_UPSTREAM and not os.path.exists(self.translate_path(self.path)):
            return self.proxy()
        super().do_HEAD()

    def do_POST(self):
        if not API_UPSTREAM:
            return self.send_error(501, "No backend behind this server (set API_UPSTREAM)")
        self.proxy()

    do_PUT = do_PATCH = do_DELETE = do_OPTIONS = do_POST

    def send_config(self):
        """Tell the game its API is this same site. Without a backend, the static config.js leaves it offline."""
        data = b"window.FORGED_API = window.FORGED_API || location.origin; // serve.py: the API is this site\n"
        self.send_response(200)
        self.send_header("Content-Type", "text/javascript")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def proxy(self):
        """Pass an API call through to the backend (API_UPSTREAM) and its answer back."""
        up = urllib.parse.urlsplit(API_UPSTREAM)
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else None
        headers = {k: v for k, v in self.headers.items() if k.lower() not in HOP_HEADERS}
        try:
            conn = http.client.HTTPConnection(up.hostname, up.port or 80, timeout=30)
            conn.request(self.command, self.path, body=body, headers=headers)
            r = conn.getresponse()
            status, reason, out_headers, data = r.status, r.reason, r.getheaders(), r.read()
            conn.close()
        except OSError as e:  # the backend is down or still starting: the game falls back to the scripted Gus
            status, reason, data = 502, "Bad Gateway", json.dumps({"detail": f"backend unavailable: {e}"}).encode()
            out_headers = [("Content-Type", "application/json")]
        self.send_response(status, reason)
        for k, v in out_headers:
            if k.lower() not in HOP_HEADERS:
                self.send_header(k, v)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def join_lan(self):
        key = self.headers.get("Sec-WebSocket-Key", "")
        if not key:
            return self.send_error(400, "Expected a WebSocket handshake")
        self.wfile.write(("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                          f"Sec-WebSocket-Accept: {lan_ws.accept_key(key)}\r\n\r\n").encode())
        self.log_request(101)
        self.close_connection = True
        self.connection.settimeout(5)  # reads wake every 5 s; a send stuck for 5 s drops that player
        lan = self.server.lan
        share = share_url(self.headers.get("Host", ""), self.headers.get("X-Forwarded-Proto", ""), lan.room.share)
        lan.play(lan_ws.Conn(self.connection), self.client_address[0], share)


def make_server(port: int, bind: str = "") -> http.server.ThreadingHTTPServer:
    server = http.server.ThreadingHTTPServer((bind, port), Handler)
    server.lan = LanHost(share=f"http://{lan_address()}:{server.server_address[1]}/?lan")
    return server


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get("PORT", "8765"))
    server = make_server(port)
    threading.Thread(target=server.lan.tick_forever, daemon=True).start()
    print(f"Forged prototype on http://localhost:{port} (caching off)")
    print(f"LAN game: friends on your network open {server.lan.room.share} (up to {lan_room.MAX_PLAYERS} players, you included)")
    print("On a hosting service, share the service's own address instead: the lobby shows it.")
    if API_UPSTREAM:
        print(f"Backend: API calls go to {API_UPSTREAM}, so the game plays against the real fraud model")
    sys.stdout.flush()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
