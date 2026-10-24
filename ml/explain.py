"""Game-facing outputs of the model: the inspector's tells, the daily memo rules and the patch notes.

Tells use the prototype's tell names and regions (TELL_LABELS and TELL_REGION in
prototype/game.js) so the forensic replay highlights the right part of the paper.
"""
import math

import numpy as np
from sklearn.tree import DecisionTreeClassifier

from ml.baseline import Detector
from ml.schema import MEMORY_FEATURES

# feature -> (prototype tell name, invoice region)
TELLS = {
    "bank_changed": ("bank_changed", "bank"),
    "domain_mismatch": ("domain_mismatch", "header"), "domain_edit_distance": ("domain_mismatch", "header"),
    "vendor_unknown": ("unknown_vendor", "header"), "vendor_name_similarity": ("unknown_vendor", "header"),
    "letterhead_match": ("letterhead", "header"),
    "amount_z": ("amount_unusual", "items"), "amount_is_round": ("amount_unusual", "items"),
    "amount_to_limit_ratio": ("amount_unusual", "items"), "order_amount_ratio": ("amount_unusual", "items"),
    "max_unit_price_ratio": ("amount_unusual", "items"), "amount_jump_ratio": ("amount_unusual", "items"),
    "line_item_count": ("amount_unusual", "items"),
    "field_altered_count": ("altered", "meta"),
    "copy_generation": ("copy_gen", "header"), "scan_quality": ("copy_gen", "header"),
    "max_illegibility": ("low_legibility", "items"),
    "stamp_count": ("stamp_wrong", "footer"), "stamp_matches_vendor": ("stamp_wrong", "footer"),
    "no_open_order": ("bad_po", "meta"),
    "dup_similarity": ("dup_number", "meta"), "cadence_z": ("dup_number", "meta"),
    "due_days": ("short_terms", "meta"), "offhours_send": ("after_hours", None),
    "vague_text_score": ("vague_items", "items"),
    "email_urgency": ("urgent_email", None), "email_mentions_change": ("urgent_email", None), "email_length": ("urgent_email", None),
    "window_count": ("heat", None), "window_sum": ("heat", None), "vendor_age_rounds": ("heat", None),
    "knn_fraud_share": ("heat", None), "knn_max_sim": ("heat", None), "self_sim": ("heat", None),
    # the realistic channel: the email (region "email") and the vendor master's change log ("bank")
    "reply_to_mismatch": ("reply_to", "email"), "from_domain_known": ("domain_mismatch", "email"),
    "free_mail_sender": ("free_mail", "email"), "display_name_spoof": ("display_spoof", "email"),
    "cc_lookalike": ("lookalike_cc", "email"), "dmarc_fail": ("auth_fail", "email"), "spf_fail": ("auth_fail", "email"),
    "log_domain_age": ("new_domain", "email"), "first_time_sender": ("first_contact", "email"),
    "new_thread_for_payment": ("new_thread", "email"),
    "days_since_bank_change": ("recent_bank_change", "bank"), "bank_change_via_email": ("recent_bank_change", "bank"),
    "bank_change_verified": ("recent_bank_change", "bank"), "change_request_offered_phone": ("recent_bank_change", "bank"),
    "new_account_payment": ("recent_bank_change", "bank"),
}

