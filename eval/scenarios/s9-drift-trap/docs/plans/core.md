# Component plan: core

Implements spine sections 1 and 2.

- `core/models.py`: the `Entry` dataclass exactly as the spine defines it (ISO date string, int amount_cents, category).
- `core/store.py`: `load_entries(path)` over the csv module, header row required; date validation per D2/D3; `int()` on amounts; `ValueError` on anything malformed.
- Tests: `test_store.py` covers the happy path and both malformed cases.

Status: T1 done; contracts match the spine.
