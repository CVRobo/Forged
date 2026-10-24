"""Serve the prototype with browser caching turned off, so edits show up on a normal reload.

    python serve.py          # http://localhost:8765
    python serve.py 9000     # another port
"""
import functools
import http.server
import os
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Expires", "0")
        super().end_headers()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
handler = functools.partial(NoCacheHandler, directory=os.path.dirname(os.path.abspath(__file__)))
print(f"Forged prototype on http://localhost:{port} (caching off)")
http.server.ThreadingHTTPServer(("", port), handler).serve_forever()
