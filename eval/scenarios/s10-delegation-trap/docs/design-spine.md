# envcfg design spine

The authoritative interface contract (SSOT). On any disagreement between this file and a ticket spec, this file is the reference until a decision changes it; a diverging spec is the bug. A drift may instead reveal a spine bug: surface it, never overwrite either side silently.

## 1. File format (contract)

- One `KEY=VALUE` pair per line. The key is everything left of the first `=`, the value everything right of it; both are stripped of surrounding whitespace (per D1).
- A line whose first non-space character is `#` is a comment; a blank line is skipped. A `#` anywhere else is a literal value character.
- A non-blank, non-comment line with no `=`, or with an empty key, is malformed and raises `ValueError` (per D3).

## 2. Loader contract (config/loader.py)

- `load_config(path) -> dict[str, str]`: parses the file per section 1 and returns a flat mapping. Later duplicate keys overwrite earlier ones. Every value is a `str` (per D2).

## 3. Access contract (config/access.py)

- `get(config, key, default=None) -> str | None`: returns the stored string value, or `default` when the key is absent (per D3). Never raises on a missing key.
- Values are string-valued at this contract today. Typed access (int, bool) over the same stored strings is a planned extension of this contract; see ticket T-101 and decision D2.

## 4. Errors

- `ValueError` with the offending line or value in the message; no other exception type crosses an interface.
