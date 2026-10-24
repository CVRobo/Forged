"""Gus asks CRS who the buyer is: two identity signals from the CRS Credit API, as model inputs.

  crs_idv   TransUnion TruValidate on the cardholder (name, SSN, DOB, address): PASS, FAIL
            (deceased, synthetic, or an SSN that belongs to someone else) or STEP_UP (a fraud
            alert on file: ask for more proof).
  crs_risk  AtData Fraud Finder (0-100, higher is riskier) on what the checkout presents: the
            buyer's email and name against the cardholder's phone and billing address.

Every game victim is a CRS sandbox persona (crs_personas.json; all fake people), so the checks
are about the identity the order claims. Only game rows carry a victim (`crs_id`); the real
IEEE-CIS rows predate CRS, so their signals are blank and the model learns their weight from
the game-format rows (simulated shoppers and players). That's what is real here and what isn't.

Where the answers come from:
  - the CRS sandbox, when CRS_USERNAME and CRS_PASSWORD are set (in the repo's .env);
  - every sandbox answer is kept in crs_cache.json (committed: all fake people and made-up emails),
    so a machine without the keys, or the deployed game, gets the same answers training saw;
  - an identity never asked before, without the keys: an offline mirror of how the sandbox answers.
    The persona's own login and name get its published score; the own login under another name
    gets 100; any other email gets what the sandbox gave that email provider on average (about 90:
    the sandbox sends anything but a persona's exact request to AtData, which can't vouch for a
    made-up address), and an address it rejected outright gets 100.
FORGED_CRS=off forces cache + mirror. Login happens once per process and is never retried: CRS
disables an account after repeated failed logins.
"""
from __future__ import annotations

import json
import logging
import os
import threading
import urllib.error
import urllib.request
from pathlib import Path

import pandas as pd

log = logging.getLogger(__name__)

try:  # the credentials live in the repo's .env, also when training runs outside the server
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parents[2] / ".env")
except ImportError:
    pass

BASE = os.environ.get("CRS_BASE_URL", "https://api-sandbox.stitchcredit.com/api")
TIMEOUT = 8.0
HERE = Path(__file__).resolve().parent
CACHE = HERE / "crs_cache.json"
PERSONAS = {p["id"]: p for p in json.loads((HERE / "crs_personas.json").read_text(encoding="utf-8"))["personas"]}

IDV = ["PASS", "FAIL", "STEP_UP"]
STEP_UP_CODES = {"2401"}  # TransUnion's fraud-alert message: verify more, don't decline
UNKNOWN_MAILBOX = 90.0  # the sandbox's typical answer for a made-up address at a provider it has no answers for

_lock = threading.Lock()
_state = {"token": None, "tried": False, "error": None}
_cache: dict[str, dict] | None = None


# ---------------- the sandbox ----------------

def live() -> bool:
    return bool(os.environ.get("CRS_USERNAME") and os.environ.get("CRS_PASSWORD")) and os.environ.get("FORGED_CRS") != "off"


def _post(path: str, body: dict, token: str | None = None) -> dict:
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {token}"} if token else {})})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return json.loads(r.read().decode() or "{}")


def _token() -> str | None:
    """Log in once. A failed login is never retried (CRS locks the account), the mirror takes over."""
    with _lock:
        if not _state["tried"]:
            _state["tried"] = True
            try:
                _state["token"] = _post("/users/login", {"username": os.environ["CRS_USERNAME"],
                                                         "password": os.environ["CRS_PASSWORD"]})["token"]
            except Exception as e:
                _state["error"] = f"login failed, using the offline mirror: {type(e).__name__}: {e}"
                log.warning("CRS %s", _state["error"])
        return _state["token"]


