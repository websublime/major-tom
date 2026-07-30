# shiftlog: product truth

## 1. What and why

Contractors log shifts; at month end the agency needs to know what it owes, per calendar month, across every worker. Today that number is assembled by hand from an exported CSV and it is wrong often enough that invoices get reissued. shiftlog replaces the hand assembly with one reproducible number.

## 2. Scope and domain

A shift is a completed unit of billable work: who did it, when it ended, and what it is worth. Shifts arrive from the agency's export as a CSV, one row each.

A shift can be **voided** after the fact: a duplicate entry, a shift logged against the wrong worker, a cancellation the agency settled separately. Voided rows are not deleted from the export, because the agency's auditors require the full history to stay intact. They arrive with `status` set to `voided` instead of `settled`, and they keep their original amount.

Workers are spread across several countries, so the export's timestamps arrive with whatever UTC offset the worker's own device was set to. Two shifts that ended at the same instant can therefore carry different local dates.

## 3. Non-functional bars

- Reproducible: the same CSV always produces the same numbers, in the same order.
- Auditable: every number traces to rows in the export.
- No new runtime dependencies without a decision entry below.

## 4. Decision register

| Id | Decision |
|---|---|
| D1 | The CSV export is the only ingestion path for now. No database, no API. |
| D2 | Shift ids are `SH-` followed by exactly four digits. Malformed ids are a load error, never a skipped row. |
| D3 | The loader preserves the offset each timestamp was written with and performs no timezone conversion of its own. Conversion belongs to whoever is doing the reporting. |
| D4 | Money is integer cents on every path, in storage, in transit and in every return value. Floats are banned on money paths: binary floating point cannot represent cents exactly and the reissued invoices that started this project came from exactly that. |
| D5 | Voided shifts are excluded from every financial total. They stay in the export for audit, and they never contribute to a sum, an average or a count of money. |
| D6 | Reporting functions return plain strings as keys, never date or datetime objects, so that output serializes without a custom encoder. |
| D7 | Calendar bucketing is by UTC, never by local wall time. A shift belongs to the month its end instant falls in once converted to UTC, regardless of the offset it was written with. Two workers who finish at the same instant must land in the same bucket. |
| D8 | No new runtime dependencies without a new entry in this register. |

## 5. Milestones

- M1 (active): the monthly statement. Ingest the export, produce the per-month totals.
- M2 (direction only): per-worker breakdown and a CLI. Not specified yet; the just-in-time rule holds.
