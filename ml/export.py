"""The dataset export (docs/realistic-data-plan.md section 1).

    ml/.venv/bin/python -m ml.export                  # into <FORGED_MODEL_DIR>/export (default ml/models/export)
    ml/.venv/bin/python -m ml.export --out data/forged

Only rows logged with consent are exported, in the formats real tools read:

    attempts.jsonl            one row per consented attempt, labels and model output included
    emails/<id>.eml           the attempt's email as an RFC 5322 message (CRLF line endings)
    emails/<id>-change.eml    the bank-change request's email, when the request came by email
    invoices/<id>.json        the invoice as UBL 2.1-style JSON
    DATACARD.md               what this is, counts, fields, label rules, consent wording, known artifacts, license

The paper tools (whiteout, mug, photocopier, stamps) are game flavour, so their record keys and
features are left out, as is the server's noise draw. The world-simulated mail checks go where a
receiving server writes them (Authentication-Results, RFC 8601) or in X-Forged- headers.
sender_identity, how the attacker got the address, is ground truth: attempts.jsonl only.
"""
import argparse
import hashlib
import json
import re
from collections import Counter
from datetime import date, datetime
from email import policy
from email.headerregistry import Address
from email.message import EmailMessage as MailMessage
from email.utils import format_datetime, formataddr
from pathlib import Path
from typing import get_args, get_origin

from ml import store
from ml.adapter import YEAR, to_invoice
from ml.eventlog import CONSENT_TEXT, Attempt, read_attempts
from ml.payloads import PAD_LIMIT, REBILL_AMOUNT_TOL
from ml.world import ATTACKER_ACCOUNTS, VENDORS

# Paper-tool fields: game flavour, never exported. The data card prints these lists.
DROPPED_RECORD_KEYS = ("field_altered", "legibility", "scan_quality", "copy_generation", "stamp_type",
                       "stamp_position", "letterhead_match", "heat", "domain_mismatch")
DROPPED_FEATURES = ("field_altered_count", "max_illegibility", "copy_generation", "scan_quality", "stamp_count",
                    "stamp_matches_vendor")
DROPPED_ATTEMPT_FIELDS = ("noise",)  # the server's random draw

HONEST_CLAIM = ("Forged collects human-written vendor-impersonation attacks (email, bank-change request, invoice) "
                "against a detector and a callback policy, with labels players can't poison. It's simulated, not "
                "real fraud data, but it's in the real medium and real formats.")
LICENSE = "CC BY 4.0 (the team's proposal; confirm before release)"
AUTHSERV_ID = "mx.sunnydiner.example"  # Sunny Diner's receiving mail server
AP_NAME, AP_ADDR = "Sunny Diner Accounts Payable", "ap@sunnydiner.example"
CUSTOMER = "Sunny Diner"
CUSTOMIZATION_ID = "urn:forged:simulated-invoice:1"
AUTH_RESULTS = ("pass", "fail", "none")

