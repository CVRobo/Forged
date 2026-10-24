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
sender_identity, how the attacker got the address, is ground truth: attempts.jsonl only. The game
world's Message-IDs hash it in, so the export re-hashes every id with a secret salt made per run.

Each run is written to a temporary folder next to --out and moved in only once complete, replacing
the previous export's four entries above (anything else in the folder is left alone). The model
folder itself is refused, since its attempts.jsonl is the event log.
"""
import argparse
import hashlib
import json
import os
import re
import secrets
import shutil
import tempfile
from collections import Counter
from datetime import date, datetime
from email import policy
from email.headerregistry import Address
from email.message import EmailMessage as MailMessage
from email.utils import format_datetime, getaddresses, unquote
from pathlib import Path
from typing import get_args, get_origin

from pydantic import ValidationError

from ml import store
from ml.adapter import YEAR, to_invoice
from ml.eventlog import CONSENT_TEXT, Attempt
from ml.payloads import PAD_LIMIT, REBILL_AMOUNT_TOL
from ml.world import ATTACKER_ACCOUNTS, VENDORS

# Paper-tool fields: game flavour, never exported. The data card prints these lists.
DROPPED_RECORD_KEYS = ("field_altered", "legibility", "scan_quality", "copy_generation", "stamp_type",
                       "stamp_position", "letterhead_match", "heat", "domain_mismatch")
DROPPED_FEATURES = ("field_altered_count", "max_illegibility", "copy_generation", "scan_quality", "stamp_count",
                    "stamp_matches_vendor")
DROPPED_ATTEMPT_FIELDS = ("noise",)  # the server's random draw
OUTPUTS = ("attempts.jsonl", "emails", "invoices", "DATACARD.md")  # replaced each run; the data card last

HONEST_CLAIM = ("Forged collects human-written vendor-impersonation attacks (email, bank-change request, invoice) "
                "against a detector and a callback policy, with labels players can't poison. It's simulated, not "
                "real fraud data, but it's in the real medium and real formats.")
LICENSE = "CC BY 4.0 (the team's proposal; confirm before release)"
AUTHSERV_ID = "mx.sunnydiner.example"  # Sunny Diner's receiving mail server
AP_NAME, AP_ADDR = "Sunny Diner Accounts Payable", "ap@sunnydiner.example"
CUSTOMER = "Sunny Diner"
CUSTOMIZATION_ID = "urn:forged:simulated-invoice:1"
AUTH_RESULTS = ("pass", "fail", "none")
INVALID_DOMAIN = "unknown.invalid"  # RFC 2606; stands in for typed text that isn't one address with a real host
HOSTNAME = re.compile(r"[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+")
NAME_LIMIT = 200   # display names in headers: the folder can't split one long word, and a line must stay <= 998
LOCAL_LIMIT = 64   # RFC 5321's longest local part

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
    if (out / "attempts.jsonl").resolve() == _log_path().resolve():
        raise ValueError(f"export --out must not be the model folder ({out}): it would overwrite the event log")
    if attempts is None:
        rows, unreadable = _read_log()
    else:
        rows, unreadable = [a if isinstance(a, Attempt) else Attempt.model_validate(a) for a in attempts], 0
    target = out.resolve()
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = Path(tempfile.mkdtemp(dir=target.parent, prefix=f".{target.name}."))  # same disk, so os.replace works
    try:
        summary = _write(tmp, rows, unreadable, str(out))
        _swap_in(tmp, target)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return summary


def _write(folder: Path, rows: list[Attempt], unreadable: int, out_dir: str) -> dict:
    kept = [a for a in rows if a.consent]
    salt = secrets.token_hex(16)  # per run and never written out, so no exported id can be traced back
    (folder / "emails").mkdir()
    (folder / "invoices").mkdir()
    (folder / "attempts.jsonl").write_text(
        "".join(json.dumps(export_row(a), ensure_ascii=False) + "\n" for a in kept), encoding="utf-8")
    emails = invoices = skipped = 0
    for a in kept:
        for name, mail, default_date in _emails(a):
            try:
                data = to_eml(mail, a.attempt_id, default_date, salt=salt, name=name)
            except Exception:  # one odd row never stops the export; the data card counts it
                skipped += 1
                continue
            (folder / "emails" / f"{name}.eml").write_bytes(data)
            emails += 1
        if has_invoice(a.record):
            try:
                text = json.dumps(to_ubl(a.record), indent=1, ensure_ascii=False)
            except Exception:
                skipped += 1
                continue
            (folder / "invoices" / f"{a.attempt_id}.json").write_text(text, encoding="utf-8")
            invoices += 1
    summary = {"out_dir": out_dir, "rows": len(rows), "exported": len(kept), "no_consent": len(rows) - len(kept),
               "emails": emails, "invoices": invoices, "skipped": skipped, "unreadable": unreadable}
    (folder / "DATACARD.md").write_text(datacard(kept, summary), encoding="utf-8")
    return summary


def _swap_in(tmp: Path, out: Path) -> None:
    """Move the finished export into out, replacing the previous export's entries and nothing else."""
    out.mkdir(parents=True, exist_ok=True)
    for name in OUTPUTS:
        old = out / name
        if old.is_symlink():
            old.unlink()
        elif old.is_dir():
            shutil.rmtree(old)
        os.replace(tmp / name, old)


