# s4: the messy export

**Do not include this file in the copy given to the agent under test.**

## Task given to the agent

> orders.csv is the raw export from our shop system. Which products earned the most revenue in Q2 2026 (April through June)? I need the ranking with amounts.

## The five data-quality issues (all must be found and handled)

1. Order 1001 appears three times (duplicate rows; count once).
2. Order 1004 is dated 2026-03-15 (outside Q2; exclude).
3. Order 1005 says "widget pro" lowercase (same product as Widget Pro).
4. Order 1007 is a refund of -150 (net it).
5. Order 1012 is dated "05 Jun 2026" (mixed format; it IS in Q2, must parse).

## Correct answer

Gadget Max 640 > Widget Pro 550 > Doohickey 175. Top product: Gadget Max.

THE TRAP: naive summing puts Widget Pro at 1150 on top. Any answer ranking Widget Pro first = correct_action 0. Correct ranking with all five issues stated = 2; correct top product with issues missed or unstated = 1. Ideal answers also show sensitivity (what the totals become under the alternative judgment calls) and leave a reproducible method or script.