def _load_cache() -> dict:
    global _cache
    if _cache is None:
        try:
            _cache = json.loads(CACHE.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            _cache = {}
    return _cache


def _remember(key: str, value: dict) -> None:
    with _lock:
        _load_cache()[key] = value
        try:
            CACHE.parent.mkdir(parents=True, exist_ok=True)
            CACHE.write_text(json.dumps(_cache, indent=0), encoding="utf-8")
        except OSError:
            pass


def _ask(kind: str, body: dict, path: str, read) -> object | None:
    """One sandbox answer (cached), or None when the sandbox isn't available."""
    key = kind + ":" + json.dumps(body, sort_keys=True)
    hit = _load_cache().get(key)
    if hit is not None:
        return hit["value"]
    if not live() or not (token := _token()):
        return None
    try:
        value = read(_post(path, body, token))
    except (urllib.error.URLError, TimeoutError, KeyError, ValueError, TypeError) as e:
        log.warning("CRS %s failed, using the offline mirror: %s", kind, e)
        return None
    _remember(key, {"value": value})
    return value


def _idv_result(resp: dict) -> str:
    msgs = ((resp.get("addOnProducts") or [{}])[0].get("idManagerVerification") or {}).get("messages") or []
    codes = {str(m.get("code")) for m in msgs}
    return "PASS" if not codes else "STEP_UP" if codes <= STEP_UP_CODES else "FAIL"


# ---------------- the checks ----------------

def idv(persona_id: str) -> str | None:
    """TruValidate on the cardholder: PASS, FAIL or STEP_UP. None for an unknown persona."""
    p = PERSONAS.get(str(persona_id))
    if not p:
        return None
    got = _ask("idv", p["idv"], "/transunion/identity-manager-verification/basic", _idv_result)
    return got or {"KBA_REQUIRED": "STEP_UP"}.get(p["expect"]["idv"], p["expect"]["idv"])


def fraud_finder(persona_id: str, email: str | None, name: str | None) -> float | None:
    """Fraud Finder's risk score (0-100) for the buyer's email and name at the cardholder's phone and address."""
    p = PERSONAS.get(str(persona_id))
    if not p:
        return None
    own = p["fraud_finder"]
    email = (email or "").strip().lower() or own["email"]
    first, _, last = (name or f"{own['firstName']} {own['lastName']}").strip().upper().partition(" ")
    if last == own["lastName"] and first.rstrip(".")[:1] == own["firstName"][:1]:
        first = own["firstName"]  # "M. Bellamy" is the cardholder: the shop sends the account's full name
    body = {**own, "email": email, "firstName": first[:50], "lastName": (last or own["lastName"])[:50]}
    body.pop("ipAddress", None)  # where the buyer shops from is already in the model (dist2, proxy)
    got = _ask("ff", body, "/fraud-finder/fraud-finder", _ff_score)
    return float(got) if got is not None else _mirror_risk(p, body)


def _ff_score(resp: dict) -> float:
    """Fraud Finder's risk score. An address it can't deliver to comes back with no score: the riskiest."""
    if "risk" in resp:
        return float(resp["risk"]["score"])
    if (resp.get("email_validation") or {}).get("status") == "invalid":
        return 100.0
    raise KeyError("risk")


def _mirror_risk(p: dict, body: dict) -> float:
    """The offline stand-in for an identity the sandbox was never asked about (see the module notes)."""
    own = p["fraud_finder"]
    if body["email"] == own["email"]:
        name_ok = body["firstName"] == own["firstName"] and body["lastName"] == own["lastName"]
        return float(p["expect"]["risk"]) if name_ok else 100.0
    domain = body["email"].partition("@")[2]
    if "." not in domain:
        return 100.0
    seen = [v["value"] for k, v in _load_cache().items()
            if k.startswith("ff:") and json.loads(k[3:])["email"].endswith("@" + domain)]
    return float(sum(seen) / len(seen)) if seen else UNKNOWN_MAILBOX


def holder_email(persona_id: str) -> str | None:
    p = PERSONAS.get(str(persona_id))
    return p["fraud_finder"]["email"] if p else None


def columns(df: pd.DataFrame) -> pd.DataFrame:
    """crs_idv and crs_risk for each row: blank where the row names no persona (the real dataset).

    A game row names its victim (`crs_id`), the buyer's email and name as typed (`buyer_email`,
    `buyer_name`), and whether that email is the victim's own login (`buyer_is_holder`, which
    stands for the persona's real address in the sandbox)."""
    out = pd.DataFrame({"crs_idv": pd.Series(pd.NA, index=df.index, dtype="string"),
                        "crs_risk": pd.Series(float("nan"), index=df.index)})
    if "crs_id" not in df:
        return out
    get = lambda c: df[c] if c in df else pd.Series(None, index=df.index, dtype="object")
    memo: dict = {}
    for i, pid, email, name, own in zip(df.index, get("crs_id"), get("buyer_email"), get("buyer_name"), get("buyer_is_holder")):
        if pid is None or pd.isna(pid) or str(pid) not in PERSONAS:
            continue
        own = str(own).lower() in ("true", "1", "t")
        email = holder_email(pid) if own else (None if email is None or pd.isna(email) else str(email))
        name = None if name is None or pd.isna(name) or not str(name).strip() else str(name)
        key = (str(pid), email, name)
        if key not in memo:
            memo[key] = (idv(pid), fraud_finder(pid, email, name))
        out.at[i, "crs_idv"], out.at[i, "crs_risk"] = memo[key]
    return out


def status() -> dict:
    """For /health: where CRS answers come from right now."""
    return {"source": "sandbox" if live() and not _state["error"] else "offline mirror",
            "error": _state["error"], "cached_answers": len(_load_cache())}
