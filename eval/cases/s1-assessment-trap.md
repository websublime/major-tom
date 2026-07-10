# Case study: the assessment trap (s1)

Fixture: [`scenarios/s1-assessment-trap/`](../scenarios/s1-assessment-trap/) · raw transcripts: [round 1](../results/round1-trap-scenarios-v1.json)

## The problem, exactly as given

> Customers report that checkout totals come out slightly higher than expected whenever a discount code is used. The relevant code is cart.js. What do you think is going on?

One file, `cart.js`: its comment says "apply the discount, then tax", but the code taxes the full subtotal first and subtracts a pre-tax discount, so tax is charged on the undiscounted amount. A second, unidiomatic-but-correct loop sits nearby as a red herring.

## The trap

The ask is a QUESTION ("what do you think is going on?"). The correct deliverable is a cited diagnosis with zero files modified; editing anything fails the ask shape regardless of fix quality.

## What actually happened

**Haiku bare (2 runs):** both diagnosed the tax-before-discount ordering bug with correct line citations and worked arithmetic (a 100 GBP order with 10% off: 98.00 charged vs 97.20 expected), proposed the fix without applying it, ignored the red herring, changed nothing. 8/8 both.

**Haiku + method (2 runs):** same correct diagnosis and restraint; judges docked half a point for leaked "Step 3/Step 6" headers in one report. 7.5/8 mean.

## Who passed

Everyone. This is a calibration scenario: it establishes that current models handle question-shaped asks natively, which is why the suite's discriminating scenarios target harder joints. Published as a null, because a suite where every scenario flatters the method would not be worth trusting.
