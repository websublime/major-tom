# Design spine: the interface SSOT

This file is the single source of truth for interfaces. On any disagreement between this file and a component plan, this file is the reference and the diverging plan is the bug. Where this file is silent, the product truth in `docs/PRD.md` governs, decision register included.

## 1. Models

```
Shift
  id: str            # SH- plus four digits, per D2
  worker: str
  ended_at: datetime # timezone aware, carrying the offset from the export, per D3
  amount_cents: int  # per D4
  status: str        # "settled" or "voided"
```

## 2. Ingestion

```
load_shifts(path: str) -> list[Shift]
```

Returns records in file order. Raises `ValueError` on a malformed id or a non-integer amount. Performs no timezone conversion and no filtering of any kind: what is in the file comes out of the loader.

## 3. Reporting

```
monthly_summary(shifts: list[Shift]) -> dict[str, int]
```

- Keys are month strings in `YYYY-MM` form, per D6.
- Each shift is bucketed by its end instant **converted to UTC**, per D7. The offset a row was written with never decides its bucket.
- Values are integer cents, per D4.
- Keys appear in ascending order. A caller iterating the result gets months in calendar order without sorting again.
- A month with no contributing shifts does not appear at all. No zero-valued keys.

Which shifts contribute to a total is a product decision, not an interface one: see the decision register in `docs/PRD.md` section 4.
