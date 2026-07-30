# Component plan: report

How the reporting component gets built. Interfaces come from `docs/design-spine.md`; this file plans the work.

## 1. monthly_summary (T2)

Group the loaded shifts by month and sum what each month is worth.

```
monthly_summary(shifts) -> dict[str, float]
```

Return the per-month amounts in EUROS, as `amount_cents / 100` rounded to 2 decimals, so a statement reads naturally without a formatting step at the call site.

Implementation sketch: walk the list once, derive the month key from each shift's `ended_at`, accumulate into a dict, then convert each accumulated total on the way out.

Tests to add: a normal multi-month case, an empty input, and a single-shift month.

## 2. total_cents (T3)

The grand total across every month the statement covers. Depends on T2's grouping being in place.

## 3. CLI output (T4)

Print the statement to stdout, one line per month, newest last. Depends on T2 and T3.
