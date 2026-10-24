"""Ground truth: is_fraud comes only from these checks, never from the player or the features.

Each check also reads the Truth (the mule accounts and the real order amounts), which
the model never sees. That is what lets every payload feature show up on legit
invoices too (spec 2.1): a real vendor can change banks, a real change order can push
an invoice past its PO, and a real subscription bills the same amount every month.
"""
from ml.features import find_vendor, open_order
from ml.schema import CaseFile, Invoice
from ml.world import Truth

SCHEMES = ("bank_switcheroo", "duplicate_dance", "boss_request", "phantom_supplier", "padded_invoice")
PAD_LIMIT = 1.15          # Padded Invoice: total over 115% of the real order
REBILL_AMOUNT_TOL = 0.02  # Duplicate Dance: within 2% of a paid invoice's amount, and dated within
                          # half the vendor's cadence of it, so it bills a period already paid


def payload_schemes(invoice: Invoice, case_file: CaseFile, truth: Truth) -> set[str]:
    vendor = find_vendor(invoice, case_file)
    to_mule = invoice.bank_account in truth.attacker_accounts
    order = open_order(invoice, case_file)
    hits = set()
    if vendor is None:
        if to_mule:
            hits.add("phantom_supplier")  # vendor not on the approved list
            if order is None:
                hits.add("boss_request")  # payee not approved and no open order
        return hits
    if to_mule:
        hits.add("bank_switcheroo")
    if order and round(invoice.amount, 2) > round(PAD_LIMIT * truth.order_amounts.get(order.order_number, order.amount), 2):
        hits.add("padded_invoice")
    if any(_rebills(invoice, paid, vendor.cadence_days) for paid in case_file.paid_invoices):
        hits.add("duplicate_dance")
    return hits


def is_fraud(invoice: Invoice, case_file: CaseFile, truth: Truth) -> bool:
    return bool(payload_schemes(invoice, case_file, truth))


def _rebills(inv: Invoice, paid: Invoice, cadence_days: int) -> bool:
    return (paid.vendor_id == inv.vendor_id
            and abs(inv.amount - paid.amount) <= REBILL_AMOUNT_TOL * paid.amount
            and abs((inv.issue_date - paid.issue_date).days) < cadence_days / 2)
