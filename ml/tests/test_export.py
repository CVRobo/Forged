"""The dataset export (docs/realistic-data-plan.md section 1): consented rows only, in real formats."""
import json
import sys
from datetime import datetime, timezone
from email import policy
from email.parser import BytesParser
from types import SimpleNamespace

import pytest

from ml import eventlog, export, store
from ml.adapter import to_invoice
from ml.mail import realize_email
from ml.schema import FEATURES, VendorChangeRequest
from ml.tests.test_adapter import record


@pytest.fixture(autouse=True)
def model_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("FORGED_MODEL_DIR", str(tmp_path))
    store.clear_cache()
    yield tmp_path
    store.clear_cache()


@pytest.fixture
def out(tmp_path):
    return tmp_path / "out"


def prediction():
    """What detector.predict returns, paper-tool features included as served."""
    return SimpleNamespace(version=2, score=0.31, threshold=0.5, flagged=False, features={
        "bank_changed": 1.0, "field_altered_count": 1.0, "max_illegibility": 0.0, "copy_generation": 0.0,
        "scan_quality": 1.0, "stamp_count": 0.0, "stamp_matches_vendor": 1.0})


def lookalike_email() -> dict:
    mail = realize_email("lookalike_domain", "petes", from_name="Pancake Pete's Flour Co. Billing",
                         subject="Invoice PP-0412: new bank details", body="Hi,\nplease pay the new account.\n",
                         sent_at=datetime(2026, 10, 16, 10, 30), domain="petesfl0ur.com",
                         reply_to="ar@petesfl0ur.com", cc=["accounts@petesfl0ur.com"],
                         thread_id="<thread-petes@petesflour.com>", in_reply_to="<petes-last@petesflour.com>")
    return mail.model_dump(mode="json")


def log(consent=True, email=None, **overrides):
    """A taped bank switch, as the server logs a /submit."""
    rec = record(bank_account="••••7781", field_altered=["bank"], cover_email="Please pay the new account.", **overrides)
    return eventlog.log_attempt(rec, prediction(), verdict="PAID", session_id="s1", round_id="r1", consent=consent,
                                email=email, noise=4.2)


def rows(out):
    return [json.loads(line) for line in (out / "attempts.jsonl").read_text().splitlines()]


def parse(path):
    return BytesParser(policy=policy.default).parsebytes(path.read_bytes())


def test_only_consented_rows_are_exported(out):
    kept = [log(invoice_no="PP-1", email=lookalike_email()), log(invoice_no="PP-2")]
    dropped = log(consent=False, email=lookalike_email())
    summary = export.export(out)
    assert summary == {"out_dir": str(out), "rows": 3, "exported": 2, "no_consent": 1, "emails": 1, "invoices": 2}
    assert [r["attempt_id"] for r in rows(out)] == [a.attempt_id for a in kept]
    assert not [p for p in out.rglob("*") if dropped.attempt_id in p.name]
    assert dropped.attempt_id not in (out / "attempts.jsonl").read_text()


def test_paper_tool_fields_and_the_noise_draw_are_left_out(out):
    logged = log()
    assert set(export.DROPPED_RECORD_KEYS) <= set(logged.record) and logged.noise == 4.2
    export.export(out)
    row = rows(out)[0]
    assert not set(export.DROPPED_RECORD_KEYS) & set(row["record"]) and "noise" not in row
    assert row["features"] == {"bank_changed": 1.0}
    assert (row["model_version"], row["score"], row["threshold"], row["flagged"]) == (2, 0.31, 0.5, False)
    assert row["payload_schemes"] == ["bank_switcheroo"] and row["record"]["cover_email"] == "Please pay the new account."


def test_the_drop_lists_name_real_record_keys_and_features():
    assert set(export.DROPPED_FEATURES) <= set(FEATURES)
    assert set(export.DROPPED_RECORD_KEYS) <= set(record())


