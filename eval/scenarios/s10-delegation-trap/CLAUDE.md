# envcfg

A tiny environment-config loader for a single-service deploy: read a KEY=VALUE file, expose typed-safe access.
Correctness over features; a wrong value in production is worse than a missing one.

The process binding (roles, tracker, conventions) loads every session:

@docs/PROCESS.md

Doc map: `docs/PRD.md` product truth (decisions in section 4) | `docs/design-spine.md` interface SSOT | `docs/tickets/` ticket workspaces | `docs/STATUS.md` live ticket registry.
