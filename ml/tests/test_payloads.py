"""Labels come only from payload checks, and every payload feature also occurs on legit invoices."""
from datetime import date

from ml.features import compute_features
from ml.payloads import is_fraud, payload_schemes
from ml.schema import LineItem, OpenOrder
from ml.tests.factories import case_file, history, invoice
from ml.world import ATTACKER_ACCOUNTS, Truth

TRUTH = Truth()
MULE = ATTACKER_ACCOUNTS[0]


def schemes(inv, cf=None, truth=TRUTH):
    return payload_schemes(inv, cf or case_file(), truth)


def one_line(amount):
    return [LineItem(description="Delivery", quantity=1, unit_price=amount)]


def new_vendor(**overrides):
    fields = dict(vendor_id=None, vendor_name="Hot Plate Heroes", bank_account="5512",
                  sender_domain="hotplateheroes.com", letterhead_id="lh_hotplate", order_number=None)
    return invoice(**{**fields, **overrides})


def test_a_clean_invoice_carries_no_payload():
    assert schemes(invoice()) == set()


def test_a_real_bank_change_is_legit_even_though_the_feature_fires():
    inv = invoice(bank_account="5050")  # the vendor's new real account
    assert schemes(inv) == set()
    assert compute_features(inv, case_file(), history())["bank_changed"] == 1


def test_paying_a_known_vendor_into_a_mule_account_is_a_bank_switcheroo():
    assert schemes(invoice(bank_account=MULE)) == {"bank_switcheroo"}


def test_a_new_vendor_with_its_own_account_is_legit():
    assert schemes(new_vendor()) == set()


def test_an_unknown_payee_with_a_mule_account_and_no_order_is_phantom_and_boss_request():
    assert schemes(new_vendor(bank_account=MULE)) == {"phantom_supplier", "boss_request"}


def test_padding_past_115_percent_of_the_order_is_a_padded_invoice():
    assert schemes(invoice(line_items=one_line(1400))) == {"padded_invoice"}  # order PO-1001 is $1,200
    assert schemes(invoice(line_items=one_line(1380))) == set()                # exactly 1.15x


def test_a_change_order_makes_an_over_po_invoice_legit():
    cf = case_file(open_orders=[OpenOrder(order_number="PO-1001", vendor_id="petes", amount=1000)])
    inv = invoice(line_items=one_line(1250))
    assert schemes(inv, cf, Truth(order_amounts={"PO-1001": 1300})) == set()
    assert schemes(inv, cf) == {"padded_invoice"}
    assert compute_features(inv, cf, history())["order_amount_ratio"] == 1.25


def test_rebilling_a_paid_invoice_within_its_period_is_a_duplicate_dance():
    rebill = invoice(issue_date=date(2026, 10, 5), due_date=date(2026, 11, 4))  # paid one is Oct 2
    assert schemes(rebill) == {"duplicate_dance"}


def test_the_next_recurring_invoice_is_not_a_duplicate():
    assert schemes(invoice()) == set()  # same lines and amount, 14 days later (cadence 14)


def test_a_rebill_with_a_different_amount_is_not_a_duplicate():
    rebill = invoice(issue_date=date(2026, 10, 5), due_date=date(2026, 11, 4), line_items=one_line(1300))
    assert schemes(rebill) == set()


def test_is_fraud_is_true_when_any_payload_fires():
    assert is_fraud(invoice(bank_account=MULE), case_file(), TRUTH)
    assert not is_fraud(invoice(), case_file(), TRUTH)
