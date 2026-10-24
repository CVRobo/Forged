"""Forged API server entry point.

Run with:
    USE_STUBS=true uvicorn server.main:app --reload --port 8000
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from server import config

# --- Sentry (initialise before app creation) ---

if config.SENTRY_DSN:
    import sentry_sdk
    from sentry_sdk.integrations.fastapi import FastApiIntegration

    sentry_sdk.init(
        dsn=config.SENTRY_DSN,
        integrations=[FastApiIntegration()],
        traces_sample_rate=1.0,
    )

# --- App ---

app = FastAPI(title="Forged API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Routes ---

if config.USE_STUBS:
    from server.stubs import router as stub_router

    app.include_router(stub_router, tags=["stubs"])
else:
    from server.routes.round import router as round_router
    from server.routes.clerk import router as clerk_router
    from server.routes.meta import router as meta_router

    app.include_router(round_router, tags=["round"])
    app.include_router(clerk_router, tags=["clerk"])
    app.include_router(meta_router, tags=["meta"])


@app.get("/health")
async def health():
    return {"status": "ok", "stubs": config.USE_STUBS}
