"""Forged API server entry point.

Run with:
    USE_STUBS=true uvicorn server.main:app --reload --port 8000
"""

from __future__ import annotations

import logging
import os
import threading
from contextlib import asynccontextmanager

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

logger = logging.getLogger(__name__)


def _warm_detector() -> None:
    """Load (or train, about 6 s the first time) the ML detector so the first submit isn't slow."""
    try:
        from ml.detector import warm

        logger.info("ML detector v%d ready", warm())
    except Exception:
        logger.warning("ML detector unavailable, submits will use rule-based tells", exc_info=True)


def _warm_online_detector() -> None:
    """Load (or bootstrap) the online fraud detector for typed-checkout mode."""
    try:
        from ml.online import warm

        logger.info("Online detector v%d ready", warm())
    except Exception:
        logger.warning("Online detector unavailable, typed checkouts will use browser Gus", exc_info=True)


def _warm_kaggle_detector() -> None:
    """Load (or train) the Kaggle LightGBM detector. Only when FORGED_USE_KAGGLE=1."""
    try:
        from ml.online import warm_kaggle

        logger.info("Kaggle detector v%d ready", warm_kaggle())
    except Exception:
        logger.warning("Kaggle detector unavailable", exc_info=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    if not config.USE_STUBS:
        threading.Thread(target=_warm_detector, daemon=True).start()
        threading.Thread(target=_warm_online_detector, daemon=True).start()
        if os.environ.get("FORGED_USE_KAGGLE", "").strip() in ("1", "true", "yes"):
            threading.Thread(target=_warm_kaggle_detector, daemon=True).start()
    yield


app = FastAPI(title="Forged API", version="0.1.0", lifespan=lifespan)

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
