# The playable prototype and its multiplayer room, for a hosting service (README.md, "Hosting it online").
# serve.py is standard-library Python, so there is nothing to install. It listens on $PORT.
FROM python:3.12-slim
WORKDIR /app
COPY . .
ENV PORT=8765 PYTHONUNBUFFERED=1
EXPOSE 8765
CMD ["python", "serve.py"]
