"""The Sunny Diner level as the generators see it.

Static content (the prototype's three level-1 vendors plus three more), the name
and line-item pools shared by legit and fraud invoices, the hidden Truth that the
payload checks read, and small helpers for dates, accounts and lookalike identities.
"""
import random
import re
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta

from ml.features import edit_distance
from ml.schema import CaseFile, LineItem, Stamp, VendorProfile

LEVEL_ID = "sunny_diner"
APPROVAL_LIMIT = 2500.0
ATTACKER_ACCOUNTS = ("7781", "0420", "1337")  # the player's mule accounts (same as the prototype)
REGIONS = ("header", "meta", "items", "bank", "footer")  # the prototype's stainable regions
STAMP_KINDS = ("PAID", "APPROVED", "URGENT", "RECEIVED")


@dataclass(frozen=True)
class CatalogLine:
    description: str
    unit_price: float
    min_qty: int  # 0 means the line is optional
    max_qty: int


@dataclass(frozen=True)
class VendorSpec:
    vendor_id: str
    name: str
    domain: str
    bank: str
    lines: tuple[CatalogLine, ...]
    cadence_days: int
    uses_po: bool
    terms_days: int = 30
    usual_stamps: tuple[str, ...] = ()
    phone: str = ""              # the number on file, for callbacks
    domain_age_days: int = 3000  # how long the vendor has owned its domain

    @property
    def letterhead_id(self) -> str:
        return f"lh_{self.vendor_id}"

    @property
    def fixed(self) -> bool:  # bills exactly the same lines every time (a subscription)
        return all(l.min_qty == l.max_qty for l in self.lines)

    def amount_stats(self) -> tuple[float, float]:
        """Mean and std of the invoice total when quantities are drawn uniformly."""
        mean = sum(l.unit_price * (l.min_qty + l.max_qty) / 2 for l in self.lines)
        var = sum(l.unit_price ** 2 * ((l.max_qty - l.min_qty + 1) ** 2 - 1) / 12 for l in self.lines)
        return mean, var ** 0.5


VENDORS = (
    VendorSpec("petes", "Pancake Pete's Flour Co.", "petesflour.com", "3321", (
        CatalogLine("Flour, 50lb sack", 62, 8, 16), CatalogLine("Pancake mix, bulk", 95, 2, 6),
        CatalogLine("Delivery", 76, 1, 1),
    ), cadence_days=14, uses_po=True, usual_stamps=("RECEIVED",), phone="(510) 555-0142", domain_age_days=4800),
    VendorSpec("bubbles", "Bubbles Dish Soap Ltd.", "bubblessoap.co", "9902", (
        CatalogLine("Dish soap, 5gal", 48, 4, 8), CatalogLine("Sponges (100)", 39, 1, 3),
        CatalogLine("Rubber gloves", 11, 6, 14),
    ), cadence_days=7, uses_po=True, terms_days=15, phone="(510) 555-0177", domain_age_days=2600),
    VendorSpec("dread", "Existential Dread Consulting LLC", "dreadconsulting.com", "1111", (
        CatalogLine("Menu font audit", 900, 1, 1), CatalogLine("Vibes assessment", 700, 0, 1),
        CatalogLine("Travel", 400, 0, 1),
    ), cadence_days=30, uses_po=True, phone="(415) 555-0108", domain_age_days=1900),
    VendorSpec("lettuce", "Crunchy Lettuce Farms", "crunchylettuce.farm", "4471", (
        CatalogLine("Romaine, case", 34, 6, 14), CatalogLine("Tomatoes, case", 41, 4, 10),
        CatalogLine("Onions, 50lb", 28, 1, 3), CatalogLine("Delivery", 35, 1, 1),
    ), cadence_days=7, uses_po=True, terms_days=15, usual_stamps=("RECEIVED",), phone="(707) 555-0123", domain_age_days=5200),
    VendorSpec("sparky", "Sparky's Electric Co.", "sparkyelectric.com", "6060", (
        CatalogLine("Electricity (kWh)", 0.31, 1800, 2600),
    ), cadence_days=30, uses_po=False, terms_days=14, phone="(510) 555-0160", domain_age_days=7300),
    VendorSpec("mop", "Mop Masters Cleaning", "mopmasters.com", "7123", (
        CatalogLine("Monthly cleaning service", 400, 1, 1),
    ), cadence_days=30, uses_po=False, phone="(510) 555-0191", domain_age_days=1400),
)
VENDOR_SPECS = {v.vendor_id: v for v in VENDORS}

