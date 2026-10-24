"""The email channel (docs/realistic-data-plan.md section 2).

The player types the parts of an email a real attacker controls (display name, the
local part of the address, Reply-To, CC, thread, subject, body). realize_email() fills
in what the receiving mail server would see, from how the sender got its address:

    identity             From address              SPF/DKIM/DMARC   domain age     first contact
    vendor_mailbox       the vendor's own          pass             years          no
    compromised_mailbox  the vendor's own          pass             years          no   (the hard case)
    spoofed_domain       the vendor's own          fail             years          no
    lookalike_domain     1-2 edits off the vendor  pass             1-30 days      yes  (aged_domain: 200-2000)
    free_mail            gmail/outlook/yahoo       pass             decades        yes
"""
import hashlib
import random
import re
from datetime import datetime

from ml.schema import EmailMessage, SenderIdentity
from ml.world import FREE_MAIL_DOMAINS, VENDOR_SPECS, VENDORS, lookalike_domain, slug

DIRECTORY_VENDORS = tuple(v.vendor_id for v in VENDORS)  # the realistic mode shows the model's whole world
LAST_THREAD_AT = datetime(2026, 9, 30, 10, 15)


def realize_email(identity: SenderIdentity, vendor_id: str, *, from_name: str, subject: str, body: str,
                  sent_at: datetime, local_part: str = "billing", domain: str | None = None,
                  reply_to: str | None = None, cc=(), thread_id: str | None = None, in_reply_to: str | None = None,
                  aged_domain: bool = False, message_id: str | None = None) -> EmailMessage:
    """domain: the attacker's own lookalike domain, if they typed one (otherwise one is made up)."""
    spec = VENDOR_SPECS[vendor_id]
    rng = random.Random(f"{vendor_id}:{identity}:{subject}:{sent_at.isoformat()}")
    local = re.sub(r"[^a-z0-9._-]", "", local_part.lower()) or "billing"
    if identity in ("vendor_mailbox", "compromised_mailbox", "spoofed_domain"):
        host, age = spec.domain, spec.domain_age_days
    elif identity == "lookalike_domain":
        host = domain or lookalike_domain(rng, spec.domain)
        age = rng.randint(200, 2000) if aged_domain else rng.randint(1, 30)
    else:
        host, age = rng.choice(FREE_MAIL_DOMAINS), rng.randint(9000, 11000)
        local = f"{slug(spec.name)[:12]}.{local}"
    auth = "fail" if identity == "spoofed_domain" else "pass"
    return EmailMessage(
        message_id=message_id or f"<{_hash(identity, vendor_id, subject, sent_at)}@{host}>",
        thread_id=thread_id, in_reply_to=in_reply_to, from_name=from_name, from_addr=f"{local}@{host}",
        reply_to=reply_to, cc=list(cc), subject=subject, body=body, sent_at=sent_at, sender_identity=identity,
        spf=auth, dkim="none" if identity == "spoofed_domain" else "pass", dmarc=auth, sender_domain_age_days=age,
        first_time_sender=identity in ("lookalike_domain", "free_mail"),
    )


def vendor_directory(level: int = 1) -> list[dict]:
    """What the AP desk knows about each vendor, as the realistic mode's case file shows it."""
    return [{
        "vendor_id": spec.vendor_id, "name": spec.name, "domain": spec.domain, "phone": spec.phone,
        "bank_last4": spec.bank[-4:], "uses_po": spec.uses_po, "cadence_days": spec.cadence_days,
        "last_thread": {
            "thread_id": f"<thread-{spec.vendor_id}@{spec.domain}>",
            "message_id": f"<{spec.vendor_id}-last@{spec.domain}>",
            "subject": f"Invoice {''.join(w[0] for w in spec.name.split()[:2]).upper()}-0193",
            "from_name": f"{spec.name} Billing", "from_addr": f"billing@{spec.domain}",
            "sent_at": LAST_THREAD_AT.isoformat(),
        },
    } for spec in (VENDOR_SPECS[v] for v in DIRECTORY_VENDORS)]


def _hash(*parts) -> str:
    return hashlib.sha256(":".join(map(str, parts)).encode()).hexdigest()[:16]
