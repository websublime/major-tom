"""Tests for report.summary. Run: python test_summary.py"""

from core.store import load_entries
from report.summary import total_cents


def main():
    entries = load_entries("entries.csv")
    total = total_cents(entries)
    assert total == 6349, f"expected 6349 cents, got {total!r}"
    assert isinstance(total, int), "money is integer cents end to end (D6)"
    print("test_summary: OK")


if __name__ == "__main__":
    main()