# Vendors not on the approved list: real ones being onboarded and phantom suppliers
# draw from the same pools, so a silly name or a one-off repair never means fraud.
NEW_VENDOR_NAMES = (
    "Gary's Totally Real Plumbing", "Synergy Synergy Inc.", "Bob's Industrial Spoons", "Quantum Napkin Partners",
    "Dave's Discount Anvils", "Hot Plate Heroes", "Griddle Guild Supply", "Syrup Sisters Co.",
    "Fresh Fork Rentals", "Waffle Iron Works", "Bluebird Linen Service", "Main Street Pest Control",
    "Chrome Stool Repair", "Neon Sign Doctors", "Pie Tin Depot", "Tidy Grease Trap Co.",
)
AD_HOC_LINES = (  # (description, min price, max price); one-off purchases, quantity 1
    ("Equipment repair", 180, 900), ("Grease trap cleaning", 220, 480), ("Pest control visit", 120, 260),
    ("Booth upholstery", 300, 1400), ("Neon sign repair", 250, 950), ("Linen rental", 90, 300),
    ("Griddle replacement part", 140, 600), ("Installation labor", 150, 700), ("Service call", 85, 160),
    ("Parts and materials", 60, 500), ("Equipment deposit", 300, 1500),
)
BOSS_NAMES = ("Office of the Owner", "Big Lou Executive Office", "Sunny Diner HQ", "Lou's Holding Co.")
BOSS_DOMAINS = ("owner-office.net", "sunnydiner-hq.com", "sunnydinner.com", "biglou.biz")
BOSS_LINES = ("Urgent confidential payment", "Owner discretionary expense", "Equipment deposit", "Supplier prepayment")
BILLING_DOMAINS = ("quickinvoice.com", "billtrail.io", "invoicely.co")  # services real vendors send bills through
BRANCHES = ("East", "Oakland", "Downtown", "Wholesale")  # new branches of approved vendors, onboarded separately
FREE_MAIL_DOMAINS = ("gmail.com", "outlook.com", "yahoo.com")
TLDS = (".com", ".co", ".biz", ".net")


@dataclass
class Truth:
    """What the game knows and the model never sees. Only the payload checks read it."""
    attacker_accounts: frozenset[str] = frozenset(ATTACKER_ACCOUNTS)
    order_amounts: dict[str, float] = field(default_factory=dict)  # real order amounts, after change orders


def vendor_profile(spec: VendorSpec, first_seen_round: int) -> VendorProfile:
    mean, std = spec.amount_stats()
    return VendorProfile(
        vendor_id=spec.vendor_id, name=spec.name, bank_account=spec.bank, sender_domain=spec.domain,
        letterhead_id=spec.letterhead_id, amount_mean=round(mean, 2), amount_std=round(std, 2),
        cadence_days=spec.cadence_days, first_seen_round=first_seen_round,
        catalog={l.description: l.unit_price for l in spec.lines}, usual_stamps=list(spec.usual_stamps),
        phone=spec.phone,
    )


def new_case_file(rng: random.Random) -> CaseFile:
    vendors = [vendor_profile(spec, first_seen_round=-rng.randint(10, 80)) for spec in VENDORS]
    return CaseFile(level_id=LEVEL_ID, approval_limit=APPROVAL_LIMIT, vendors=vendors, open_orders=[], paid_invoices=[])


# ---------- line items ----------

def catalog_lines(rng: random.Random, spec: VendorSpec, scale: float = 1.0) -> list[LineItem]:
    """A normal order from this vendor; scale multiplies the variable quantities."""
    items = []
    for line in spec.lines:
        qty = rng.randint(line.min_qty, line.max_qty)
        if qty and line.min_qty != line.max_qty:
            qty = max(1, round(qty * scale))
        if qty:
            items.append(LineItem(description=line.description, quantity=qty, unit_price=line.unit_price))
    return items


def ad_hoc_lines(rng: random.Random, n: int | None = None) -> list[LineItem]:
    picks = rng.sample(AD_HOC_LINES, n or rng.choice((1, 1, 2, 3)))
    return [LineItem(description=d, quantity=1, unit_price=_price(rng, lo, hi)) for d, lo, hi in picks]