def test_each_email_is_an_rfc_5322_message_that_parses_back(out):
    a = log(email=lookalike_email())
    export.export(out)
    raw = (out / "emails" / f"{a.attempt_id}.eml").read_bytes()
    assert b"\r\n" in raw and b"\n" not in raw.replace(b"\r\n", b"")
    msg = parse(out / "emails" / f"{a.attempt_id}.eml")
    sender = msg["From"].addresses[0]
    assert (sender.display_name, sender.addr_spec) == ("Pancake Pete's Flour Co. Billing", "billing@petesfl0ur.com")
    assert msg["Reply-To"].addresses[0].addr_spec == "ar@petesfl0ur.com"
    assert msg["Cc"].addresses[0].addr_spec == "accounts@petesfl0ur.com"
    assert msg["To"].addresses[0].addr_spec == "ap@sunnydiner.example"
    assert msg["Subject"] == "Invoice PP-0412: new bank details"
    assert msg["Authentication-Results"] == ("mx.sunnydiner.example; spf=pass smtp.mailfrom=petesfl0ur.com; "
                                             "dkim=pass header.d=petesfl0ur.com; dmarc=pass header.from=petesfl0ur.com")
    assert msg["Message-ID"] == a.email["message_id"] and msg["Date"].datetime == datetime(2026, 10, 16, 10, 30)
    assert msg["In-Reply-To"] == "<petes-last@petesflour.com>"
    assert msg["References"] == "<thread-petes@petesflour.com> <petes-last@petesflour.com>"
    assert (msg["X-Forged-Simulated"], msg["X-Forged-Attempt-Id"], msg["X-Forged-First-Time-Sender"]) == (
        "true", a.attempt_id, "true")
    assert int(msg["X-Forged-Sender-Domain-Age-Days"]) == a.email["sender_domain_age_days"]
    assert msg.get_content().replace("\r\n", "\n") == "Hi,\nplease pay the new account.\n"


def test_sender_identity_stays_out_of_the_eml_but_in_the_jsonl(out):
    a = log(email=lookalike_email())
    export.export(out)
    raw = (out / "emails" / f"{a.attempt_id}.eml").read_bytes()
    assert b"lookalike_domain" not in raw and b"identity" not in raw.lower()
    assert rows(out)[0]["email"]["sender_identity"] == "lookalike_domain"


def test_a_spoofed_sender_fails_dmarc_and_is_unsigned(out):
    mail = realize_email("spoofed_domain", "petes", from_name="Pancake Pete's Flour Co.", subject="Remittance",
                         body="Pay today.", sent_at=datetime(2026, 10, 16, 10, 30)).model_dump(mode="json")
    a = log(email=mail)
    export.export(out)
    assert parse(out / "emails" / f"{a.attempt_id}.eml")["Authentication-Results"] == (
        "mx.sunnydiner.example; spf=fail smtp.mailfrom=petesflour.com; dkim=none; "
        "dmarc=fail header.from=petesflour.com")


def test_an_email_missing_optional_keys_still_exports(out):
    mail = {"from_name": "Pete", "from_addr": "pete@gmail.com", "subject": "Hi\r\nBcc: someone@example.com",
            "body": "pay", "sent_at": "2026-10-16T22:05:00Z"}
    a = log(email=mail)
    export.export(out)
    msg = parse(out / "emails" / f"{a.attempt_id}.eml")
    assert msg["Date"].datetime == datetime(2026, 10, 16, 22, 5, tzinfo=timezone.utc)
    assert msg["Bcc"] is None and msg["Subject"] == "Hi Bcc: someone@example.com"  # typed text never adds a header
    assert msg["Reply-To"] is None and msg["In-Reply-To"] is None and msg["X-Forged-Sender-Domain-Age-Days"] is None
    assert msg["Message-ID"].endswith("@gmail.com>") and msg["X-Forged-First-Time-Sender"] == "false"
    assert msg["Authentication-Results"] == ("mx.sunnydiner.example; spf=none smtp.mailfrom=gmail.com; dkim=none; "
                                             "dmarc=none header.from=gmail.com")


