# The hosted game in one container (one Render service; prototype/README.md, "Hosting it online"):
#   prototype/serve.py on $PORT   the game and the multiplayer room; API calls go through to the backend
#   server/ (FastAPI)             the real fraud model from ml/online judges every order, on 127.0.0.1:8000
#   redis-server                  rounds and sessions for the backend, in memory only
# deploy/start.sh starts all three. prototype/Dockerfile is the lighter game-only image (scripted Gus).
FROM python:3.12-slim
# redis-server for the backend, libgomp1 for LightGBM
RUN apt-get update && apt-get install -y --no-install-recommends redis-server libgomp1 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY deploy/requirements.txt deploy/requirements.txt
RUN pip install --no-cache-dir -r deploy/requirements.txt
COPY ml/__init__.py ml/__init__.py
COPY ml/online ml/online
COPY server server
COPY prototype prototype
COPY deploy/start.sh deploy/start.sh
ENV PORT=10000 PYTHONUNBUFFERED=1 USE_STUBS=false API_UPSTREAM=http://127.0.0.1:8000
EXPOSE 10000
CMD ["sh", "deploy/start.sh"]
