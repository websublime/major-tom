# Process binding - shiftlog

The project-specific half of the workflow: the skills hold the invariants, this file holds the slots. Imported from CLAUDE.md via @ so every session loads it: pointers over prose, every line costs context.

## Project

- North star: correctness and completeness over speed
- Owner (genuine forks and escalations go here): Sam
- Conversation language: English / Artifact language (code, docs, commits): English

## Document roles

| Role | Bound to |
|---|---|
| Product truth | docs/PRD.md |
| Decision register | docs/PRD.md section 4 |
| Interface SSOT | docs/design-spine.md |
| Component plans | docs/plans/<component>.md |
| Status registry | docs/STATUS.md |
| Knowledge base | unbound: session memory only |

Authority order when documents disagree: product truth, then the interface SSOT, then component plans. A task description is never authoritative. A component plan found diverging from the SSOT is repaired in the plan, by whoever finds it, in the same commit as the work that exposed it; escalate to the owner only when the SSOT itself looks wrong.

## Tracker

status-file.

- Access: file docs/STATUS.md

| Verb | This repo's action |
|---|---|
| fetch <id> | read the task's STATUS.md row plus every doc it links |
| ready | first unchecked task whose dependencies are all checked |
| claim | mark the row in progress AND create the task branch t<id>-<slug> off main (one act; no branch, no claim) |
| update | edit the row in the same commit as the work |
| close-on-merge | local-only mode: check the row when the work lands; Sam signs off |

## Conventions

- Guard installed: `.githooks/pre-commit` blocks commits to main (enabled per clone via `git config core.hooksPath .githooks`); bypassing or disabling it is a gate violation
- Branch naming: t<id>-<slug>, off main
- Commits: Conventional Commits, atomic
- PRs and merge sign-off: local-only mode (no remote); Sam signs off, and the session never merges

## Hard-rule additions

The skills' shipped hard rules always apply and cannot be removed here. Project rules add below:

- None.
