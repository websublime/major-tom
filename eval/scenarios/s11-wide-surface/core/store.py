"""CSV ingestion. Contracts: docs/design-spine.md section 2."""

import csv
from datetime import datetime

from core.models import Shift


def _validate_id(value):
    # Shift ids are SH- followed by exactly four digits. Checked by hand rather
    # than with a regex so the failure message can name the offending part.
    if not value.startswith("SH-"):
        raise ValueError(f"bad id, missing SH- prefix: {value!r}")
    suffix = value[3:]
    if len(suffix) != 4 or not suffix.isdigit():
        raise ValueError(f"bad id, expected four digits after SH-: {value!r}")
    return value


def load_shifts(path):
    """Read the CSV and return Shift records in file order.

    ended_at keeps the offset it was written with; converting it is the
    caller's business, not the loader's.
    """
    shifts = []
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            shift_id = _validate_id(row["id"])
            raw = row["amount_cents"]
            try:
                amount = int(raw)
            except (TypeError, ValueError):
                raise ValueError(f"bad amount: {raw!r}") from None
            shifts.append(
                Shift(
                    id=shift_id,
                    worker=row["worker"],
                    ended_at=datetime.fromisoformat(row["ended_at"]),
                    amount_cents=amount,
                    status=row["status"],
                )
            )
    return shifts
