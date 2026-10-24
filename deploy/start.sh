#!/bin/sh
# Starts the hosted game (Dockerfile at the repo root): Redis, the FastAPI backend with the real fraud
# model, and in front on $PORT the game and multiplayer room (prototype/serve.py), which passes API
# calls through. If the backend stops, the game keeps running on the scripted Gus.
set -e
redis-server --daemonize yes --bind 127.0.0.1 --port 6379 --save "" --appendonly no
uvicorn server.main:app --host 127.0.0.1 --port 8000 &
exec python prototype/serve.py
