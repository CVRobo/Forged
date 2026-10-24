"""The game's InvoiceRecord becomes the model's Invoice and case file.

The record (prototype record(), server/models/schemas.py InvoiceRecord) carries the
player's finished paper: flags computed in the browser, line items as
"desc ×qty @ price" strings, a "Fri, Oct 14" date. compute_features needs the raw
state plus a case file, so this rebuilds both. Where the record lacks something,
the assumption is marked "until the server sends it".
"""
import re
from datetime import date, datetime, time, timedelta

from ml.schema import CaseFile, Invoice, LineItem, OpenOrder, Stamp, ToolUse
from ml.world import APPROVAL_LIMIT, LEVEL_ID, STAMP_KINDS, VENDORS, VendorSpec, business_day, slug, vendor_profile

SCHEME_IDS = {  # the prototype's scheme names
    "changed_bank": "bank_switcheroo", "duplicate": "duplicate_dance", "phantom": "phantom_supplier",
    "boss_request": "boss_request", "padded": "padded_invoice",
}
LEVEL_IDS = {1: "sunny_diner", 2: "st_mercy", 3: "port_nocturne", 4: "neon_arcade"}
PEN_FIELDS = {"domain", "letterhead"}  # burner-pen edits show up as domain and letterhead features instead
LINE = re.compile(r"^(?P<desc>.*?)\s*[×x]\s*(?P<qty>[\d.]+)\s*@\s*\$?(?P<price>[\d,.]+)\s*$")
MONTHS = {m: i for i, m in enumerate(("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"), 1)}
YEAR = 2026


def get(record, name: str, default=None):
    """Read a field from a dict or from the server's pydantic object."""
    return record.get(name, default) if isinstance(record, dict) else getattr(record, name, default)


def scheme_id(record) -> str | None:
    return SCHEME_IDS.get(get(record, "scheme"), get(record, "scheme"))


def to_invoice(record) -> Invoice:
    spec = vendor_spec(get(record, "vendor", ""))
    items = _lines(get(record, "line_items", []))
    amount = float(get(record, "amount", 0) or 0)
    if not items:
        items = [LineItem(description="Services", quantity=1, unit_price=amount)]
    elif abs(sum(li.quantity * li.unit_price for li in items) - amount) > 0.01:  # a whited-out total
        items.append(LineItem(description="Adjustment", quantity=1,
                              unit_price=round(amount - sum(li.quantity * li.unit_price for li in items), 2)))
    issue = _date(get(record, "date", ""))
    name = get(record, "vendor", "")
    return Invoice(
        invoice_id=get(record, "invoice_no", "") or "unnumbered", vendor_name=name,
        vendor_id=spec.vendor_id if spec else None, line_items=items, issue_date=issue,
        due_date=issue + timedelta(days=spec.terms_days if spec else 30),  # until the server sends a due date
        order_number=get(record, "po_number") or None,
        bank_account=re.sub(r"\D", "", get(record, "bank_account", "")) or "0000",
        sender_domain=get(record, "sender_domain", ""),
        letterhead_id=(spec.letterhead_id if get(record, "letterhead_match", True) else "lh_generic") if spec
        else f"lh_{slug(name)[:10]}",
        stamps=[Stamp(kind=k, x=0.5, y=0.5) for k in get(record, "stamp_type", []) if k in STAMP_KINDS],
        tool_uses=_tool_uses(record), cover_email=get(record, "cover_email", "") or "",
        sent_at=datetime.combine(issue, time(22 if get(record, "after_hours", False) else 10, 0)),
    )


def serving_case_file(invoice: Invoice, paid: list[Invoice] = ()) -> CaseFile:
    """The case file as the model knows it. Until the server sends open orders and paid
    invoices: the player starts from the vendor's real invoice, so its PO is open for the
    vendor's usual amount, and each vendor's last two usual invoices were paid on cadence."""
    orders, history = [], []
    for spec in VENDORS:
        base = base_lines(spec)
        if spec.vendor_id == invoice.vendor_id and spec.uses_po and invoice.order_number:
            orders.append(OpenOrder(order_number=invoice.order_number, vendor_id=spec.vendor_id,
                                    amount=round(sum(li.quantity * li.unit_price for li in base), 2)))
        for back in (2, 1):
            issued = business_day(invoice.issue_date - timedelta(days=back * spec.cadence_days))
            history.append(Invoice(
                invoice_id=f"{spec.vendor_id}-paid-{back}", vendor_name=spec.name, vendor_id=spec.vendor_id,
                line_items=base, issue_date=issued, due_date=issued + timedelta(days=spec.terms_days),
                order_number=None, bank_account=spec.bank, sender_domain=spec.domain,
                letterhead_id=spec.letterhead_id))
    return CaseFile(level_id=LEVEL_ID, approval_limit=APPROVAL_LIMIT,
                    vendors=[vendor_profile(s, first_seen_round=-40) for s in VENDORS],
                    open_orders=orders, paid_invoices=history + list(paid))


def vendor_spec(name: str) -> VendorSpec | None:
    return next((v for v in VENDORS if v.name.lower() == name.strip().lower()), None)


def base_lines(spec: VendorSpec) -> list[LineItem]:
    """The vendor's usual order: middle quantities, optional lines included once (the game's starting invoice)."""
    return [LineItem(description=l.description, quantity=max(1, round((l.min_qty + l.max_qty) / 2)), unit_price=l.unit_price)
            for l in spec.lines]


def _lines(raw: list[str]) -> list[LineItem]:
    items = []
    for text in raw:
        m = LINE.match(str(text))
        if m:
            items.append(LineItem(description=m["desc"], quantity=float(m["qty"]), unit_price=float(m["price"].replace(",", ""))))
    return items


def _date(text: str) -> date:
    """The prototype prints a random "Fri, Oct N", and some of those days fall on a weekend.
    Weekend dates move to the Monday, so they don't read as sent after hours."""
    m = re.search(r"([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})", text or "")
    if m and m[1].lower() in MONTHS:
        return business_day(date(YEAR, MONTHS[m[1].lower()], int(m[2])))
    try:
        return business_day(date.fromisoformat(text))
    except (TypeError, ValueError):
        return business_day(date.today())


def _tool_uses(record) -> list[ToolUse]:
    uses = []
    for name in get(record, "field_altered", []):
        if name == "bank":
            uses.append(ToolUse(tool="tape", target="bank"))  # scissors and tape
        elif name not in PEN_FIELDS:
            uses.append(ToolUse(tool="whiteout", target=name))
    for region, legible in (get(record, "legibility", {}) or {}).items():
        if legible < 1:
            uses.append(ToolUse(tool="mug", target=region, params={"strength": round(1 - legible, 4)}))
    uses += [ToolUse(tool="photocopier")] * int(get(record, "copy_generation", 0) or 0)
    return uses
