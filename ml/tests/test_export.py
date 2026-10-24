"""The dataset export (docs/realistic-data-plan.md section 1): consented rows only, in real formats."""
import json
import sys
from datetime import datetime, timezone
from email import policy
from email.parser import BytesParser, Parser
from types import SimpleNamespace
from typing import get_args

import pytest

from ml import eventlog, export, mail as mail_module, store
from ml.adapter import to_invoice
from ml.mail import realize_email
from ml.schema import FEATURES, SenderIdentity, VendorChangeRequest
from ml.tests.test_adapter import record
from ml.world import VENDORS


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
    assert summary == {"out_dir": str(out), "rows": 3, "exported": 2, "no_consent": 1, "emails": 1, "invoices": 2,
                       "skipped": 0, "unreadable": 0}
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
    assert msg["Date"].datetime == datetime(2026, 10, 16, 10, 30)
    # Ids are re-hashed (they'd give away sender_identity) but keep their host and their place in the thread.
    assert msg["Message-ID"] != a.email["message_id"] and msg["Message-ID"].endswith("@petesfl0ur.com>")
    assert msg["In-Reply-To"] != "<petes-last@petesflour.com>" and msg["In-Reply-To"].endswith("@petesflour.com>")
    thread, parent = msg["References"].split()
    assert parent == msg["In-Reply-To"] and thread != parent and thread.endswith("@petesflour.com>")
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


# --- review fixes ------------------------------------------------------------------------------

def invoice_email(identity="vendor_mailbox", **kw) -> dict:
    fields = dict(from_name="Pancake Pete's Flour Co. Billing", subject="Invoice PP-0412", body="Please pay.",
                  sent_at=datetime(2026, 10, 16, 10, 30))
    return realize_email(identity, "petes", **{**fields, **kw}).model_dump(mode="json")


def eml_lines(path) -> list[str]:
    return path.read_bytes().decode("utf-8").split("\r\n")


def test_message_ids_dont_give_away_the_sender_identity(out):
    """compromised_mailbox and vendor_mailbox send the same message; only the world-made id told them apart."""
    vendor, compromised = log(email=invoice_email("vendor_mailbox")), log(email=invoice_email("compromised_mailbox"))
    export.export(out)
    files = [eml_lines(out / "emails" / f"{a.attempt_id}.eml") for a in (vendor, compromised)]
    differ = {line.split(":")[0] for line_a, line_b in zip(*files) if line_a != line_b for line in (line_a, line_b)}
    assert differ == {"Message-ID", "X-Forged-Attempt-Id"}
    guesses = {mail_module._hash(identity, v.vendor_id, "Invoice PP-0412", datetime(2026, 10, 16, 10, 30))
               for identity in get_args(SenderIdentity) for v in VENDORS}
    for a in (vendor, compromised):
        msg_id = parse(out / "emails" / f"{a.attempt_id}.eml")["Message-ID"]
        assert msg_id != a.email["message_id"] and msg_id.strip("<>").split("@")[0] not in guesses


def test_the_fallback_message_id_doesnt_depend_on_the_sender_identity():
    mails = [{k: v for k, v in invoice_email(identity).items() if k != "message_id"}
             for identity in ("vendor_mailbox", "compromised_mailbox")]
    assert mails[0]["sender_identity"] != mails[1]["sender_identity"]
    a, b = (export.to_eml(m, "a1", datetime(2026, 10, 16), salt="s") for m in mails)
    assert a == b


def test_threads_still_match_across_files_after_the_ids_are_rehashed(out):
    change_mail = invoice_email("lookalike_domain", subject="New bank details", domain="petesfl0ur.com")
    request = VendorChangeRequest(request_id="cr1", vendor_id="petes", new_bank_account="0420", channel="email",
                                  email=change_mail, requested_at=datetime(2026, 10, 12, 9, 0), applied=True)
    change = eventlog.log_attempt({}, None, verdict="APPLIED", session_id="s1", round_id="r1", consent=True,
                                  change_request=request.model_dump(mode="json"))
    reply = log(email=invoice_email("lookalike_domain", domain="petesfl0ur.com", in_reply_to=change_mail["message_id"],
                                    thread_id="<thread-petes@petesflour.com>"))
    export.export(out)
    first = parse(out / "emails" / f"{change.attempt_id}-change.eml")
    second = parse(out / "emails" / f"{reply.attempt_id}.eml")
    assert first["Message-ID"] != change_mail["message_id"]
    assert second["In-Reply-To"] == first["Message-ID"] == second["References"].split()[-1]


