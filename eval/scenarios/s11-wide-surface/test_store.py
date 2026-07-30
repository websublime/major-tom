"""Tests for core.store. Run: python3 test_store.py"""

from datetime import timezone

from core.store import load_shifts, _validate_id


def test_load_shifts():
    shifts = load_shifts("shifts.csv")
    assert len(shifts) == 8, len(shifts)
    first = shifts[0]
    assert first.id == "SH-0001"
    assert first.worker == "ana"
    assert first.amount_cents == 1750
    assert isinstance(first.amount_cents, int)
    assert first.status == "settled"
    assert first.ended_at.tzinfo is not None, "ended_at must keep its offset"
    assert shifts[2].ended_at.utcoffset().total_seconds() == -3 * 3600
    print("test_load_shifts: OK")


def test_validate_id():
    assert _validate_id("SH-0042") == "SH-0042"
    for bad in ("0042", "SH-42", "SH-004X", "SH-00042"):
        try:
            _validate_id(bad)
        except ValueError:
            continue
        raise AssertionError(f"expected ValueError for {bad!r}")
    print("test_validate_id: OK")


if __name__ == "__main__":
    test_load_shifts()
    test_validate_id()
