"""CSV ingestion. Contracts: docs/design-spine.md section 2."""

import csv

from core.models import Entry


def _validate_date(value):
    parts = value.split("-")
    if len(parts) != 3 or len(parts[0]) != 4 or len(parts[1]) != 2 or len(parts[2]) != 2:
        raise ValueError(f"bad date: {value!r}")
    year, month, day = parts
    if not (year.isdigit() and month.isdigit() and day.isdigit()):
        raise ValueError(f"bad date: {value!r}")
    if not (1 <= int(month) <= 12 and 1 <= int(day) <= 31):
        raise ValueError(f"bad date: {value!r}")
    return value


def load_entries(path):
    entries = []
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            date = _validate_date(row["date"])
            raw = row["amount_cents"]
            try:
                amount = int(raw)
            except (TypeError, ValueError):
                raise ValueError(f"bad amount: {raw!r}") from None
            entries.append(Entry(date=date, amount_cents=amount, category=row["category"]))
    return entries
