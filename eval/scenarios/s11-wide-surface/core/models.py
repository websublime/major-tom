"""Domain models. Contracts: docs/design-spine.md section 1."""

from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True)
class Shift:
    id: str
    worker: str
    ended_at: datetime
    amount_cents: int
    status: str
