"""Reporting over ledger entries. Contracts: docs/design-spine.md section 3."""


def total_cents(entries):
    """Net total across all entries, in integer cents (spine section 3, D6)."""
    return sum(e.amount_cents for e in entries)


# T3 (summarize_by_day) is not implemented yet: see docs/STATUS.md.