LABEL_RULES = {
    "bank_switcheroo": "a known vendor's invoice pays a mule account that differs from the account on file",
    "bank_change_fraud": "a known vendor's invoice pays a mule account that is now the account on file because a "
                         "bank-change request was applied; a change request is labelled fraud when its new account "
                         "is a mule account",
    "duplicate_dance": f"re-bills an already-paid invoice (amount within {REBILL_AMOUNT_TOL:.0%}) within half the "
                       "vendor's cadence",
    "boss_request": "an unapproved payee with no open order paid to a mule",
    "phantom_supplier": "an unapproved payee paid to a mule",
    "padded_invoice": f"total over {PAD_LIMIT:.0%} of the real order amount",
}
FIELD_NOTES = {
    "attempt_id": "random id; the `.eml` and invoice files are named after it",
    "schema_version": "event log schema version",
    "logged_at": "when the server logged the attempt (ISO 8601)",
    "session_id": "random id made in the player's browser, one per session",
    "round_id": "the round within the session",
    "consent": "the player accepted the consent wording (always true in this export)",
    "level": "game level (1 is Sunny Diner)",
    "declared_scheme": "the scheme the player said they were running; kept only for comparison, never a label",
    "payload_schemes": "the label set (see Labels)",
    "is_fraud": "true when `payload_schemes` is not empty",
    "record": "the invoice as the game sent it, without the paper-tool keys",
    "email": "the email that delivered the invoice: headers, body, the world-set mail checks and `sender_identity`",
    "change_request": "the bank-change request (act 1): new account, channel, its email, callback and outcome",
    "defender_actions": "what the AP desk did",
    "model_version": "the detector version that scored the attempt",
    "score": "the detector's P(fraud)",
    "threshold": "the detector's flag threshold for the level",
    "flagged": "whether the detector flagged it",
    "features": "the features the detector saw, as served, without the paper-tool features",
    "verdict": "PAID or FLAGGED (invoice), REJECTED (failed the validity gate), APPLIED or BLOCKED (bank change)",
    "persuasion": "the clerk's persuasion score (0-100), when the player talked to the clerk",
    "perks": "game perks active for the run",
}


def export(out_dir: str | Path | None = None, attempts=None) -> dict:
    """attempts: Attempt rows or dicts; read from the event log when None."""
    out = Path(out_dir) if out_dir else store.model_dir() / "export"
    rows = [a if isinstance(a, Attempt) else Attempt.model_validate(a)
            for a in (read_attempts() if attempts is None else attempts)]
    kept = [a for a in rows if a.consent]
    (out / "emails").mkdir(parents=True, exist_ok=True)
    (out / "invoices").mkdir(parents=True, exist_ok=True)
    (out / "attempts.jsonl").write_text(
        "".join(json.dumps(export_row(a), ensure_ascii=False) + "\n" for a in kept), encoding="utf-8")
    emails = invoices = 0
    for a in kept:
        for name, mail, default_date in _emails(a):
            (out / "emails" / f"{name}.eml").write_bytes(to_eml(mail, a.attempt_id, default_date))
            emails += 1
        if has_invoice(a.record):
            (out / "invoices" / f"{a.attempt_id}.json").write_text(
                json.dumps(to_ubl(a.record), indent=1, ensure_ascii=False), encoding="utf-8")
            invoices += 1
    summary = {"out_dir": str(out), "rows": len(rows), "exported": len(kept), "no_consent": len(rows) - len(kept),
               "emails": emails, "invoices": invoices}
    (out / "DATACARD.md").write_text(datacard(kept, summary), encoding="utf-8")
    return summary


def export_row(attempt: Attempt) -> dict:
    row = attempt.model_dump(mode="json")
    for key in DROPPED_ATTEMPT_FIELDS:
        row.pop(key, None)
    row["record"] = {k: v for k, v in row["record"].items() if k not in DROPPED_RECORD_KEYS}
    row["features"] = {k: v for k, v in row["features"].items() if k not in DROPPED_FEATURES}
    return row


def has_invoice(record: dict) -> bool:
    """Change-request attempts (APPLIED, BLOCKED) may log an empty record: no invoice to export."""
    return any(record.get(k) for k in ("vendor", "amount", "line_items", "invoice_no"))


# --- email -------------------------------------------------------------------------------------