def test_the_ubl_invoice_pays_the_invoice_amount_and_its_lines_multiply_out(out):
    a = log(amount=1500)  # a whited-out total: the adapter adds an Adjustment line
    export.export(out)
    doc = json.loads((out / "invoices" / f"{a.attempt_id}.json").read_text())
    total = doc["LegalMonetaryTotal"]
    assert total["PayableAmount"] == round(to_invoice(a.record).amount, 2) == 1500
    for line in doc["InvoiceLine"]:
        assert round(line["InvoicedQuantity"] * line["Price"]["PriceAmount"], 2) == line["LineExtensionAmount"]
    assert round(sum(line["LineExtensionAmount"] for line in doc["InvoiceLine"]), 2) == total["LineExtensionAmount"]
    assert [line["Item"]["Description"] for line in doc["InvoiceLine"]][-1] == "Adjustment"
    assert (doc["ID"], doc["IssueDate"], doc["DueDate"], doc["DocumentCurrencyCode"]) == (
        "PP-0412", "2026-10-16", "2026-11-15", "USD")
    assert doc["OrderReference"] == {"ID": "PO-4821"}
    assert doc["AccountingSupplierParty"]["Party"] == {"PartyName": {"Name": "Pancake Pete's Flour Co."},
                                                       "Contact": {"ElectronicMail": "billing@petesflour.com"}}
    assert doc["AccountingCustomerParty"]["Party"]["PartyName"]["Name"] == "Sunny Diner"
    assert doc["PaymentMeans"] == {"PaymentMeansCode": "30", "PayeeFinancialAccount": {"ID": "7781"}}
    text = json.dumps(doc)
    assert not any(k in text for k in ("legibility", "stamp", "letterhead", "copy_generation", "scan_quality", "heat"))


def test_a_change_request_attempt_gets_its_change_eml_and_no_invoice(out):
    mail = realize_email("free_mail", "petes", from_name="Pete", subject="New bank account",
                         body="Please move our payments to account 0420.", sent_at=datetime(2026, 10, 12, 9, 0))
    request = VendorChangeRequest(request_id="cr1", vendor_id="petes", new_bank_account="0420", channel="email",
                                  email=mail, requested_at=datetime(2026, 10, 12, 9, 0), applied=True)
    a = eventlog.log_attempt({}, None, verdict="APPLIED", session_id="s1", round_id="r1", consent=True,
                             change_request=request.model_dump(mode="json"))
    summary = export.export(out)
    msg = parse(out / "emails" / f"{a.attempt_id}-change.eml")
    assert msg["From"].addresses[0].addr_spec == mail.from_addr and msg["X-Forged-Attempt-Id"] == a.attempt_id
    assert f"smtp.mailfrom={mail.from_addr.split('@')[1]}" in msg["Authentication-Results"]
    assert not (out / "emails" / f"{a.attempt_id}.eml").exists()
    assert not (out / "invoices" / f"{a.attempt_id}.json").exists()
    assert (summary["emails"], summary["invoices"]) == (1, 0)
    assert rows(out)[0]["change_request"]["new_bank_account"] == "0420"


def test_the_data_card_states_the_true_counts_the_consent_wording_and_the_claim(out):
    log(email=lookalike_email())
    log()
    log(consent=False)
    eventlog.log_attempt(record(), None, verdict="REJECTED", session_id="s2", round_id="r1", consent=True)
    export.export(out)
    card = (out / "DATACARD.md").read_text()
    assert eventlog.CONSENT_TEXT in card and export.HONEST_CLAIM in card and export.LICENSE in card
    for line in ("| Rows logged | 4 |", "| Rows exported | 3 |", "| Rows left out (no consent) | 1 |",
                 "| `.eml` files | 1 |", "| Invoice files | 3 |", "| PAID | 2 |", "| REJECTED | 1 |",
                 "| APPLIED | 0 |", "| `bank_switcheroo` | 2 |", "| `bank_change_fraud` | 0 |", "| none (not fraud) | 1 |"):
        assert line in card, line
    for name in eventlog.Attempt.model_fields:
        assert (f"| `{name}` |" in card) == (name not in export.DROPPED_ATTEMPT_FIELDS), name
    assert all(f"`{k}`" in card for k in export.DROPPED_RECORD_KEYS + export.DROPPED_FEATURES)
    assert "7781, 0420, 1337" in card and "115%" in card


def test_the_command_writes_to_export_under_the_model_dir(model_dir, monkeypatch, capsys):
    log()
    monkeypatch.setattr(sys, "argv", ["ml.export"])
    export.main()
    assert (model_dir / "export" / "DATACARD.md").exists() and (model_dir / "export" / "attempts.jsonl").exists()
    assert "Exported 1 of 1 rows" in capsys.readouterr().out
