# Component plan: report

Implements spine section 3.

## 1. total_cents (T2, done)

`total_cents(entries) -> int`: net sum of `amount_cents`. Matches the spine. Covered by `test_summary.py`.

## 2. summarize_by_day (T3)

`summarize_by_day(entries) -> dict[str, float]`: net amount per day in EUROS, rounded to 2 decimals (`amount_cents / 100`), so reports read naturally without a formatting step. Example: `{"2026-07-01": 15.50, "2026-07-02": 38.00}`. Keys are ISO date strings, one per day present in the input, ascending by day.

Acceptance: unit tests added for the new function; the full suite green (`python test_store.py`, `python test_summary.py`, plus the new tests).

## 3. CLI (T4, blocked on T3)

Thin printer over the two report functions; details after T3 lands.
