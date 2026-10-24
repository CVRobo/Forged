"""Play the spec's core sequence through ml.detector, with records shaped like the game sends them.

    ml/.venv/bin/python -m ml.demo

A trick gets PAID under v1, a retrain runs on it, and variants of the trick get
FLAGGED under v2. Uses a throwaway model folder unless FORGED_MODEL_DIR is set.
"""
import os
import tempfile
import time

LEVEL_1 = {  # the three Sunny Diner vendors in server/content/levels.py, with their usual orders
    "Pancake Pete's Flour Co.": ("petesflour.com", "3321", ["Flour, 50lb sack ×12 @ 62", "Pancake mix, bulk ×4 @ 95", "Delivery ×1 @ 76"]),
    "Bubbles Dish Soap Ltd.": ("bubblessoap.co", "9902", ["Dish soap, 5gal ×6 @ 48", "Sponges (100) ×2 @ 39", "Rubber gloves ×10 @ 11"]),
    "Existential Dread Consulting LLC": ("dreadconsulting.com", "1111", ["Menu font audit ×1 @ 900", "Vibes assessment ×1 @ 700", "Travel ×1 @ 400"]),
}


def invoice(start_from: str, **changes) -> dict:
    """An untouched invoice from the prototype's record(), then the player's changes."""
    domain, bank, lines = LEVEL_1[start_from]
    amount = sum(float(q) * float(p) for _, q, p in (_split(l) for l in lines))
    base = dict(level=1, scheme="changed_bank", vendor=start_from, amount=amount, bank_account="••••" + bank,
                sender_domain=domain, invoice_no="XX-0412", po_number="PO-4821", date="Fri, Oct 16", line_items=lines,
                field_altered=[], legibility={r: 1.0 for r in ("header", "meta", "items", "bank", "footer")},
                scan_quality=1.0, copy_generation=0, stamp_type=[], stamp_position=[], domain_mismatch=False,
                letterhead_match=True, cover_email="", heat=0)
    return {**base, **changes}


def _split(line: str):
    desc, rest = line.split(" ×")
    qty, price = rest.split(" @ ")
    return desc, qty, price


def show(label: str, result) -> None:
    tells = ", ".join(f"{t['tell_type']} {t['strength']:.0f}" for t in result.tells[:3]) or "none"
    verdict = "FLAGGED" if result.flagged else "PAID   "
    print(f"  {verdict}  v{result.version}  P(fraud) {result.score:.2f} (flags at {result.threshold:.2f})  {label}")
    print(f"           tells: {tells}")


def main() -> None:
    os.environ.setdefault("FORGED_MODEL_DIR", tempfile.mkdtemp(prefix="forged-models-"))
    from ml import detector

    print(f"Models in {os.environ['FORGED_MODEL_DIR']}\n")
    start = time.time()
    print(f"1. Training v1 on generated Sunny Diner data: v{detector.warm()} ready in {time.time() - start:.1f}s")
    v1 = detector.versions()[0]
    print(f"   frozen test set: catches {v1['recall']:.0%} of scripted attacks at {v1['fpr']:.1%} FPR\n")

    print("2. The server's call:  tells, suspicion = predict(record, version, memo)")
    tells, suspicion = detector.predict(invoice("Pancake Pete's Flour Co."), 1, [])
    print(f"   -> {len(tells)} tells, suspicion {suspicion:.1f} (the server flags above 38 at v1)\n")

    print("3. Round by round (Sunny Diner flags at its 3% FPR target):")
    show("an untouched Pancake Pete's invoice", detector.predict(invoice("Pancake Pete's Flour Co.")))
    show("a sloppy phantom vendor: lookalike name, spoofed domain, urgent email, copies",
         detector.predict(invoice("Pancake Pete's Flour Co.", scheme="phantom", vendor="Pancake Petes Flour Company",
                                  sender_domain="petesfl0ur.com", bank_account="••••7781", letterhead_match=False,
                                  po_number="", amount=4800, line_items=["Flour, 50lb sack ×12 @ 400"],
                                  cover_email="URGENT: pay immediately, this is overdue.", copy_generation=2)))
    trick = invoice("Pancake Pete's Flour Co.", bank_account="••••7781", field_altered=["bank"], round_id="judge-1",
                    session_id="judge", detector_version=1)
    show("the judge's trick: tape a mule account over Pete's bank details, nothing else", detector.predict(trick))

    print("\n4. The trick got PAID, so it goes to the retrain (POST /admin/retrain):")
    start = time.time()
    result = detector.retrain([trick])
    print(f"   v{result['candidate_version']} trained in {time.time() - start:.1f}s; promoted: {result['promoted']}; "
          f"{result['examples']['clones']} clones of the trick")
    print(f"   frozen set: catches {result['metrics']['catch_rate']:.0%} at {result['metrics']['false_positive_rate']:.1%} FPR; "
          f"held-out clones of the trick: {result['metrics']['held_out_catch_rate']:.0%}")
    for line in result["learned"]:
        print(f"   patch note: {line}")

    print("\n5. The same trick on other vendors, under the new version:")
    for vendor in LEVEL_1:
        show(f"tape a mule account onto {vendor}",
             detector.predict(invoice(vendor, bank_account="••••0420", field_altered=["bank"])))

    print("\n6. What the memo and the stats page get:")
    print(f"   top_features(): {detector.top_features()}")
    for rule in detector.memo_rules():
        print(f"   memo rule: {rule}")
    for v in detector.versions():
        print(f"   v{v['version']}: recall {v['recall']:.0%}, FPR {v['fpr']:.1%}, promoted {v['promoted']}, "
              f"Sunny Diner threshold {v['thresholds']['sunny_diner']:.2f}")
    print(f"   replay_grid(): {detector.replay_grid()}")


if __name__ == "__main__":
    main()
