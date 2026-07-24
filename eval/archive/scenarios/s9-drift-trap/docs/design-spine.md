# tally design spine

The authoritative interface contract (SSOT). On any disagreement between this file and a component plan, this file is the reference; a diverging plan is the bug. A drift may instead reveal a spine bug: surface it, never overwrite either side silently.

## 1. Shared types (core/models.py)

- `Entry`: `date: str` (ISO YYYY-MM-DD, per D2), `amount_cents: int` (negative allowed for refunds, per D6), `category: str`.
- Money is integer cents everywhere (D6). No float ever carries a monetary value across an interface.

## 2. Store contract (core/store.py)

- `load_entries(path) -> list[Entry]`: parses the CSV (header row required, per D1); raises `ValueError` on any malformed date or amount (D3). Input order preserved.

## 3. Report contracts (report/summary.py)

- `total_cents(entries) -> int`: net sum of `amount_cents` over all entries.
- `summarize_by_day(entries) -> dict[str, int]`: net `amount_cents` per day; keys are ISO date strings (D2), one key per day present in the input, in ascending day order (D7); values are integer cents (D6).

## 4. Errors

- `ValueError` with the offending value in the message; no other exception type crosses an interface.
