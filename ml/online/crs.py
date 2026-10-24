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
  - the CRS sandbox, when CRS_USERNAME and CRS_PASSWORD are set (answers cached in data/crs_cache.json);
  - otherwise an offline mirror: the sandbox's published answers for each persona's own identity,
    and for any other email a rule of thumb (an unknown mailbox ~60, an anonymous one 85).
FORGED_CRS=off forces the mirror. Login happens once per process and is never retried: CRS
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

BASE = os.environ.get("CRS_BASE_URL", "https://api-sandbox.stitchcredit.com/api")
TIMEOUT = 4.0
HERE = Path(__file__).resolve().parent
CACHE = HERE / "data" / "crs_cache.json"
PERSONAS = {p["id"]: p for p in json.loads((HERE / "crs_personas.json").read_text(encoding="utf-8"))["personas"]}

IDV = ["PASS", "FAIL", "STEP_UP"]
STEP_UP_CODES = {"2401"}  # TransUnion's fraud-alert message: verify more, don't decline
ANON = {"protonmail.com", "proton.me", "anonymous.com", "mail.com", "guerrillamail.com", "tempmail.com", "yopmail.com",
        "tutanota.com", "10minutemail.com", "mail.ru", "yandex.ru"}
COMMON = {"gmail.com", "yahoo.com", "hotmail.com", "aol.com", "comcast.net", "icloud.com", "outlook.com", "msn.com",
          "att.net", "live.com", "sbcglobal.net", "verizon.net", "ymail.com", "bellsouth.net", "me.com", "cox.net"}

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
    body = {**own, "email": email, "firstName": first[:50], "lastName": (last or own["lastName"])[:50]}
    body.pop("ipAddress", None)  # where the buyer shops from is already in the model (dist2, proxy)
    got = _ask("ff", body, "/fraud-finder/fraud-finder", lambda r: float(r["risk"]["score"]))
    return float(got) if got is not None else _mirror_risk(p, body)


def _mirror_risk(p: dict, body: dict) -> float:
    """The offline stand-in: the sandbox's own answer for the persona's identity, a rule of thumb otherwise."""
    own = p["fraud_finder"]
    name_ok = body["firstName"][:1] == own["firstName"][:1] and body["lastName"] == own["lastName"]
    if body["email"] == own["email"]:
        risk = p["expect"]["risk"]
    else:
        local, _, domain = body["email"].partition("@")
        if "." not in domain:
            risk = 95  # not a deliverable address
        elif domain in ANON:
            risk = 85
        else:  # a mailbox AtData has no history for; less so when it carries the cardholder's name
            risk = 60 if domain in COMMON else 70
            if own["lastName"].lower() in local:
                risk -= 10
    return float(min(100, risk + (0 if name_ok else 10)))


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
