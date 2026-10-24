import os

from dotenv import load_dotenv

load_dotenv()

REDIS_URL: str = os.environ.get("REDIS_URL", "redis://localhost:6379")
ANTHROPIC_API_KEY: str = os.environ.get("ANTHROPIC_API_KEY", "")
ARIZE_SPACE_KEY: str = os.environ.get("ARIZE_SPACE_KEY", "")
ARIZE_API_KEY: str = os.environ.get("ARIZE_API_KEY", "")
DEEPGRAM_API_KEY: str = os.environ.get("DEEPGRAM_API_KEY", "")
SENTRY_DSN: str = os.environ.get("SENTRY_DSN", "")
USE_STUBS: bool = os.environ.get("USE_STUBS", "true").lower() == "true"
RETRAIN_THRESHOLD: int = int(os.environ.get("RETRAIN_THRESHOLD", "5"))