def to_eml(mail: dict, attempt_id: str, default_date: datetime) -> bytes:
    """An RFC 5322 message as Sunny Diner's mail server received it. default_date: when sent_at is missing."""
    msg = MailMessage(policy=policy.SMTP)
    addr = _line(mail.get("from_addr"))
    domain = _domain(addr)
    msg["Authentication-Results"] = authentication_results(mail)  # receiving servers prepend it
    msg["Message-ID"] = _msg_id(mail.get("message_id")) or f"<{_hash(mail)}@{domain}>"
    msg["Date"] = format_datetime(_when(mail.get("sent_at")) or default_date)
    msg["From"] = _address(_line(mail.get("from_name")), addr)
    msg["To"] = Address(display_name=AP_NAME, addr_spec=AP_ADDR)
    if mail.get("reply_to"):
        msg["Reply-To"] = _line(mail["reply_to"])
    cc = mail.get("cc") or []
    cc = [_line(c) for c in ([cc] if isinstance(cc, str) else cc) if c]
    if cc:
        msg["Cc"] = ", ".join(cc)
    msg["Subject"] = _line(mail.get("subject"))
    parent, thread = _msg_id(mail.get("in_reply_to")), _msg_id(mail.get("thread_id"))
    if parent:
        msg["In-Reply-To"] = parent
    refs = list(dict.fromkeys(r for r in (thread, parent) if r))  # thread root first, then the parent
    if refs:
        msg["References"] = " ".join(refs)
    # What the game world set for this sender, with no standard header of its own.
    msg["X-Forged-Simulated"] = "true"
    msg["X-Forged-Attempt-Id"] = attempt_id
    if mail.get("sender_domain_age_days") is not None:
        msg["X-Forged-Sender-Domain-Age-Days"] = str(int(mail["sender_domain_age_days"]))
    msg["X-Forged-First-Time-Sender"] = "true" if mail.get("first_time_sender") else "false"
    msg.set_content(str(mail.get("body") or ""))
    return msg.as_bytes()


def authentication_results(mail: dict) -> str:
    """RFC 8601, e.g. "mx.sunnydiner.example; spf=pass smtp.mailfrom=petesflour.com; dkim=pass
    header.d=petesflour.com; dmarc=pass header.from=petesflour.com". dkim=none means unsigned: no header.d."""
    domain = _domain(_line(mail.get("from_addr")))
    spf, dkim, dmarc = (_result(mail.get(k)) for k in ("spf", "dkim", "dmarc"))
    return "; ".join([AUTHSERV_ID, f"spf={spf} smtp.mailfrom={domain}",
                      "dkim=none" if dkim == "none" else f"dkim={dkim} header.d={domain}",
                      f"dmarc={dmarc} header.from={domain}"])


def _result(value) -> str:
    value = str(value or "none").lower()
    return value if value in AUTH_RESULTS else "none"


def _emails(a: Attempt):
    """(file name, email dict, date to use when the email has none) for each email in the attempt."""
    if a.email:
        yield a.attempt_id, a.email, a.logged_at
    request = a.change_request or {}
    if request.get("email"):
        yield f"{a.attempt_id}-change", request["email"], _when(request.get("requested_at")) or a.logged_at


def _address(name: str, addr: str):
    try:
        return Address(display_name=name, addr_spec=addr)
    except (ValueError, IndexError, TypeError):  # not a valid address: keep what was typed
        return formataddr((name, addr))


def _line(value) -> str:
    """One header line: player text never adds a header."""
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _domain(addr: str) -> str:
    return (addr.rpartition("@")[2].lower() if "@" in addr else "") or "unknown.invalid"


def _msg_id(value) -> str:
    value = _line(value)
    return value if not value or value.startswith("<") else f"<{value}>"


def _when(value) -> datetime | None:
    if isinstance(value, datetime):
        return value
    if isinstance(value, date):
        return datetime(value.year, value.month, value.day)
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")) if value else None
    except ValueError:
        return None


def _hash(mail: dict) -> str:
    return hashlib.sha256(json.dumps(mail, sort_keys=True, default=str).encode()).hexdigest()[:16]


# --- invoice -----------------------------------------------------------------------------------

