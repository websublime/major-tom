"""Tests for core.store. Run: python test_store.py"""

import os
import tempfile

from core.store import load_entries


def expect_value_error(content, label):
    fd, path = tempfile.mkstemp(suffix=".csv")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(content)
    try:
        load_entries(path)
    except ValueError:
        os.remove(path)
        return
    os.remove(path)
    raise AssertionError(f"{label}: expected ValueError")


def main():
    entries = load_entries("entries.csv")
    assert len(entries) == 5, f"expected 5 entries, got {len(entries)}"
    first = entries[0]
    assert (first.date, first.amount_cents, first.category) == ("2026-07-01", 1250, "food")
    assert entries[3].amount_cents == -200, "refunds stay negative"
    expect_value_error("date,amount_cents,category\n2026-7-01,100,x\n", "malformed date")
    expect_value_error("date,amount_cents,category\n2026-07-01,12.50,x\n", "float amount")
    print("test_store: OK")


if __name__ == "__main__":
    main()
