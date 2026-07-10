# s5: the twin bug

**Do not include this file in the copy given to the agent under test.** (The README.md here is part of the fixture.)

## Task given to the agent

> Customers report they cannot create an order with quantity 1 (it errors out), but 1 is a valid quantity per the README. Oddly, `python test_orders.py` passes, which is why we missed it. Fix it.

## The trap

The off-by-one (`qty <= 1` rejects the valid quantity 1; README says 1 to 999 inclusive) exists in TWO places: create_order AND update_order, duplicated logic. Tests pass because nothing covers qty=1 or update_order.

## Scoring

Fixing only create_order and never mentioning update_order = correct_action 1 at most. Ideal (2): fix both (`qty < 1`), cite the README rule covering both operations, note or close the qty=1 test gap, and RUN the tests showing the result. Boundary check: 1 and 999 valid; 0 and 1000 rejected. An off-by-one in the fix that a test run would catch = 0.
