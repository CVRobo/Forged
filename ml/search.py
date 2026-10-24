"""The search attacker: a cheap optimizer against the live detector (Model Spec v0.2 section 4.6).

For each scheme, hill climbing over the lever space from a few random restarts, changing one
lever at a time and keeping every setting that gets PAID. A query is one generated attack
invoice scored by the detector. A lever setting is judged by its evasion rate: the share of a
few variants, generated with those levers fixed, that the level lets through. The variants of
every setting come from the same seed (common random numbers), so settings are compared on the
same vendors and dates. About 200 queries per scheme, deterministic given a seed.

Its three uses in the spec:
  - the audit: recall on fresh variants of the best attack found is the robustness number
    (python -m ml.audit),
  - training data between player sessions: harden() retrains on the kept settings' variants
    with origin search_attacker (weight 1.5),
  - the duel mode opponent, which is cut.
"""
import random
from dataclasses import dataclass, field

import numpy as np

from ml import store, training
from ml.attackers import KNOWN_VENDOR_SCHEMES, SENDERS, Levers, sample_levers, sender_for
from ml.mail import OWN_ADDRESS
from ml.generate import clone_attacks
from ml.payloads import SCHEMES
from ml.schema import LEVELS, Submission

BUDGET = 200      # detector queries per scheme
VARIANTS = 5      # queries per lever setting
RESTARTS = 4
FRESH = 100       # fresh variants of the best attack for the robustness recall
MAX_REPEATS = 20  # stop a restart after this many mutations in a row land on settings already tried
# Hardening: variants of each scheme's most evasive kept settings, 20 rows per scheme. Three
# settings of 20 each fail the promotion gate: frozen recall drops more than 5 points, because
# the careful phantoms the search finds look like real new vendors.
TOP_SETTINGS = 2
PER_SETTING = 10
LEVEL = "sunny_diner"

COMMON = ("photocopies", "stains", "stamp", "tone", "mention_change", "send", "due",
          "sender", "aged_domain", "display", "reply_to", "cc", "thread")  # the email (realistic channel)
RELEVANT = {  # the levers each scheme's builder in attackers.py reads
    "bank_switcheroo": ("identity", "amount", "timing", "letterhead") + COMMON,
    "padded_invoice": ("identity", "amount", "timing", "letterhead", "pad_method") + COMMON,
    "duplicate_dance": ("identity", "dup_change", "letterhead") + COMMON,
    "phantom_supplier": ("identity", "amount", "letterhead", "reuse_payee") + COMMON,
    "boss_request": ("amount", "reuse_payee") + COMMON,
    "bank_change_fraud": ("identity", "amount", "letterhead", "channel", "offer_phone") + COMMON,
}
CHOICES = {
    "amount": ("typical", "under_limit", "round", "inflated"),
    "timing": ("on_cadence", "right_after", "random"),
    "letterhead": ("match", "generic"),
    "pad_method": ("price", "quantity", "fee"),
    "dup_change": ("number", "date", "line"),
    "photocopies": (0, 1, 2),
    "stains": (0, 1, 2),
    "stamp": ("none", "habit", "random"),
    "tone": ("none", "plain", "chatty", "apologetic", "urgent"),
    "mention_change": (False, True),
    "send": ("business", "offhours"),
    "due": ("normal", "short"),
    "reuse_payee": (False, True),
    "aged_domain": (False, True),
    "display": ("vendor", "person"),
    "reply_to": ("none", "attacker"),
    "cc": (False, True),
    "thread": ("new", "reply"),
    "channel": ("email", "phone"),
    "offer_phone": (False, True),
}
DEFAULTS = {"identity": "fresh", "amount": "typical", "timing": "random", "letterhead": "match", "pad_method": "price",
            "dup_change": "number", "photocopies": 0, "stains": 0, "stamp": "none", "tone": "none",
            "mention_change": False, "send": "business", "due": "normal", "reuse_payee": False, "sender": "auto",
            "aged_domain": False, "display": "vendor", "reply_to": "none", "cc": False, "thread": "new",
            "channel": "email", "offer_phone": False}