# What each feature means, for memo rules and patch notes. {t} is the split threshold.
PHRASES = {
    "amount_z": ("amounts {t:.1f} standard deviations above the vendor's usual", "amounts close to the vendor's usual"),
    "amount_is_round": ("suspiciously round totals", "totals with cents"),
    "amount_to_limit_ratio": ("totals near the ${limit:,.0f} approval limit", "small totals"),
    "bank_changed": ("bank details that don't match the vendor on file", "bank details on file"),
    "order_amount_ratio": ("totals more than {p:.0f}% over the purchase order", "totals within the purchase order"),
    "max_unit_price_ratio": ("unit prices more than {p:.0f}% above the vendor's catalog", "catalog prices"),
    "vendor_unknown": ("vendors that aren't on the approved list", "approved vendors"),
    "vendor_name_similarity": ("names that almost match an approved vendor", "names unlike any vendor"),
    "domain_mismatch": ("emails from a domain that isn't the vendor's", "the vendor's own email domain"),
    "domain_edit_distance": ("sender domains a letter or two off a real vendor's", "unfamiliar sender domains"),
    "letterhead_match": ("letterheads that don't match the vendor", "the vendor's own letterhead"),
    "no_open_order": ("invoices without an open purchase order", "invoices with an open purchase order"),
    "dup_similarity": ("invoices that look like one already paid", "new invoices"),
    "cadence_z": ("invoices that arrive early for the vendor's schedule", "invoices on the vendor's schedule"),
    "due_days": ("invoices due within {d:.0f} days", "normal payment terms"),
    "offhours_send": ("invoices sent after hours", "invoices sent in business hours"),
    "line_item_count": ("invoices with only one or two lines", "detailed invoices"),
    "vague_text_score": ("vague line items like 'services'", "specific line items"),
    "email_urgency": ("cover emails that rush the payment", "calm cover emails"),
    "email_mentions_change": ("emails announcing new bank details", "emails without account changes"),
    "email_length": ("long cover emails", "short cover emails"),
    "field_altered_count": ("whiteout or tape on the paper", "clean paper"),
    "max_illegibility": ("stains over important fields", "clean paper"),
    "copy_generation": ("photocopies of photocopies", "original paper"),
    "scan_quality": ("blurry copies", "sharp scans"),
    "stamp_count": ("extra stamps", "unstamped invoices"),
    "stamp_matches_vendor": ("stamps the vendor never uses", "the vendor's usual stamps"),
    "window_count": ("repeat invoices from the same payee", "one-off payees"),
    "window_sum": ("payees whose recent invoices add up past the limit", "small running totals"),
    "vendor_age_rounds": ("brand-new payees", "long-standing payees"),
    "amount_jump_ratio": ("a jump in size from a payee's earlier invoices", "steady amounts"),
    "knn_fraud_share": ("invoices like ones that turned out to be fraud", "invoices like real ones"),
    "knn_max_sim": ("near-copies of earlier invoices", "invoices unlike earlier ones"),
    "self_sim": ("you repeating your favorite trick", "fresh tricks"),
    "reply_to_mismatch": ("emails whose replies go to another domain", "replies to the sender"),
    "from_domain_known": ("senders on a domain the desk hasn't seen for this vendor", "the vendor's usual domains"),
    "free_mail_sender": ("vendors writing from Gmail or another free mailbox", "company email"),
    "display_name_spoof": ("a vendor's name on someone else's address", "names that match the address"),
    "cc_lookalike": ("CCs to a domain a letter or two off a vendor's", "ordinary CCs"),
    "dmarc_fail": ("emails that fail DMARC", "emails that pass DMARC"),
    "spf_fail": ("emails that fail SPF", "emails that pass SPF"),
    "log_domain_age": ("sender domains registered in the last {a:.0f} days", "long-registered domains"),
    "first_time_sender": ("first emails from a new address", "addresses the desk knows"),
    "new_thread_for_payment": ("payment requests that start a new thread", "replies in the vendor's thread"),
    "days_since_bank_change": ("payments within {d:.0f} days of a bank-details change", "long-standing bank details"),
    "bank_change_via_email": ("bank details changed by email", "bank details changed another way"),
    "bank_change_verified": ("bank changes nobody confirmed on the number on file", "bank changes confirmed by callback"),
    "change_request_offered_phone": ("bank changes that came with their own 'call me' number", "no number offered"),
    "new_account_payment": ("the first payments into a newly changed account", "accounts on file for a while"),
}
TREE_AGREEMENT = 0.85  # spec 5.1: only use rules from a tree that agrees with the model this often


def tells(det: Detector, features: dict[str, float], k: int = 5, memory: bool = True) -> list[dict]:
    """The strongest reasons this invoice looks forged, merged by tell name, strongest first."""
    merged: dict[str, dict] = {}
    for name, push in det.contributions(features, memory).items():
        if push <= 0 or name not in TELLS:
            continue
        tell, region = TELLS[name]
        entry = merged.setdefault(tell, {"tell_type": tell, "strength": 0.0, "region": region, "features": []})
        entry["strength"] += 10 * push
        entry["features"].append(name)
    ranked = sorted(merged.values(), key=lambda t: -t["strength"])
    return [{**t, "strength": round(t["strength"], 1)} for t in ranked[:k] if t["strength"] >= 1]


