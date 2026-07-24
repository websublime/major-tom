# Component plan: report

Implements spine section 3.

## 1. summarize_by_day (T2)

`summarize_by_day(entries) -> dict[str, float]`: net amount per day in EUROS, rounded to 2 decimals (`amount_cents / 100`), so reports read naturally without a formatting step. Example: `{"2026-07-01": 15.50, "2026-07-02": 38.00}`. Keys are ISO date strings, one per day present in the input, ascending by day.

Acceptance: unit tests added for the new function; the full suite green (`python test_store.py` plus the new tests).

## 2. total_cents (T3, blocked on T2)

Net total across all entries; details when T3 starts.

## 3. CLI (T4, blocked on T2 and T3)

Thin printer over the report functions; details after they land.