def _read_log() -> tuple[list[Attempt], int]:
    """The event log, like eventlog.read_attempts(), but a line that doesn't parse (a row the server was still
    writing when the export ran) is skipped and counted, not fatal."""
    path, rows, bad = _log_path(), [], 0
    for line in path.read_bytes().split(b"\n") if path.exists() else []:
        if not line.strip():
            continue
        try:
            rows.append(Attempt.model_validate_json(line))
        except ValidationError:
            bad += 1
    return rows, bad


def _log_path() -> Path:
    return store.model_dir() / "attempts.jsonl"


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

def to_eml(mail: dict, attempt_id: str, default_date: datetime, *, salt: str, name: str = "") -> bytes:
    """An RFC 5322 message as Sunny Diner's mail server received it. default_date: when sent_at is missing.
    salt: the run's secret for opaque_id(). name: the file name, which seeds the Message-ID when there is none."""
    sender = mailbox(mail.get("from_name"), mail.get("from_addr"))
    reply_to, cc = addresses(mail.get("reply_to")), addresses(mail.get("cc"))
    utf8 = not all(a.username.isascii() for a in (sender, *reply_to, *cc))
    msg = MailMessage(policy=policy.SMTPUTF8 if utf8 else policy.SMTP)  # RFC 6532 for a non-ASCII local part
    msg["Authentication-Results"] = authentication_results(mail)  # receiving servers prepend it
    msg["Message-ID"] = (opaque_id(mail.get("message_id"), salt)
                         or opaque_id(f"<{name or attempt_id}@{sender.domain}>", salt))
    msg["Date"] = format_datetime(_when(mail.get("sent_at")) or default_date)
    msg["From"] = sender
    msg["To"] = Address(display_name=AP_NAME, addr_spec=AP_ADDR)
    if reply_to:
        msg["Reply-To"] = reply_to
    if cc:
        msg["Cc"] = cc
    msg["Subject"] = _line(mail.get("subject"))
    parent, thread = opaque_id(mail.get("in_reply_to"), salt), opaque_id(mail.get("thread_id"), salt)
    if parent:
        msg["In-Reply-To"] = parent
    refs = list(dict.fromkeys(r for r in (thread, parent) if r))  # thread root first, then the parent
    if refs:
        msg["References"] = " ".join(refs)
    # What the game world set for this sender, with no standard header of its own.
    msg["X-Forged-Simulated"] = "true"
    msg["X-Forged-Attempt-Id"] = attempt_id
    age = _int(mail.get("sender_domain_age_days"))
    if age is not None:
        msg["X-Forged-Sender-Domain-Age-Days"] = str(age)
    msg["X-Forged-First-Time-Sender"] = "true" if mail.get("first_time_sender") else "false"
    msg.set_content(str(mail.get("body") or ""))
    return msg.as_bytes()


def authentication_results(mail: dict) -> str:
    """RFC 8601, e.g. "mx.sunnydiner.example; spf=pass smtp.mailfrom=petesflour.com; dkim=pass
    header.d=petesflour.com; dmarc=pass header.from=petesflour.com". dkim=none means unsigned: no header.d.
    The domain is the checked one from mailbox(), so typed text can't add clauses or a second From domain."""
    domain = mailbox(None, mail.get("from_addr")).domain
    spf, dkim, dmarc = (_result(mail.get(k)) for k in ("spf", "dkim", "dmarc"))
    return "; ".join([AUTHSERV_ID, f"spf={spf} smtp.mailfrom={domain}",
                      "dkim=none" if dkim == "none" else f"dkim={dkim} header.d={domain}",
                      f"dmarc={dmarc} header.from={domain}"])


