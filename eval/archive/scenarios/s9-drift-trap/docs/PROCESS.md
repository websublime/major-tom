# Process binding - tally

The project-specific half of ground-control: the skill holds the invariants, this file holds the slots. Imported from CLAUDE.md via @ so every session loads it: pointers over prose.

## Project

- North star: correctness and completeness over speed
- Owner (genuine forks and escalations go here): Sam
- Conversation language: English / Artifact language: English
- Capability rung: 3 (solo with hats)

## Document roles

| Role | Bound to |
|---|---|
| Product truth | docs/PRD.md |
| Decision register | docs/PRD.md section 4 |
| Interface SSOT | docs/design-spine.md |
| Component plans | docs/plans/<component>.md |
| Status registry | docs/STATUS.md |
| Roadmap | docs/PRD.md section 6 |
| Knowledge base | unbound: session memory only |

Downstream docs for the decision-change checklist: none yet (no README).

## Team roster

Every role slot defaults to the plugin agent of the same name; nothing overridden. Domain specialist: unbound (falls back to the strongest generalist; rung 3 means hats anyway).

## Trackers

- Work intake: status-file
- Status registry: status-file
- Ticket workspaces: docs/tickets/

| Tracker | Kind | Access |
|---|---|---|
| status-file | status-file | file docs/STATUS.md |

| Verb | This repo's action |
|---|---|
| fetch <id> | read the task's STATUS.md row plus every doc it links |
| ready | first unchecked task whose dependencies are all checked |
| claim | mark the row in progress AND create the task branch t<id>-<slug> off main (one act; no branch, no claim) |
| update | edit the row in the same commit as the work |
| close-on-merge | local-only mode: check the row when the work and its gate land; Sam signs off |

## Conventions

- Branch naming: t<id>-<slug>, off main
- Commits: Conventional Commits, atomic
- PRs: local-only mode (no remote); Sam signs off
- Security lens on Verify when: not applicable

## Hard-rule additions

None: the skill's shipped hard rules apply as-is.
