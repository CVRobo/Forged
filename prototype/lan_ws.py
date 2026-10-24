"""The server side of WebSocket (RFC 6455) that a browser needs, on the Python standard library.

serve.py answers the HTTP upgrade with accept_key(); Conn then reads and writes frames on the raw
socket. Messages are text: continuation frames are joined, a ping gets a pong and a close ends the
connection. Browsers mask what they send; this side never masks (encode can, for the tests).
"""
from __future__ import annotations

import base64
import hashlib
import socket
import struct
import threading

GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
MAX_MESSAGE = 64 * 1024
CONTINUATION, TEXT, BINARY, CLOSE, PING, PONG = 0x0, 0x1, 0x2, 0x8, 0x9, 0xA


class Idle(Exception):
    """No frame started before the socket timeout: just read again."""


class Closed(Exception):
    """The peer went away, stalled in the middle of a frame or broke the protocol."""


def accept_key(key: str) -> str:
    return base64.b64encode(hashlib.sha1((key.strip() + GUID).encode()).digest()).decode()


def unmask(data: bytes, mask: bytes) -> bytes:
    n = len(data)
    if not n:
        return data
    return (int.from_bytes(data, "big") ^ int.from_bytes((mask * (n // 4 + 1))[:n], "big")).to_bytes(n, "big")


def encode(payload: bytes, opcode: int = TEXT, mask: bytes | None = None) -> bytes:
    """One final frame. With a 4-byte mask it is framed the way a browser sends it."""
    n, bit = len(payload), 0x80 if mask else 0
    if n < 126:
        head = struct.pack("!BB", 0x80 | opcode, bit | n)
    elif n < 1 << 16:
        head = struct.pack("!BBH", 0x80 | opcode, bit | 126, n)
    else:
        head = struct.pack("!BBQ", 0x80 | opcode, bit | 127, n)
    return head + mask + unmask(payload, mask) if mask else head + payload


class Conn:
    STALLS = 6  # socket timeouts allowed in the middle of a frame before giving up on the peer

    def __init__(self, sock: socket.socket):
        self.sock = sock
        self.open = True
        self._lock = threading.Lock()  # the tick thread and the player's own thread both send

    def recv_message(self) -> str | None:
        """The next message, or None once the peer closes. Raises Idle or Closed."""
        parts, size = [], 0
        while True:
            b0, b1 = self._read(2, idle_ok=not parts)
            fin, opcode, n = b0 & 0x80, b0 & 0x0F, b1 & 0x7F
            if n == 126:
                n = struct.unpack("!H", self._read(2))[0]
            elif n == 127:
                n = struct.unpack("!Q", self._read(8))[0]
            if n > MAX_MESSAGE:
                raise Closed("frame too big")
            mask = self._read(4) if b1 & 0x80 else None
            data = self._read(n) if n else b""
            if mask:
                data = unmask(data, mask)
            if opcode == CLOSE:
                self.close()
                return None
            if opcode == PING:
                self._send(data, PONG)
                continue
            if opcode == PONG:
                continue
            if opcode not in (CONTINUATION, TEXT, BINARY):
                raise Closed(f"unknown opcode {opcode}")
            parts.append(data)
            size += n
            if size > MAX_MESSAGE:
                raise Closed("message too big")
            if fin:
                return b"".join(parts).decode("utf-8", "replace")

    def send_text(self, text: str) -> bool:
        """False when the connection is closed, or just closed because the peer stalled or went away."""
        if not self.open:
            return False
        try:
            self._send(text.encode("utf-8"), TEXT)
            return True
        except OSError:
            self.open = False
            return False

    def close(self, code: int = 1000):
        if not self.open:
            return
        self.open = False
        try:
            self._send(struct.pack("!H", code), CLOSE)
        except OSError:
            pass

    def _send(self, payload: bytes, opcode: int):
        frame = encode(payload, opcode)
        with self._lock:
            self.sock.sendall(frame)

    def _read(self, n: int, idle_ok: bool = False) -> bytes:
        buf, stalls = bytearray(), 0
        while len(buf) < n:
            try:
                chunk = self.sock.recv(n - len(buf))
            except socket.timeout:
                if idle_ok and not buf:
                    raise Idle from None
                stalls += 1
                if stalls > self.STALLS:
                    raise Closed("stalled in the middle of a frame") from None
                continue
            if not chunk:
                raise Closed("peer closed")
            buf += chunk
        return bytes(buf)