def test_a_homoglyph_domain_is_written_as_its_a_label_and_the_export_carries_on(out):
    cyrillic = "petesflоur.com"  # the o is Cyrillic
    before, a, after = log(invoice_no="PP-1"), log(email=invoice_email(
        "lookalike_domain", domain=cyrillic, reply_to=f"ar@{cyrillic}", cc=[f"Accounts <accounts@{cyrillic}>"])), \
        log(invoice_no="PP-3", email=invoice_email())
    summary = export.export(out)
    assert (summary["emails"], summary["invoices"], summary["skipped"]) == (2, 3, 0)
    raw = (out / "emails" / f"{a.attempt_id}.eml").read_bytes()
    assert raw.isascii() and b"=?utf-8?" not in raw
    msg = parse(out / "emails" / f"{a.attempt_id}.eml")
    a_label = cyrillic.encode("idna").decode()
    assert a_label.startswith("xn--") and msg["From"].addresses[0].addr_spec == f"billing@{a_label}"
    assert msg["Reply-To"].addresses[0].addr_spec == f"ar@{a_label}" and not msg["Reply-To"].defects
    assert msg["Cc"].addresses[0].addr_spec == f"accounts@{a_label}" and msg["Cc"].addresses[0].display_name == "Accounts"
    assert f"smtp.mailfrom={a_label};" in msg["Authentication-Results"]
    assert msg["Message-ID"].endswith(f"@{a_label}>")
    assert rows(out)[1]["email"]["from_addr"] == f"billing@{cyrillic}"  # the jsonl keeps what was sent
    assert (out / "DATACARD.md").exists()


def test_a_non_ascii_local_part_is_written_as_an_smtputf8_message(out):
    a = log(email={"from_name": "Pete", "from_addr": "pété@gmail.com", "subject": "Hi", "body": "pay"})
    export.export(out)
    raw = (out / "emails" / f"{a.attempt_id}.eml").read_bytes()
    assert "From: Pete <pété@gmail.com>\r\n".encode() in raw and b"\n" not in raw.replace(b"\r\n", b"")
    # RFC 6532: the stdlib reads raw UTF-8 headers when given text; from bytes it keeps them as surrogate escapes.
    assert Parser(policy=policy.default).parsestr(raw.decode())["From"].addresses[0].username == "pété"
    username = parse(out / "emails" / f"{a.attempt_id}.eml")["From"].addresses[0].username
    assert username.encode("utf-8", "surrogateescape").decode() == "pété"


@pytest.mark.parametrize("from_addr", [
    "billing@petesfl0ur.com; dkim=pass header.d=petesflour.com",  # a typed domain writing its own AR clauses
    "a@evil.com, ceo@sunnydiner.example",                         # a second From mailbox
])
def test_typed_address_text_cant_write_authentication_results_or_add_mailboxes(out, from_addr):
    mail = invoice_email("lookalike_domain") | {"from_addr": from_addr}
    a = log(email=mail)
    export.export(out)
    msg = parse(out / "emails" / f"{a.attempt_id}.eml")
    assert msg["Authentication-Results"] == (
        "mx.sunnydiner.example; spf=pass smtp.mailfrom=unknown.invalid; dkim=pass header.d=unknown.invalid; "
        "dmarc=pass header.from=unknown.invalid")
    assert [(m.display_name, m.addr_spec) for m in msg["From"].addresses] == [
        ("Pancake Pete's Flour Co. Billing", "invalid@unknown.invalid")]
    assert rows(out)[0]["email"]["from_addr"] == from_addr


def test_a_typed_domain_through_realize_email_cant_forge_a_pass_for_the_vendor(out):
    a = log(email=invoice_email("lookalike_domain", domain="petesfl0ur.com; dkim=pass header.d=petesflour.com"))
    export.export(out)
    results = parse(out / "emails" / f"{a.attempt_id}.eml")["Authentication-Results"]
    assert "petesflour.com" not in results and results.count(";") == 3


def test_long_display_names_and_local_parts_keep_header_lines_within_998(out):
    a = log(email=invoice_email(from_name="A" * 1200, reply_to=f"{'R' * 1200} <ar@petesflour.com>",
                                cc=[f"{'C' * 1200} <cc@petesflour.com>"]))
    b = log(email={"from_name": "Pete", "from_addr": "x" * 1000 + "@gmail.com", "subject": "Hi", "body": "pay"})
    export.export(out)
    for attempt in (a, b):
        assert max(map(len, (out / "emails" / f"{attempt.attempt_id}.eml").read_bytes().split(b"\r\n"))) <= 998
    msg = parse(out / "emails" / f"{a.attempt_id}.eml")
    assert msg["From"].addresses[0].display_name == "A" * export.NAME_LIMIT
    assert msg["Reply-To"].addresses[0].display_name == "R" * export.NAME_LIMIT
    assert msg["Cc"].addresses[0].addr_spec == "cc@petesflour.com"
    assert parse(out / "emails" / f"{b.attempt_id}.eml")["From"].addresses[0].addr_spec == "invalid@unknown.invalid"
    assert rows(out)[0]["email"]["from_name"] == "A" * 1200


