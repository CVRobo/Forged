"""Small Sunny Diner world for tests: three vendors, two open orders, one paid invoice.

Pancake Pete's clean invoice is 12 x 62 + 4 x 95 + 1 x 76 = $1,200, dated
14 days after the paid one (exactly on cadence), and carries no tells.
"""
from datetime import date, datetime

from ml.schema import (
    CaseFile, Invoice, LineItem, OpenOrder, SessionEntry, SessionHistory, Submission, VendorProfile,
)

PETES_LINES = [
    LineItem(description="Flour, 50lb sack", quantity=12, unit_price=62),
    LineItem(description="Pancake mix, bulk", quantity=4, unit_price=95),
    LineItem(description="Delivery", quantity=1, unit_price=76),
]


def vendors():
    return [
        VendorProfile(
            vendor_id="petes", name="Pancake Pete's Flour Co.", bank_account="3321",
            sender_domain="petesflour.com", letterhead_id="lh_petes",
            amount_mean=1200, amount_std=150, cadence_days=14, first_seen_round=-20,
            catalog={"Flour, 50lb sack": 62, "Pancake mix, bulk": 95, "Delivery": 76},
            usual_stamps=["RECEIVED"],
        ),
        VendorProfile(
            vendor_id="bubbles", name="Bubbles Dish Soap Ltd.", bank_account="9902",
            sender_domain="bubblessoap.co", letterhead_id="lh_bubbles",
            amount_mean=480, amount_std=60, cadence_days=7, first_seen_round=-20,
            catalog={"Dish soap, 5gal": 48, "Sponges (100)": 39, "Rubber gloves": 11},
        ),
        VendorProfile(
            vendor_id="dread", name="Existential Dread Consulting LLC", bank_account="1111",
            sender_domain="dreadconsulting.com", letterhead_id="lh_dread",
            amount_mean=2000, amount_std=300, cadence_days=30, first_seen_round=-10,
            catalog={"Menu font audit": 900, "Vibes assessment": 700, "Travel": 400},
        ),
    ]


def invoice(**overrides) -> Invoice:
    fields = dict(
        invoice_id="PP-0201", vendor_name="Pancake Pete's Flour Co.", vendor_id="petes",
        line_items=PETES_LINES, issue_date=date(2026, 10, 16), due_date=date(2026, 11, 15),
        order_number="PO-1001", bank_account="3321", sender_domain="petesflour.com",
        letterhead_id="lh_petes", sent_at=datetime(2026, 10, 16, 10, 30),
    )
    return Invoice(**{**fields, **overrides})


def case_file(**overrides) -> CaseFile:
    fields = dict(
        level_id="sunny_diner", approval_limit=2500, vendors=vendors(),
        open_orders=[
            OpenOrder(order_number="PO-1001", vendor_id="petes", amount=1200),
            OpenOrder(order_number="PO-2001", vendor_id="bubbles", amount=480),
        ],
        paid_invoices=[invoice(invoice_id="PP-0193", issue_date=date(2026, 10, 2), due_date=date(2026, 11, 1))],
    )
    return CaseFile(**{**fields, **overrides})


def history(round_no=3, entries=()) -> SessionHistory:
    """entries: (round_no, Invoice) pairs from earlier in the run."""
    return SessionHistory(
        session_id="s1", round_no=round_no,
        entries=[SessionEntry(round_no=r, invoice=inv) for r, inv in entries],
    )


def submission(**overrides) -> Submission:
    fields = dict(
        submission_id="sub1", session_id="s1", level_id="sunny_diner", round_no=3,
        scheme_id="bank_switcheroo", origin="player", invoice=invoice(bank_account="7781"),
        is_fraud=True, features={"bank_changed": 1.0}, detector_version=1, score=0.31,
        verdict="PAID", top_reasons=[("bank_changed", 0.8)], heat_before=10, heat_after=25,
        payout=1200, created_at=datetime(2026, 10, 24, 14, 0),
    )
    return Submission(**{**fields, **overrides})
