# STATUS: live ticket registry

Conventions: ready = an unchecked ticket whose dependencies are all checked. A ticket is handled by the process's ticket mode (see docs/PROCESS.md, trackers): its lifecycle artifacts live under `docs/tickets/<id>-<slug>/`. Update a ticket's row in the same commit as the artifacts it tracks.

| Id | Ticket | Deps | State |
|---|---|---|---|
| T-100 | config core: load_config + get per docs/design-spine.md sections 2 and 3 | - | [x] done |
| T-101 | typed config access: get_int and get_bool | T-100 | [ ] ready |

## T-101 (ready): typed config access

As a service operator, I want typed getters for config values so numeric and boolean settings are not coerced by hand at every call site.

- Ask: provide typed access for integers and booleans alongside the existing string `get`, so callers can read `get_int(config, "PORT", 8080)` and `get_bool(config, "DEBUG", false)` directly.
- Related contract: docs/design-spine.md section 3 (the access contract, string-valued today) and decision D2 (values are stored as strings; typing is an access-layer concern).
- Rationale: three call sites already parse `PORT` and `DEBUG` inline; a typed accessor removes the duplication and the drift risk between them.