def to_ubl(record: dict) -> dict:
    """The invoice as UBL 2.1-style JSON: UBL element names, plain JSON values, no paper-tool data."""
    inv = to_invoice(record)
    lines = []
    for i, li in enumerate(inv.line_items, 1):
        price = _cents(li.unit_price)
        lines.append({"ID": str(i), "InvoicedQuantity": _number(li.quantity),
                      "LineExtensionAmount": _cents(li.quantity * price),
                      "Item": {"Description": li.description}, "Price": {"PriceAmount": price}})
    supplier = {"PartyName": {"Name": inv.vendor_name}}
    if inv.sender_domain:
        supplier["Contact"] = {"ElectronicMail": f"billing@{inv.sender_domain}"}
    doc = {"UBLVersionID": "2.1", "CustomizationID": CUSTOMIZATION_ID, "ID": inv.invoice_id,
           "IssueDate": inv.issue_date.isoformat(), "DueDate": inv.due_date.isoformat(),
           "InvoiceTypeCode": "380", "DocumentCurrencyCode": "USD"}  # 380: commercial invoice (UNCL1001)
    if inv.order_number:
        doc["OrderReference"] = {"ID": inv.order_number}
    line_total, payable = _cents(sum(l["LineExtensionAmount"] for l in lines)), _cents(inv.amount)
    totals = {"LineExtensionAmount": line_total, "PayableAmount": payable}
    if payable != line_total:  # only when a unit price had sub-cent digits
        totals["PayableRoundingAmount"] = _cents(payable - line_total)
    return doc | {
        "AccountingSupplierParty": {"Party": supplier},
        "AccountingCustomerParty": {"Party": {"PartyName": {"Name": CUSTOMER}, "Contact": {"ElectronicMail": AP_ADDR}}},
        "PaymentMeans": {"PaymentMeansCode": "30", "PayeeFinancialAccount": {"ID": inv.bank_account}},  # 30: credit transfer
        "InvoiceLine": lines,
        "LegalMonetaryTotal": totals,
    }


def _cents(x: float) -> float:
    return round(x, 2) + 0.0  # + 0.0 turns -0.0 into 0.0


def _number(x: float) -> float | int:
    return int(x) if float(x).is_integer() else x


# --- data card ---------------------------------------------------------------------------------

