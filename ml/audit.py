"""The robustness audit (Model Spec v0.2 section 4.6): the search attacker against the live version.

    ml/.venv/bin/python -m ml.audit                       # audit the live version at Sunny Diner
    ml/.venv/bin/python -m ml.audit --harden              # then one hardening round, and the audit again
    ml/.venv/bin/python -m ml.audit --level port_nocturne --seed 1

For each scheme: the best lever setting the search found in about 200 queries, its evasion rate
on the search's variants, and the robustness recall, 1 - evasion on 100 fresh variants made with
another seed. The lowest of those is the worst case. --harden saves a new version under
FORGED_MODEL_DIR (default ml/models/); point that at a temp folder to try it out.
"""
import argparse
import time

from ml import search, store, training
from ml.schema import LEVELS


def show(version: int, rows: list[dict], level_id: str) -> None:
    f = search.frozen(version, level_id)
    print(f"v{version} at {LEVELS[level_id].name}: frozen test recall {f['recall']:.1%}, FPR {f['fpr']:.1%}")
    print(f"  {'scheme':17s} {'robust recall':>13s} {'search evasion':>14s} {'queries':>7s} {'kept':>4s}  best levers")
    for r in rows:
        levers = ", ".join(f"{k}={v}" for k, v in r["levers"].items() if v != search.DEFAULTS.get(k))
        print(f"  {r['scheme']:17s} {r['robust_recall']:13.0%} {r['evasion']:14.0%} {r['queries']:7d} {r['kept']:4d}  "
              f"{levers or 'all defaults'}")
    worst = min(rows, key=lambda r: r["robust_recall"])
    print(f"  worst case: {worst['robust_recall']:.0%} recall ({worst['scheme']})\n")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--level", default=search.LEVEL, choices=sorted(LEVELS))
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--budget", type=int, default=search.BUDGET, help="detector queries per scheme")
    parser.add_argument("--harden", action="store_true", help="retrain on the search's attacks, then audit again")
    args = parser.parse_args()

    start = time.time()
    live = training.ensure_v1()
    print(f"Models in {store.model_dir()}\n")
    before = search.audit(live, args.level, args.seed, args.budget)
    show(live, before, args.level)
    if not args.harden:
        print(f"({time.time() - start:.0f}s)")
        return

    result = search.harden(args.level, args.seed, args.budget, found={r["scheme"]: r["found"] for r in before})
    new = result["candidate_version"]
    gate = result["gate"]
    print(f"Hardening: v{new} trained on {sum(s['rows'] for s in result['search'].values())} search_attacker rows "
          f"(weight {training.ORIGIN_WEIGHTS['search_attacker']}); promoted: {result['promoted']} "
          f"(gate: frozen FPR {gate['frozen_fpr']:.1%}, recall change lower bound {gate['recall_change_lower_bound']:+.1%})")
    for line in result["learned"]:
        print(f"  patch note: {line}")
    print()
    print(f"The same attacks under v{new} (fresh variants):")
    for r in before:
        print(f"  {r['scheme']:17s} {r['robust_recall']:4.0%} -> "
              f"{search.robustness(r['found'].levers, new, args.level, args.seed):4.0%}")
    print(f"\nA new search against v{new}:")
    show(new, search.audit(new, args.level, args.seed, args.budget), args.level)
    print(f"({time.time() - start:.0f}s)")


if __name__ == "__main__":
    main()