def phrase(feature: str, threshold: float | None = None, high: bool = True, limit: float = 2500.0) -> str:
    text = PHRASES.get(feature, (feature.replace("_", " "), "not " + feature.replace("_", " ")))[0 if high else 1]
    t = threshold if threshold is not None else 0.0
    return text.format(t=t, p=max(0.0, (t - 1) * 100), d=t, a=math.expm1(t), limit=limit)


def memo_rules(det: Detector, rows: list, k: int = 2, memory: bool = True) -> list[str]:
    """Spec 5.1: a depth-2 tree fit on the model's own verdicts, read off as rules with real
    thresholds. Falls back to the largest weights when the tree agrees with the model too little.
    With memory off, the rules only use the features that level judges by."""
    names = _judged_by(det, memory)
    x = np.array([[r.features[n] for n in names] for r in rows])
    verdicts = det.flags(rows, memory)
    if verdicts.any() and not verdicts.all():
        tree = DecisionTreeClassifier(max_depth=2, random_state=0).fit(x, verdicts)
        if (tree.predict(x) == verdicts).mean() >= TREE_AGREEMENT:
            rules = _flag_paths(tree, names)
            if rules:
                return rules[:k]
    weights = sorted(_weights(det, names).items(), key=lambda t: -t[1])
    return [f"Check {phrase(name)}." for name, w in weights[:k] if w > 0]


def top_features(det: Detector, rows: list, k: int = 2, memory: bool = True) -> list[str]:
    """The features the memo rules are about (the tree's splits, or the largest weights)."""
    names = _judged_by(det, memory)
    x = np.array([[r.features[n] for n in names] for r in rows])
    verdicts = det.flags(rows, memory)
    if verdicts.any() and not verdicts.all():
        tree = DecisionTreeClassifier(max_depth=2, random_state=0).fit(x, verdicts)
        if (tree.predict(x) == verdicts).mean() >= TREE_AGREEMENT:
            split = list(dict.fromkeys(names[i] for i in tree.tree_.feature if i >= 0))
            if len(split) >= k:
                return split[:k]
    return [name for name, _ in sorted(_weights(det, names).items(), key=lambda t: -t[1])[:k]]


def patch_note(old: Detector, new: Detector, trigger_rows: list, version: int, trick_recall: float | None,
               memory: bool = True) -> list[str]:
    """Spec 5.2: the features whose push rose most on the attacks that triggered the retrain."""
    if not trigger_rows:
        return [f"Inspector v{version} reviewed the latest invoices."]
    rise = {n: np.mean([new.contributions(r.features, memory)[n] - old.contributions(r.features, memory).get(n, 0.0)
                        for r in trigger_rows])
            for n in new.features}
    learned = [n for n, gain in sorted(rise.items(), key=lambda t: -t[1])[:2] if gain > 0]
    lines = [f"Inspector v{version} now catches {' and '.join(phrase(n) for n in learned) or 'your trick'}, "
             f"learned from {len(trigger_rows)} invoice{'s' if len(trigger_rows) != 1 else ''}."]
    if trick_recall is not None:
        lines.append(f"v{version} catches {trick_recall:.0%} of variants of your trick.")
    return lines


def _judged_by(det: Detector, memory: bool) -> tuple[str, ...]:
    return tuple(n for n in det.features if memory or n not in MEMORY_FEATURES)


def _weights(det: Detector, names) -> dict[str, float]:
    return {n: w for n, w in zip(det.features, det.model.coef_[0]) if n in names}


def _flag_paths(tree: DecisionTreeClassifier, names: tuple[str, ...]) -> list[str]:
    """Rules for the leaves where the tree says FLAGGED, purest first."""
    t, rules = tree.tree_, []

    def walk(node, conditions):
        if t.feature[node] < 0:
            flagged = t.value[node][0][1] / t.value[node][0].sum()
            if flagged > 0.5 and conditions:
                rules.append((flagged, "Flag " + ", and ".join(conditions) + "."))
            return
        name, thr = names[t.feature[node]], float(t.threshold[node])
        walk(t.children_left[node], conditions)  # the low side reads as "not suspicious", so it names nothing
        walk(t.children_right[node], conditions + [phrase(name, thr, high=True)])

    walk(0, [])
    return [text for _, text in sorted(rules, key=lambda r: -r[0])]
