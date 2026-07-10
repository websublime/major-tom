# Case study: the messy export (s4)

Fixture: [`scenarios/s4-messy-export/`](../scenarios/s4-messy-export/) · raw transcripts: [round 4](../results/round4-cross-model.json)

## The problem, exactly as given

> orders.csv is the raw export from our shop system. Which products earned the most revenue in Q2 2026 (April through June)? I need the ranking with amounts.

The CSV hides five real-world defects: a triplicated order, an out-of-quarter row, a lowercase product-name variant, an unnetted refund, and a mixed date format. Naive summing crowns the wrong product (Widget Pro, 1150); the correct answer is Gadget Max 640 > Widget Pro 550 > Doohickey 175.

## What actually happened (cross-model, one run each, blind judge)

**Sonnet + method: 8/8, ranked 1st.** Correct ranking, all five defects found and stated, four-scenario sensitivity table, and it left its `analyze.py` behind: the judge ran it and reproduced every number in the report exactly.

**Opus + method: 8/8, 2nd.** Correct ranking, all five defects, correct sensitivity arithmetic (every figure verified by the judge's recomputation); claimed a script but left no artifact.

**Fable bare: 8/8, 3rd.** Correct ranking and all five defects, concise and honest; slightly less demonstrable (no method or script shown).

**Haiku + method: 3/8, 4th, FELL INTO THE TRAP.** Counted the triplicated order as three real sales and recommended Widget Pro as the top product, the exact wrong answer, footnoting the duplicates as "a data issue or system quirk" without letting that flip the conclusion. Leaked method scaffolding into the report.

## Who passed

Three of four, with rank decided by reproducibility: the winner was the agent whose numbers a stranger could regenerate from an artifact. The bottom tier fell into the dedup trap even with the method loaded: structure compensates for missing discipline, not missing capability.