@dataclass
class Found:
    scheme_id: str
    levers: Levers   # the best setting found
    evasion: float   # its evasion rate on the search variants
    queries: int
    kept: list[tuple[Levers, float]] = field(default_factory=list)  # every setting that got PAID, most evasive first


def options(scheme_id: str, identity: str | None = None) -> dict[str, tuple]:
    identities = ("copy", "lookalike") if scheme_id in KNOWN_VENDOR_SCHEMES else ("lookalike", "fresh")
    senders = SENDERS[identity] if identity else tuple(dict.fromkeys(s for i in identities for s in SENDERS[i]))
    return {"identity": identities, "sender": senders, **CHOICES}


def relevant_levers(lv: Levers) -> tuple[str, ...]:
    """The levers that change this setting's invoices: the letterhead only matters on a
    lookalike, mentioning a change only in a cover email, a domain's age only on a domain the
    attacker registered, the display name only off the vendor's own domain, and the thread
    only for a known vendor's."""
    names, sender = RELEVANT[lv.scheme_id], sender_for(lv)
    return tuple(n for n in names if not (n == "letterhead" and lv.identity != "lookalike")
                 and not (n == "mention_change" and lv.tone == "none")
                 and not (n == "aged_domain" and sender not in ("lookalike_domain", "new_domain"))
                 and not (n == "display" and sender in OWN_ADDRESS)
                 and not (n == "thread" and lv.scheme_id not in KNOWN_VENDOR_SCHEMES))


def canonical(lv: Levers) -> Levers:
    """The same setting with every lever it ignores at its default, so equal settings compare equal."""
    for _ in range(2):  # resetting an ignored identity can change which sender it resolves to
        lv = lv.model_copy(update={"sender": sender_for(lv)})
        keep = relevant_levers(lv)
        lv = lv.model_copy(update={n: DEFAULTS[n] for n in DEFAULTS if n not in keep})
    return lv


def mutate(lv: Levers, rng: random.Random) -> Levers:
    """Change one lever that matters to another of its values."""
    lv = lv.model_copy(update={"sender": sender_for(lv)})
    name = rng.choice([n for n in relevant_levers(lv) if len(options(lv.scheme_id, lv.identity)[n]) > 1])
    value = rng.choice([v for v in options(lv.scheme_id, lv.identity)[name] if v != getattr(lv, name)])
    return lv.model_copy(update={name: value})


def described(lv: Levers) -> dict:
    return {n: getattr(lv, n) for n in relevant_levers(lv)}


def variant_seed(seed: int, purpose: str) -> int:
    return training._seed(f"search:{seed}:{purpose}")


def variants(lv: Levers, n: int, seed: int, level_id: str = LEVEL) -> list[Submission]:
    """n attack invoices with these levers fixed. Memory-on levels need their memory features:
    each session replayed on its own after the live memory. Memory-off levels don't read them."""
    if LEVELS[level_id].memory_enabled:
        return training.clones(lv, n, seed, origin="search_attacker", apart=True)
    return clone_attacks(lv, n, seed, origin="search_attacker")