@pytest.mark.parametrize("age, header", [("", None), ("12.5", "12"), ("old", None), (float("nan"), None), (30, "30")])
def test_a_malformed_domain_age_is_left_out_not_fatal(out, age, header):
    a = log(email=invoice_email() | {"sender_domain_age_days": age})
    export.export(out)
    assert parse(out / "emails" / f"{a.attempt_id}.eml")["X-Forged-Sender-Domain-Age-Days"] == header


def test_a_row_that_cant_be_built_is_skipped_and_counted(out, monkeypatch):
    good, bad = log(invoice_no="PP-1", email=invoice_email()), log(invoice_no="PP-2", email=invoice_email())
    real_to_eml, real_to_ubl = export.to_eml, export.to_ubl

    def to_eml(mail, attempt_id, *args, **kwargs):
        if attempt_id == bad.attempt_id:
            raise ValueError("odd row")
        return real_to_eml(mail, attempt_id, *args, **kwargs)

    monkeypatch.setattr(export, "to_eml", to_eml)
    monkeypatch.setattr(export, "to_ubl", lambda r: real_to_ubl(r) if r["invoice_no"] == "PP-1" else 1 / 0)
    summary = export.export(out)
    assert (summary["emails"], summary["invoices"], summary["skipped"]) == (1, 1, 2)
    assert sorted(p.stem for p in (out / "emails").iterdir()) == [good.attempt_id]
    assert "| Files skipped (could not be built) | 2 |" in (out / "DATACARD.md").read_text()
    assert len(rows(out)) == 2


def test_re_exporting_replaces_the_previous_files(out):
    first, second = log(invoice_no="PP-1", email=invoice_email()), log(invoice_no="PP-2", email=invoice_email())
    export.export(out)
    (out / "README.txt").write_text("not ours")
    summary = export.export(out, attempts=[second])
    assert sorted(p.stem for p in (out / "emails").iterdir()) == [second.attempt_id]
    assert sorted(p.stem for p in (out / "invoices").iterdir()) == [second.attempt_id]
    assert (summary["emails"], summary["invoices"]) == (1, 1) and [r["attempt_id"] for r in rows(out)] == [
        second.attempt_id]
    assert first.attempt_id not in "".join(p.read_text(errors="replace") for p in out.rglob("*") if p.is_file())
    assert (out / "README.txt").read_text() == "not ours"  # only the export's own entries are replaced


def test_a_failed_export_leaves_the_previous_one_whole(out, monkeypatch):
    first = log(invoice_no="PP-1", email=invoice_email())
    export.export(out)
    before = {p.relative_to(out): p.read_bytes() for p in out.rglob("*") if p.is_file()}
    log(invoice_no="PP-2", email=invoice_email())
    monkeypatch.setattr(export, "datacard", lambda *a: 1 / 0)
    with pytest.raises(ZeroDivisionError):
        export.export(out)
    assert {p.relative_to(out): p.read_bytes() for p in out.rglob("*") if p.is_file()} == before
    assert [r["attempt_id"] for r in rows(out)] == [first.attempt_id]
    assert not [p for p in out.parent.iterdir() if p.name.startswith(".out.")]  # no temp folder left behind


def test_the_model_folder_is_refused_as_out(model_dir):
    log()
    log(consent=False)
    logged = (model_dir / "attempts.jsonl").read_bytes()
    for out_dir in (model_dir, model_dir / "sub" / "..", str(model_dir) + "/"):
        with pytest.raises(ValueError, match="model folder"):
            export.export(out_dir)
    assert (model_dir / "attempts.jsonl").read_bytes() == logged


def test_a_torn_last_line_in_the_live_log_is_skipped_and_counted(model_dir, out):
    kept = [log(invoice_no="PP-1"), log(invoice_no="PP-2")]
    with (model_dir / "attempts.jsonl").open("a") as f:
        f.write(kept[0].model_dump_json()[:120])  # the server was mid-write
    summary = export.export(out)
    assert (summary["rows"], summary["exported"], summary["unreadable"]) == (2, 2, 1)
    assert "| Log lines that could not be read (e.g. cut off mid-write) | 1 |" in (out / "DATACARD.md").read_text()
