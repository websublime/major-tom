# Process binding - major-tom

The project-specific half of the workflow: the skills hold the invariants, this file holds the slots. Imported from CLAUDE.md via @ so every session loads it: pointers over prose. Keep the first line exactly `# Process binding` so the branch guard self-gates on it.

## Project

- North star: evidence-backed correctness; failures published
- Owner (genuine forks and escalations go here): Miguel Ramos
- Conversation language: Portuguese / Artifact language (code, docs, commits): English

## Document roles

Paths only; the order between the roles is an invariant the skills hold. Unbound degrades, it never blocks: say which degraded mode you are in rather than pretending a role is bound.

| Role | Bound to |
|---|---|
| Product truth | README.md |
| Decision register | unbound |
| Interface SSOT | unbound |
| Component plans | unbound |

Three of four are unbound and that is honest: this repo is docs and eval, it ships no application interfaces, and its decisions live in `docs/specs/` and `.knowledge/memory/` as prose rather than as a numbered register. The eval fixtures under `eval/` carry their own bindings and do bind these roles, which is what the register check in `.github/checks.py` currently guards.

## Working model

team. The coordinator orchestrates; writers run in isolated worktrees when they could touch the same files (Workflow and worktree isolation are available here).

| Working model | Delegation | Isolation | Orchestrator |
|---|---|---|---|
| team | specialists in parallel | isolated worktrees | coordinator |
| subagents-only | discrete tasks, one writer at a time | single branch | coordinator |

## Agents

The roster the coordinator delegates to; the plugin ships the nine below. No stack specialists are fetched for this repo (it is docs and eval, not an application stack).

| Agent | Scope |
|---|---|
| coordinator | orchestrates, spawns and coordinates, synthesizes; writes only its own consolidations, never the artifact under review |
| architect | system design, interface stewardship, records decisions, attacks designs |
| researcher | investigation, evidence, library and API verification with citations |
| project-manager | decomposition into tasks with failable acceptance criteria |
| product-validator | adversarial product lens on value, scope, and evidence |
| code-reviewer | code review against acceptance criteria and quality |
| qa | tests, quality, verification by observation |
| refactor-specialist | behavior-preserving restructuring, same checks green before and after |
| vcs-operator | branch, atomic Conventional commits, PRs carrying verdicts |

Agents directory (where onboard fetches specialists): https://github.com/ayush-that/sub-agents.directory

## Tracker

none. Work intake is the conversation with Miguel; in-flight state lives in the session task lists and `.knowledge/audits/`.

## Knowledge base

- Path: `.knowledge/`
- Layout: `memory/` holds one fact per file plus an `INDEX.md`; CLAUDE.md imports the index (`@.knowledge/memory/INDEX.md`) so it loads every session. `audits/` holds one session audit per file.

## Conventions

- Branch naming: t<slug>, off main; claim = branch (no branch, no claim)
- Commits: Conventional Commits, atomic
- Merges: the Verify gate is mandatory before any merge request or PR; the request carries the verdict. Remote `origin` is configured (github.com/websublime/major-tom); the PR flow is push the task branch, open the PR with gh carrying the gate verdicts, Miguel merges. Pushing is publishing: only on Miguel's explicit go.
- Guards installed: `.githooks/pre-commit` blocks commits to main (enable per clone: `git config core.hooksPath .githooks`, or run `install-guards`); plugin PreToolUse branch guard (`scripts/pretool-branch-guard.sh`); `guard-violations` monitor (experimental, Claude Code v2.1.105+).
- Eval rounds: at most 4 agents per launch unless Miguel raises the budget.
- Releases: bump `version` in both `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` inside the PR branch (CI checks they agree) when the merge changes what installs; semver by commit type (fix/docs = patch, feat = minor, breaking = major); after the merge, tag `vX.Y.Z` on the merge commit and push the tag (tags are not commits, so the main guard does not apply).

## Hard-rule additions

The skills' shipped hard rules always apply and cannot be removed here. Project rules add below:

- `temp/` is scratch: never read or use it.
- No em or en dashes in any repo file (CI enforces).