def datacard(kept: list[Attempt], summary: dict) -> str:
    verdicts = Counter(a.verdict for a in kept)
    labels = Counter(s for a in kept for s in a.payload_schemes)
    mules = ", ".join(ATTACKER_ACCOUNTS)
    out = [
        "# Forged attempts: data card", "",
        "## What this is", "",
        "Players of Forged, a hackathon game, play a fraudster trying to get a fictional diner's accounts-payable "
        "desk to pay them. Each row is one attempt: what the player sent (an email, a bank-change request, an "
        "invoice), what the detector scored and decided, what the desk did, and labels computed from the game's "
        "hidden ground truth.", "",
        f"> {HONEST_CLAIM}", "",
        "## Files", "",
        "| File | What it holds |", "| --- | --- |",
        "| `attempts.jsonl` | one JSON row per consented attempt (fields below) |",
        "| `emails/<attempt_id>.eml` | the attempt's email, RFC 5322, CRLF line endings |",
        "| `emails/<attempt_id>-change.eml` | the bank-change request's email, when it came by email |",
        "| `invoices/<attempt_id>.json` | the invoice, UBL 2.1-style JSON (UBL element names, USD) |",
        "", f"Each `.eml` carries the simulated SPF, DKIM and DMARC results in an `Authentication-Results` header "
        f"(RFC 8601, authserv-id `{AUTHSERV_ID}`), and the other world-set values in `X-Forged-Simulated`, "
        "`X-Forged-Attempt-Id`, `X-Forged-Sender-Domain-Age-Days` and `X-Forged-First-Time-Sender`.", "",
        "## Counts", "",
        "| | Rows |", "| --- | ---: |",
        f"| Rows logged | {summary['rows']} |",
        f"| Rows exported | {summary['exported']} |",
        f"| Rows left out (no consent) | {summary['no_consent']} |",
        f"| `.eml` files | {summary['emails']} |",
        f"| Invoice files | {summary['invoices']} |", "",
        "Exported rows by verdict:", "",
        "| Verdict | Rows |", "| --- | ---: |",
        *(f"| {v} | {verdicts[v]} |" for v in get_args(Attempt.model_fields["verdict"].annotation)), "",
        "Exported rows by label (a row can carry more than one):", "",
        "| Label | Rows |", "| --- | ---: |",
        *(f"| `{s}` | {labels[s]} |" for s in [*LABEL_RULES, *sorted(set(labels) - set(LABEL_RULES))]),
        f"| none (not fraud) | {sum(not a.payload_schemes for a in kept)} |", "",
        "## Fields of attempts.jsonl", "",
        "| Field | Type | What it holds |", "| --- | --- | --- |",
        *(f"| `{name}` | `{_type_name(field.annotation)}` | {FIELD_NOTES.get(name, '')} |"
          for name, field in Attempt.model_fields.items() if name not in DROPPED_ATTEMPT_FIELDS), "",
        "## Labels", "",
        "`payload_schemes` is the label set. Labels come only from the checks in `ml/payloads.py` against hidden "
        "ground truth (the players' mule accounts and the real order amounts), never from what the player "
        "declares, so a player can't poison them. `declared_scheme` is the player's own claim and is kept only "
        "for comparison.", "",
        "| Label | Rule |", "| --- | --- |",
        *(f"| `{s}` | {rule} |" for s, rule in LABEL_RULES.items()), "",
        "## Consent", "",
        "Players saw this before round 1. Only rows where they accepted it are exported:", "",
        f"> {CONSENT_TEXT}", "",
        "Without consent the game keeps the numbers, so its metrics stay complete, but blanks every field the "
        "player typed. Those rows are left out of this export entirely.", "",
        "## Known artifacts", "",
        f"- Vendors, names, accounts and dates are synthetic: one fictional diner, {len(VENDORS)} vendors, "
        f"{YEAR} dates.",
        "- SPF, DKIM, DMARC, domain age and first contact are set by the game world from the sender identity the "
        "player picked, not measured.",
        f"- The mule accounts are a fixed small set ({mules}).",
        "- The legit traffic the detector was trained on is generated, and its emails come from the same templates "
        "as scripted attacks.",
        "- Model scores come from a detector trained on simulated data, so they are not a benchmark of real-world "
        "performance.",
        "- Players are hackathon participants, not real criminals.", "",
        "## What was left out", "",
        f"- Rows logged without consent ({summary['no_consent']} here).",
        "- The paper tools are game flavour. Record keys: " + ", ".join(f"`{k}`" for k in DROPPED_RECORD_KEYS) + ".",
        "- Their features: " + ", ".join(f"`{k}`" for k in DROPPED_FEATURES) + ".",
        "- The server's random draw: " + ", ".join(f"`{k}`" for k in DROPPED_ATTEMPT_FIELDS) + ".",
        "- From the `.eml` files: `sender_identity` (how the attacker got the address). It is ground truth, so it "
        "is only in `attempts.jsonl`.", "",
        "## License", "",
        LICENSE, "",
    ]
    return "\n".join(out)


def _type_name(annotation) -> str:
    name = annotation.__name__ if isinstance(annotation, type) and get_origin(annotation) is None else str(annotation)
    return name.replace("typing.", "").replace("|", "\\|")  # a bare | would split the table cell


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", default=None, help="output folder (default: <FORGED_MODEL_DIR>/export)")
    args = parser.parse_args()
    summary = export(args.out)
    print(f"Exported {summary['exported']} of {summary['rows']} rows ({summary['no_consent']} without consent) "
          f"to {summary['out_dir']}: .eml files {summary['emails']}, invoice files {summary['invoices']}")


if __name__ == "__main__":
    main()
