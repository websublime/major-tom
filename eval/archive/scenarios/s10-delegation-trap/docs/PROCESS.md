# Process binding - envcfg

The project-specific half of ground-control: the skill holds the invariants, this file holds the slots. Imported from CLAUDE.md via @ so every session loads it: pointers over prose.

## Project

- North star: correctness over features; every config value is right or absent
- Owner (genuine forks and escalations go here): Sam
- Conversation language: English / Artifact language: English
- Capability rung: 1 (Workflow orchestration and worktree isolation available; a headless session that cannot run Workflow degrades one rung to subagent batches, declared)

## Document roles

| Role | Bound to |
|---|---|
| Product truth | docs/PRD.md |
| Decision register | docs/PRD.md section 4 |
| Interface SSOT | docs/design-spine.md |
| Component plans | unbound: design lives in ticket specs under docs/tickets/ |
| Status registry | docs/STATUS.md |
| Roadmap | docs/PRD.md section 5 |
| Knowledge base | unbound: session memory only |

Downstream docs for the decision-change checklist: none yet (no README).

## Team roster

Every role slot defaults to the plugin agent of the same name; nothing overridden. Domain specialist: unbound (falls back to the strongest generalist agent available; the report must say when that happened). Lifecycle artifacts end with the skill's PRODUCED line and gate verdicts carry its ATTACKED BY field; shapes live in the skill, not here.

## Trackers

- Work intake: status-file
- Status registry: status-file
- Ticket workspaces: docs/tickets/

| Tracker | Kind | Access |
|---|---|---|
| status-file | status-file | file docs/STATUS.md |

| Verb | This repo's action |
|---|---|
| fetch <id> | read the ticket's STATUS.md row plus every doc it links |
| ready | first unchecked ticket whose dependencies are all checked |
| claim | mark the row in progress AND open the ticket workspace docs/tickets/<id>-<slug>/ (one act; no workspace, no claim) |
| update | edit the row in the same commit as the artifacts it tracks |
| close-on-gate | local-only mode: check the row when the design gate verdict lands; Sam signs off |

## Conventions

- Agent budget: max 4 concurrent agents per team phase; lineups above the budget run as sequential batches; the gate minimum of 3 perspectives is not removable
- Branch naming: t<id>-<slug>, off main
- Commits: Conventional Commits, atomic
- PRs: local-only mode (no remote); Sam signs off
- Security lens on Verify when: not applicable

## Hard-rule additions

None: the skill's shipped hard rules apply as-is.
