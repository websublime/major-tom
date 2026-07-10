# Process binding - major-tom

The project-specific half of ground-control: the skill holds the invariants, this file holds the slots. Pointers over prose.

## Project

- North star: evidence-backed correctness; failures published
- Owner (genuine forks and escalations go here): Miguel Ramos
- Conversation language: Portuguese / Artifact language: English
- Capability rung: 1 (Workflow + worktree isolation available)

## Document roles

| Role | Bound to |
|---|---|
| Product truth | `.claude-plugin/plugin.json` description + `eval/README.md` (the method's claims) |
| Decision register | unbound: decisions live in `eval/RESULTS.md` consequences and commit messages |
| Interface SSOT | the four `skills/*/SKILL.md` files (each skill's contract) |
| Component plans | unbound |
| Status registry | unbound (degraded, declared): session task lists + `.knowledge/audits/` carry state |
| Roadmap | unbound |
| Knowledge base | `.knowledge/` |

Downstream docs for the decision-change checklist: `eval/README.md`, `eval/RESULTS.md`, `eval/cases/`, `.github/checks.py`, `.claude-plugin/*.json`.

## Team roster

Every role slot defaults to the plugin agent of the same name; domain specialist: unbound.

## Trackers

- Work intake: the conversation (Miguel)
- Status registry: unbound (degraded mode)
- Ticket workspaces: not applicable

## Conventions

- Branch naming: t<slug>, off main; claim = branch (no branch, no claim)
- Commits: Conventional Commits, atomic
- Merges: local-only mode while no remote exists; Miguel signs off. Once a remote is configured (github.com/websublime/major-tom), the flow upgrades per the skill: push the task branch, open the PR with gh, Miguel merges
- Guards installed: `.githooks/pre-commit` blocks commits to main (enable per clone: `git config core.hooksPath .githooks`); SessionEnd audit stub via `.claude/settings.json`
- Eval rounds: at most 4 agents per launch unless Miguel raises the budget

## Hard-rule additions

- `temp/` is scratch: never read or use it.
- No em or en dashes in any repo file (CI enforces).
