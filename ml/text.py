"""Cover emails, written the same way for legit and fraud invoices (spec 3.2).

Both classes call cover_email with the same templates and differ only in intent
(tone, a bank-change note, a new-vendor intro), so the detector cannot learn that
having an email, or a writing style, means fraud. Stands in for LLM-written text
until there is a cached pool; a pool can replace this behind the same signature.
"""
import random

TONES = ("plain", "chatty", "apologetic", "urgent")
EMAIL_RATE = 0.65  # share of invoices with a cover email, the same in both classes

GREETINGS = {
    "plain": ("Hello,", "Hi Marge,", "Good morning,", "Hello accounts team,"),
    "chatty": ("Hey there!", "Hi Marge, hope the griddle is behaving!", "Happy Friday from all of us!", "Howdy!"),
    "apologetic": ("Sorry to bother you,", "Apologies for the extra email,", "So sorry for the hassle,"),
    "urgent": ("URGENT:", "Time sensitive:", "Please read right away:"),
}
BODIES = (
    "Please find invoice {number} for {amount} attached.",
    "Attached is invoice {number}, totaling {amount}.",
    "Here is this period's invoice ({number}) for {amount}.",
    "Our invoice {number} for {amount} is attached for your records.",
)
INTROS = (
    "This is our first invoice with you, thanks for the business.",
    "Thanks for choosing {vendor}, our first invoice is attached.",
)
CHANGES = (
    "Note that we recently changed banks, so please pay to the new account on the invoice.",
    "Our banking details have been updated; please use the new account number shown.",
    "We moved to a new bank this month and the updated account is on the invoice.",
)
EXTRAS = {  # some mention an account or an update without a bank change
    "plain": ("Please pay to the account on file as usual.", "Let us know if you need a W-9.", ""),
    "chatty": ("The new pancake mix is a hit with our other diners!", "We updated our product list, ask us anytime.", ""),
    "apologetic": ("Sorry this one is a little late.", "Apologies if this crossed with your payment run.", ""),
    "urgent": ("Payment is needed immediately to avoid a late fee.", "Please process this ASAP, it is time sensitive.",
               "This is overdue, please rush the payment."),
}
SIGNOFFS = {
    "plain": ("Thanks,", "Regards,", "Best,"),
    "chatty": ("Cheers!", "Have a great service!"),
    "apologetic": ("Thanks for your patience,", "Sorry again,"),
    "urgent": ("Thank you for the quick turnaround,", "Thanks,"),
}


def cover_email(rng: random.Random, tone: str, *, vendor: str, number: str, amount: float,
                new_vendor: bool = False, mentions_change: bool = False) -> str:
    parts = [rng.choice(GREETINGS[tone]), rng.choice(BODIES).format(number=number, amount=f"${amount:,.2f}")]
    if new_vendor:
        parts.append(rng.choice(INTROS).format(vendor=vendor))
    if mentions_change:
        parts.append(rng.choice(CHANGES))
    parts += [rng.choice(EXTRAS[tone]), rng.choice(SIGNOFFS[tone]), f"{vendor} billing"]
    return " ".join(p for p in parts if p)
