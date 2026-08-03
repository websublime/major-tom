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

Three of four are unbound and that is honest: this repo is docs and eval, it ships no application interfaces, and its decisions live in `docs/specs/` and `.knowledge/memory/` as prose rather than as a numbered register. The eval fixtures carry their own bindings and do bind these roles, which is what the register check in `.github/checks.py` guards: `eval/scenarios/s11-wide-surface` plus the three archived ones under `eval/archive/scenarios/`.

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

## Lifecycle

Which phases run here, and who runs each one. The phase order, the entry contract that `lifecycle` will not start without, the repair loop and the three things that loop forbids are invariants the `intent` and `lifecycle` skills hold; only the values below belong to this project.

Phases that apply: all seven.

| Phase | Skill | Team |
|---|---|---|
| Evaluate | `intent` | researcher, for the parallel gathering |
| Classify | `intent` | run in the main thread, not delegated |
| Distribute | `lifecycle` | architect, project-manager |
| Distribute, design gate | `lifecycle` | architect, researcher, product-validator |
| Work | `lifecycle`, running `act` | coordinator's pick from the roster; no stack specialists are fetched here |
| Capture | `lifecycle` | the agent that did the work |
| Verify, quality gate | `lifecycle`, running `prove` | code-reviewer, qa, architect |
| Finalize | `lifecycle` | vcs-operator |

- Gate size, attacking agents plus the coordinator: 3
- Repair rounds before escalation: 2
- Escalation goes to: the Owner named under Project

The Work row names no stack specialist because none is fetched for this repo, which is docs and eval rather than an application stack. That is the declared degraded mode, not an omission.

## Tracker

none. Work intake is the conversation with Miguel; in-flight state lives in the session task lists and `.knowledge/audits/`.

- Which of the lifecycle's four operations it supports: none of the four. There is no queue to take the next ready work from, no claim, no place to record a phase outcome except the audit files, and nothing to close. Every session that reaches for one of them says so and asks Miguel instead. With no tracker there is no state between sessions, so this repo has no loop over a queue.

## Knowledge base

- Path: `.knowledge/`
- Layout: `memory/` holds one fact per file plus an `INDEX.md`; CLAUDE.md imports the index (`@.knowledge/memory/INDEX.md`) so it loads every session. `audits/` holds one session audit per file.

## Conventions

- Branch naming: t<slug>, off main; claim = branch (no branch, no claim)
- Design artifacts land in `docs/specs/`. A recorded run and its evidence live on the orphan branch `runs`, one directory per run, with the plan that fed the design as `01-plan.md` there. They are not on main and never merge into it: adding this repository as a plugin marketplace shallow-clones main and puts its whole tree on the user's disk, so a run on main would ship to every user. Attach the branch before writing anything there: `git worktree add docs/runs runs`. `docs/runs/` is gitignored here for that reason, and that cuts both ways: **a file written to an unattached `docs/runs` is lost work, not a record.** It will not show in `git status` and default `rg` will not find it. Check `git worktree list` names `docs/runs` before a plan or a run record goes there. The branch lives only in clones that fetched it; if `git worktree add` fails with an unknown reference, the records are not in your clone. A spec declares its gate result in front matter at the very top, three dashes, `verdict`, `attacked_by`, `author`, three dashes. `verdict` is the prove verdict verbatim: VERIFIED, VERIFIED WITH CAVEATS, or REFUTED. Before the gate there is no such block, and prose saying UNSIGNED is fine because it declares nothing. The author is never an attacker. `.github/checks.py` enforces the grammar and that all three fields are present and non-empty. It does not judge whether the names are real, and it does not judge independence: four attempts to screen the values by pattern each opened holes a gate then found, so the screening was removed rather than extended. It is a grammar and not a text matcher because three Verify gates each found a regression in the matcher that preceded it.
- Commits: Conventional Commits, atomic
- Merges: the Verify gate is mandatory before any merge request or PR; the request carries the verdict. Remote `origin` is configured (github.com/websublime/major-tom); the PR flow is push the task branch, open the PR with gh carrying the gate verdicts, Miguel merges. Pushing is publishing: only on Miguel's explicit go.
- Guards installed: `.githooks/pre-commit` blocks commits to main (enable per clone: `git config core.hooksPath .githooks`, or run `install-guards`); the plugin's PreToolUse branch guard (`scripts/pretool-branch-guard.sh`, shipped by the plugin and therefore NOT active in this repo, where the plugin is not installed); the plugin UserPromptSubmit writing rule (`scripts/userprompt-writing-rule.sh`, think Step 6 re-injected every prompt so compaction cannot drop it); `guard-violations` monitor (experimental, Claude Code v2.1.105+). This repo carries the writing rule in its own `.claude/settings.json` too, because the plugin is not installed here; remove that entry if you install the plugin, or it fires twice.
- Eval rounds: at most 4 agents per launch unless Miguel raises the budget.
- Releases: bump `version` in both `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` inside the PR branch (CI checks they agree) when the merge changes what installs; semver by commit type (fix/docs = patch, feat = minor, breaking = major); after the merge, tag `vX.Y.Z` on the merge commit and push the tag (tags are not commits, so the main guard does not apply).

## Hard-rule additions

The skills' shipped hard rules always apply and cannot be removed here. Project rules add below:

- `temp/` is scratch: never read or use it.
- No em or en dashes in any repo file (CI enforces).
