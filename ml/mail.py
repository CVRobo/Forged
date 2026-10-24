"""The email channel (docs/realistic-data-plan.md section 2).

The player types the parts of an email a real attacker controls (display name, the
local part of the address, Reply-To, CC, thread, subject, body). realize_email() fills
in what the receiving mail server would see, from how the sender got its address:

    identity             From address              SPF/DKIM/DMARC   domain age     first contact
    vendor_mailbox       the vendor's own          pass             years          no
    compromised_mailbox  the vendor's own          pass             years          no   (the hard case)
    spoofed_domain       the vendor's own          fail             years          no
    lookalike_domain     1-2 edits off the vendor  pass             1-30 days      yes  (aged_domain: 200-2000)
    new_domain           the sender's own new one  pass             1-60 days      yes  (aged_domain: 200-2000)
    free_mail            gmail/outlook/yahoo       pass             decades        yes

sender_email() is the same rule for any sender, so the generator's legit vendors and
scripted attackers write through it too. The generator passes first_time from the
run's own mail history; realize_email() has no history and goes by the identity.
"""
import hashlib
import random
import re
from datetime import datetime

from ml.schema import EmailMessage, SenderIdentity
from ml.world import FREE_MAIL_DOMAINS, VENDOR_SPECS, VENDORS, VendorSpec, lookalike_domain, slug

DIRECTORY_VENDORS = tuple(v.vendor_id for v in VENDORS)  # the realistic mode shows the model's whole world
LAST_THREAD_AT = datetime(2026, 9, 30, 10, 15)
OWN_ADDRESS = ("vendor_mailbox", "compromised_mailbox", "spoofed_domain")  # write from the vendor's real domain
NEW_ADDRESS = ("lookalike_domain", "new_domain", "free_mail")              # first contact unless seen before


def realize_email(identity: SenderIdentity, vendor_id: str, *, from_name: str, subject: str, body: str,
                  sent_at: datetime, local_part: str = "billing", domain: str | None = None,
                  reply_to: str | None = None, cc=(), thread_id: str | None = None, in_reply_to: str | None = None,
                  aged_domain: bool = False, message_id: str | None = None) -> EmailMessage:
    """domain: the attacker's own lookalike domain, if they typed one (otherwise one is made up)."""
    spec = VENDOR_SPECS[vendor_id]
    rng = random.Random(f"{vendor_id}:{identity}:{subject}:{sent_at.isoformat()}")
    if identity in OWN_ADDRESS:
        domain = None  # the vendor's own domain is the point of these three
    elif identity == "free_mail" and domain not in FREE_MAIL_DOMAINS:
        domain = "gmail.com"
    return sender_email(rng, identity, real_domain=spec.domain, real_age=spec.domain_age_days, from_name=from_name,
                        subject=subject, body=body, sent_at=sent_at, local_part=local_part, domain=domain,
                        reply_to=reply_to, cc=cc, thread_id=thread_id, in_reply_to=in_reply_to,
                        aged_domain=aged_domain, message_id=message_id, free_mail_name=spec.name)


def sender_email(rng: random.Random, identity: SenderIdentity, *, real_domain: str, real_age: int, from_name: str,
                 subject: str, body: str, sent_at: datetime, local_part: str = "billing", domain: str | None = None,
                 reply_to: str | None = None, cc=(), thread_id: str | None = None, in_reply_to: str | None = None,
                 aged_domain: bool = False, message_id: str | None = None, first_time: bool | None = None,
                 auth: tuple[str, str, str] | None = None, free_mail_name: str = "") -> EmailMessage:
    """The world's view of one email. real_domain and real_age: the domain the sender is (or claims to be).
    domain: the host to send from, when the sender picked one. auth: (spf, dkim, dmarc), when not by identity."""
    local = re.sub(r"[^a-z0-9._-]", "", local_part.lower()) or "billing"
    if identity in OWN_ADDRESS:
        host, age = domain or real_domain, real_age
    elif identity in ("lookalike_domain", "new_domain"):
        host = domain or (lookalike_domain(rng, real_domain) if identity == "lookalike_domain" else real_domain)
        age = rng.randint(200, 2000) if aged_domain else rng.randint(1, 30 if identity == "lookalike_domain" else 60)
    else:
        host = domain if domain in FREE_MAIL_DOMAINS else rng.choice(FREE_MAIL_DOMAINS)
        age = rng.randint(9000, 11000)
        local = f"{slug(free_mail_name or from_name)[:12]}.{local}"
    spf, dkim, dmarc = auth or (("fail", "none", "fail") if identity == "spoofed_domain" else ("pass", "pass", "pass"))
    return EmailMessage(
        message_id=message_id or f"<{_hash(identity, host, subject, sent_at)}@{host}>",
        thread_id=thread_id, in_reply_to=in_reply_to, from_name=from_name, from_addr=f"{local}@{host}",
        reply_to=reply_to, cc=list(cc), subject=subject, body=body, sent_at=sent_at, sender_identity=identity,
        spf=spf, dkim=dkim, dmarc=dmarc, sender_domain_age_days=age,
        first_time_sender=identity in NEW_ADDRESS if first_time is None else first_time,
    )


def vendor_thread(spec: VendorSpec) -> tuple[str, str]:
    """The vendor's running billing thread: (thread_id, message_id of its last message)."""
    return f"<thread-{spec.vendor_id}@{spec.domain}>", f"<{spec.vendor_id}-last@{spec.domain}>"


def vendor_directory(level: int = 1) -> list[dict]:
    """What the AP desk knows about each vendor, as the realistic mode's case file shows it."""
    out = []
    for spec in (VENDOR_SPECS[v] for v in DIRECTORY_VENDORS):
        thread_id, message_id = vendor_thread(spec)
        out.append({
            "vendor_id": spec.vendor_id, "name": spec.name, "domain": spec.domain, "phone": spec.phone,
            "bank_last4": spec.bank[-4:], "uses_po": spec.uses_po, "cadence_days": spec.cadence_days,
            "last_thread": {
                "thread_id": thread_id, "message_id": message_id,
                "subject": f"Invoice {''.join(w[0] for w in spec.name.split()[:2]).upper()}-0193",
                "from_name": f"{spec.name} Billing", "from_addr": f"billing@{spec.domain}",
                "sent_at": LAST_THREAD_AT.isoformat(),
            },
        })
    return out


def _hash(*parts) -> str:
    return hashlib.sha256(":".join(map(str, parts)).encode()).hexdigest()[:16]
