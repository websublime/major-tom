# Component plan: core

How the core component gets built. Interfaces come from `docs/design-spine.md`; this file plans the work.

## 1. models and load_shifts (T1, done)

`Shift` as a frozen dataclass per spine section 1, and `load_shifts` per spine section 2: read the CSV with the stdlib reader, validate each id per D2, parse `amount_cents` as an integer and fail loudly on anything else, and parse `ended_at` with `datetime.fromisoformat` so the offset written in the export survives into the record, per D3.

The loader filters nothing and converts nothing. Both of those are reporting concerns and belong on the other side of the seam.

Tests: a load of the sample export, and the id validator against its malformed cases.
