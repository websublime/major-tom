# Case study: the twin bug (s5)

Fixture: [`scenarios/s5-twin-bug/`](../scenarios/s5-twin-bug/) · raw transcripts: [round 7](../results/round7-act-first-test.json)

## The problem, exactly as given

> Customers report they cannot create an order with quantity 1 (it errors out), but 1 is a valid quantity per the README. Oddly, `python test_orders.py` passes, which is why we missed it. Fix it.

The off-by-one (`qty <= 1` rejects the valid quantity 1) exists twice: in `create_order` (the reported symptom) and duplicated in `update_order` (which nothing tests). Fixing only the reported site ships the twin.

## What actually happened (Sonnet: bare, +method, +loop; 2 seeds each)

**All twelve runs scored 8/8.** Every run, in every condition, fixed both sites, cited the README rule covering both operations, addressed the qty=1 test-coverage gap (fixing or explicitly flagging it), and ran the suite with output shown. Judges independently re-ran tests and boundary checks (1 and 999 accepted, 0 and 1000 rejected) in every directory.

## Who passed

Everyone, including bare Sonnet. Published as a null: at this size (three files, symptom well described), current frontier models find cross-file twins natively. The scenario stays in the suite as a floor check for weaker executors and as a template for scaling the twin pattern up, where the same trap should bite harder (reward-hacking research consistently finds failure grows with codebase size).