def _price(rng: random.Random, lo: float, hi: float) -> float:
    p = rng.uniform(lo, hi)
    return float(round(p / 25) * 25) if rng.random() < 0.5 else round(p, 2)


def set_total(items: list[LineItem], target: float) -> list[LineItem]:
    """Change the priciest line's unit price so the invoice totals exactly target."""
    items = [li.model_copy() for li in items]
    top = max(items, key=lambda li: li.quantity * li.unit_price)
    rest = sum(li.quantity * li.unit_price for li in items if li is not top)
    top.unit_price = max(target - rest, 1.0) / top.quantity
    return items


def scale_lines(items: list[LineItem], factor: float) -> list[LineItem]:
    return [li.model_copy(update={"quantity": max(1, round(li.quantity * factor))}) for li in items]


def order_amount_for(rng: random.Random, total: float) -> float:
    """A normal open order: the invoice lands within about 7% of it."""
    return round(total / rng.uniform(0.93, 1.07), 2)


# ---------- dates, stamps, accounts, identities ----------

def business_day(d: date) -> date:
    return d + timedelta(days=7 - d.weekday()) if d.weekday() >= 5 else d


def sent_time(rng: random.Random, d: date, offhours: bool) -> datetime:
    hour = rng.choice((6, 7, 8, 18, 19, 20, 21, 22, 23)) if offhours else rng.randint(9, 16)
    return datetime.combine(d, time(hour, rng.randint(0, 59)))


def stamps_for(rng: random.Random, mode: str, usual: tuple[str, ...]) -> list[Stamp]:
    """none, habit (the vendor's usual stamp, if it has one) or random."""
    kinds = {"none": [], "habit": list(usual[:1]), "random": [rng.choice(STAMP_KINDS)]}[mode]
    return [Stamp(kind=k, x=round(rng.uniform(0.1, 0.9), 2), y=round(rng.uniform(0.1, 0.9), 2)) for k in kinds]


def weighted(rng: random.Random, weights: dict):
    return rng.choices(list(weights), weights=list(weights.values()))[0]


def new_account(rng: random.Random, taken=()) -> str:
    while True:
        account = str(rng.randint(1000, 9999))
        if account not in ATTACKER_ACCOUNTS and account not in taken:
            return account


def slug(name: str) -> str:
    return re.sub(r"[^a-z]", "", name.lower())


def domain_for(rng: random.Random, name: str) -> str:
    return slug(name)[:14] + rng.choice(TLDS)


LOOKALIKE_CHARS = {"o": "0", "l": "1", "i": "1", "e": "3", "s": "5", "a": "4"}


def lookalike_domain(rng: random.Random, domain: str) -> str:
    """A spoof one or two edits away: a look-alike character, a doubled or dropped letter, a shorter TLD."""
    for _ in range(100):
        name, _, tld = domain.partition(".")
        for _ in range(rng.choice((1, 1, 2))):
            name, tld = _spoof_edit(rng, name, tld)
        spoof = f"{name}.{tld}"
        if 1 <= edit_distance(spoof, domain) <= 2:
            return spoof
    raise ValueError(f"could not spoof {domain}")


def _spoof_edit(rng: random.Random, name: str, tld: str) -> tuple[str, str]:
    i = rng.randrange(len(name))
    op = rng.choice(("char", "double", "drop", "tld"))
    if op == "char" and name[i] in LOOKALIKE_CHARS:
        return name[:i] + LOOKALIKE_CHARS[name[i]] + name[i + 1:], tld
    if op == "drop" and len(name) > 5:
        return name[:i] + name[i + 1:], tld
    if op == "tld" and tld == "com":
        return name, "co"
    return name[:i] + name[i] + name[i:], tld  # doubled letter


def lookalike_name(rng: random.Random, name: str) -> str:
    suffix = re.sub(r"\s+(Co\.|Ltd\.|LLC|Inc\.)$", " " + rng.choice(("Company", "Inc.", "LLC", "Ltd.")), name)
    i = rng.randrange(1, len(name) - 1)
    variants = {name.replace("'", ""), suffix, name.rstrip("."), name[:i] + name[i] + name[i:]}
    variants.discard(name)
    return rng.choice(sorted(variants))