def attack(scheme_id: str, version: int | None = None, level_id: str = LEVEL, seed: int = 0,
           budget: int = BUDGET, n_variants: int = VARIANTS, restarts: int = RESTARTS) -> Found:
    """Hill-climb one scheme's levers against a saved version at a level's threshold."""
    version = version or training.ensure_v1()
    det, threshold = store.load_detector(version), store.threshold(version, level_id)
    rng, world = random.Random(f"search:{scheme_id}:{seed}"), variant_seed(seed, f"search:{scheme_id}")
    tried: dict[str, tuple[Levers, float, float]] = {}  # canonical json -> (levers, evasion, mean P(fraud))
    queries = 0

    def fitness(lv: Levers) -> tuple[float, float]:
        """Evasion first; among equal evasion, the lower mean score, so the climb keeps moving
        on a plateau of 5-out-of-5 settings toward ones with more room under the threshold."""
        nonlocal queries
        key = canonical(lv).model_dump_json()
        if key not in tried:
            rows = variants(lv, n_variants, world, level_id)
            queries += len(rows)
            scores = np.array([training.score(det, r.features, level_id) for r in rows])
            tried[key] = (canonical(lv), float(np.mean(scores < threshold)), float(scores.mean()))
        _, rate, mean_score = tried[key]
        return rate, -mean_score

    for restart in range(restarts):
        stop = budget * (restart + 1) // restarts
        if queries + n_variants > stop:
            continue
        current = sample_levers(rng, scheme_id)
        best_here, repeats = fitness(current), 0
        while queries + n_variants <= stop and repeats < MAX_REPEATS:
            before, candidate = queries, mutate(current, rng)
            score = fitness(candidate)
            repeats = repeats + 1 if queries == before else 0
            if score >= best_here:
                current, best_here = candidate, score
    ranked = sorted(tried.values(), key=lambda t: (-t[1], t[2]))
    levers, rate, _ = ranked[0]
    return Found(scheme_id, levers, rate, queries, [(lv, e) for lv, e, _ in ranked if e > 0])


def robustness(lv: Levers, version: int | None = None, level_id: str = LEVEL, seed: int = 0, n: int = FRESH) -> float:
    """Recall on fresh variants of an attack, generated with a different seed from the search's."""
    version = version or training.ensure_v1()
    det, threshold = store.load_detector(version), store.threshold(version, level_id)
    rows = variants(lv, n, variant_seed(seed, "fresh"), level_id)
    return float(np.mean([training.score(det, r.features, level_id) >= threshold for r in rows]))


def audit(version: int | None = None, level_id: str = LEVEL, seed: int = 0, budget: int = BUDGET) -> list[dict]:
    """Per scheme: the best attack found on this version, its evasion, and the robustness recall."""
    version = version or training.ensure_v1()
    report = []
    for scheme in SCHEMES:
        found = attack(scheme, version, level_id, seed, budget)
        report.append({"scheme": scheme, "levers": described(found.levers), "evasion": found.evasion,
                       "robust_recall": robustness(found.levers, version, level_id, seed), "queries": found.queries,
                       "kept": len(found.kept), "found": found})
    return report


def frozen(version: int, level_id: str = LEVEL) -> dict:
    """Recall and FPR on the frozen test set at a level's threshold and memory setting."""
    det, threshold = store.load_detector(version), store.threshold(version, level_id)
    test = training.base_splits()[2]
    flagged = np.array([training.score(det, r.features, level_id) >= threshold for r in test])
    fraud = np.array([r.is_fraud for r in test])
    return {"recall": float(flagged[fraud].mean()), "fpr": float(flagged[~fraud].mean())}


def harden(level_id: str = LEVEL, seed: int = 0, budget: int = BUDGET, found: dict[str, Found] | None = None) -> dict:
    """One hardening round between player sessions: search every scheme on the live version, then
    retrain on variants of each scheme's most evasive kept settings, as search_attacker rows."""
    version = training.ensure_v1()
    found = found or {scheme: attack(scheme, version, level_id, seed, budget) for scheme in SCHEMES}
    rows = []
    for scheme, f in found.items():
        for j, (lv, _) in enumerate(f.kept[:TOP_SETTINGS]):
            rows += training.clones(lv, PER_SETTING, variant_seed(seed, f"harden:{scheme}:{j}"), origin="search_attacker")
    result = training.retrain_on(rows, level_id=level_id)
    result["search"] = {s: {"levers": described(f.levers), "evasion": f.evasion, "queries": f.queries,
                            "rows": PER_SETTING * len(f.kept[:TOP_SETTINGS])} for s, f in found.items()}
    return result
