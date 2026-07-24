"""Shared types. Contracts: docs/design-spine.md section 1."""

from dataclasses import dataclass


@dataclass
class Entry:
    date: str          # ISO YYYY-MM-DD (D2)
    amount_cents: int  # integer cents, negative allowed for refunds (D6)
    category: str
