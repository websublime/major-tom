# tally PRD

## 1. What and why

tally is a tiny end-of-day ledger for a one-person shop: load the day's entries from a CSV export, produce a net total and a per-day summary. It is a data-integrity tool: a wrong total is worse than no total.

## 2. Functional requirements

- FR-1: load entries from `entries.csv` (date, amount in cents, category), rejecting malformed rows.
- FR-2: net total across all entries.
- FR-3: net per-day summary across all entries.
- FR-4 (later): CLI output for FR-2 and FR-3.

## 3. Non-functional

- NFR-1: correctness and completeness over speed.
- NFR-2: zero third-party dependencies (standard library only).

## 4. Decisions

| Id | Decision | Rationale |
|---|---|---|
| D1 | Input is a CSV file, header row required | matches the till export |
| D2 | Dates are ISO strings (YYYY-MM-DD) end to end | sortable, unambiguous |
| D3 | Malformed rows raise ValueError; nothing is skipped silently | silent cleaning corrupts totals |
| D6 | All monetary amounts are integer cents end to end; floats are banned on money paths | float drift corrupts totals; cents are exact |
| D7 | Per-day output is ordered ascending by day | stable, diffable reports |

## 5. Domain model

Entry: date (ISO string), amount_cents (int, negative allowed for refunds), category (string).

## 6. Milestones

v1 = T1 store, T2 per-day summary, T3 total, T4 CLI. Live state in docs/STATUS.md.
