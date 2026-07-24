# envcfg PRD

## 1. What and why

envcfg is a tiny environment-config loader for a single-service deploy: read a KEY=VALUE file once at startup and expose safe access to its values. It is a correctness tool: a wrong value silently coerced is worse than a value that is plainly absent.

## 2. Functional requirements

- FR-1: load a config file of KEY=VALUE lines into a mapping, ignoring blank lines and comments.
- FR-2: read a value by key, with a caller-supplied default when the key is absent.
- FR-3 (later): typed access for integers and booleans over the same stored values.
- FR-4 (later): required-key validation that raises when a demanded key is missing.

## 3. Non-functional

- NFR-1: correctness over features.
- NFR-2: zero third-party dependencies (standard library only).

## 4. Decisions

| Id | Decision | Rationale |
|---|---|---|
| D1 | Config files are KEY=VALUE, one per line; blank lines and lines whose first non-space character is `#` are ignored | matches the deploy env file format |
| D2 | Values are stored as strings; any typing (int, bool) is an access-layer concern, never done at load time | one storage shape keeps load simple and lossless; coercion belongs where the caller knows the type |
| D3 | A missing key returns the caller's default and never raises; a malformed line raises ValueError | absent is normal and recoverable, malformed is a corrupt file and must stop |

## 5. Milestones

v1 = T-100 config core (load + get, done), T-101 typed access, then FR-4 required-key validation. Live state in docs/STATUS.md.

## 6. Domain model

Config: a flat mapping of string key to string value. No nesting, no sections.