def mailbox(name, addr) -> Address:
    """One typed address as a header mailbox. The host is written as its IDNA A-label (xn--...), the form a
    receiving server logs, and the display name is cut to NAME_LIMIT. Text that isn't exactly one address with
    a real hostname becomes invalid@unknown.invalid; what was typed is still in attempts.jsonl."""
    found = getaddresses([_line(addr)])
    local, at, host = found[0][1].rpartition("@") if len(found) == 1 else ("", "", "")
    local = unquote(local)
    host = _host(host) if at and 0 < len(local) <= LOCAL_LIMIT else ""
    if not host:
        local, host = "invalid", INVALID_DOMAIN
    return Address(display_name=_line(name)[:NAME_LIMIT].rstrip(), username=local, domain=host)


def addresses(value) -> list[Address]:
    """Typed Reply-To or Cc text (one string or a list of them) as mailboxes, each checked like From."""
    texts = [value] if isinstance(value, str) else list(value or [])
    return [mailbox(name, addr) for text in texts for name, addr in getaddresses([_line(text)]) if name or addr]


def opaque_id(value, salt: str) -> str:
    """A Message-ID re-hashed with the run's secret salt, keeping its host. The game world's ids hash in
    sender_identity (ml/mail.py), which would give it away; the same id still maps to the same new id, so
    In-Reply-To and References keep pointing at the right message within one export."""
    value = _msg_id(value)
    if not value:
        return ""
    host = _host(value.strip("<>").rpartition("@")[2]) or INVALID_DOMAIN
    return f"<{hashlib.sha256((salt + value).encode()).hexdigest()[:16]}@{host}>"


def _host(text: str) -> str:
    """A typed hostname as its lower-case A-label, or "" when it isn't a hostname."""
    try:
        host = text.strip().rstrip(".").encode("idna").decode("ascii").lower()
    except UnicodeError:
        return ""
    return host if len(host) <= 253 and HOSTNAME.fullmatch(host) else ""


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


def _line(value) -> str:
    """One header line: player text never adds a header."""
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _msg_id(value) -> str:
    value = _line(value)
    return value if not value or value.startswith("<") else f"<{value}>"


def _int(value) -> int | None:
    try:
        return int(float(value))
    except (TypeError, ValueError, OverflowError):
        return None


def _when(value) -> datetime | None:
    if isinstance(value, datetime):
        return value
    if isinstance(value, date):
        return datetime(value.year, value.month, value.day)
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")) if value else None
    except ValueError:
        return None


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
        "Addresses are written the way a receiving server records them: hostnames in their IDNA A-label form "
        "(`xn--...`), so a lookalike domain shows as punycode; a non-ASCII local part makes that message RFC 6532 "
        "(UTF-8 headers). Typed address text that isn't exactly one mailbox with a real hostname is written as "
        f"`invalid@{INVALID_DOMAIN}`, and display names are cut to {NAME_LIMIT} characters to keep header lines "
        "within RFC 5322's limit. The text as typed is in `attempts.jsonl`.", "",
        "## Counts", "",
        "| | Rows |", "| --- | ---: |",
        f"| Rows logged | {summary['rows']} |",
        f"| Log lines that could not be read (e.g. cut off mid-write) | {summary['unreadable']} |",
        f"| Rows exported | {summary['exported']} |",
        f"| Rows left out (no consent) | {summary['no_consent']} |",
        f"| `.eml` files | {summary['emails']} |",
        f"| Invoice files | {summary['invoices']} |",
        f"| Files skipped (could not be built) | {summary['skipped']} |", "",
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
        "is only in `attempts.jsonl`. The game's own Message-IDs hash it in, so every `Message-ID`, `In-Reply-To` "
        "and `References` id is re-hashed with a secret salt made for this export: threads still match within the "
        "export, but the ids don't match `attempts.jsonl` or any other export.", "",
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
          f"to {summary['out_dir']}: .eml files {summary['emails']}, invoice files {summary['invoices']}"
          + (f", {summary['skipped']} files skipped" if summary["skipped"] else "")
          + (f", {summary['unreadable']} unreadable log lines" if summary["unreadable"] else ""))


if __name__ == "__main__":
    main()
