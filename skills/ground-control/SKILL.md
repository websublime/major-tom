---
name: ground-control
description: Project-scale operating process - a change lifecycle with adversarial gates, an orchestrator that delegates instead of implementing, a decision register with drift discipline, and a per-repo binding that maps abstract roles (documents, team slots, tracker verbs) onto whatever the project actually has. Use when work spans sessions, milestones, or multiple components, when a repo carries a process binding, or when the user says "/ground-control", "run the process", or "set up the process". Subcommands - init (mechanical repo binding), product (develop the product truth with the owner, design-gated), spec <milestone> (the active milestone's spec pack, design-gated), agent <need> (add a specialist anytime), status (report where the project stands), gate (run a design review or verify gate now), ticket (pull a tracker ticket, e.g. Jira, into a docs workspace with context, plan, spec, design-gated).
---

# Ground Control

think governs a rule, act governs a task, ground-control governs a project. It is the same method at the third scale: evidence before decisions, forced artifacts at decision points, adversarial verification before anything locks. The main session is Ground Control: it conducts and decides; spawned teams do the work. Read think's SKILL.md first (installed alongside, in this plugin's `skills/think/` directory); its rules govern every phase here, and act's stages run inside every team.

Two files carry the process:

- **This skill holds the invariants.** If a line here names a concrete file, stack, person, or tool, that is a bug.
- **The binding holds everything project-specific**: a short file generated into the repo (see init mode), imported from the project's CLAUDE.md so every session loads it. The process runs degraded without one, but must say so.

## The escalation ladder (one table for the whole family)

| Scale | Signal | Who edits | Skill |
|---|---|---|---|
| **Trivial** | think's triviality gate passes | The main session, directly | none |
| **Task** | One deliverable, one session, blast radius nameable up front | Main session runs the loop; subagents gather evidence and attack the result | act |
| **Substantive** | Touches a public interface, a spec/contract, or multiple components; or spans sessions | A spawned team, in isolation; the main session orchestrates and does not hand-write | ground-control |

At the substantive scale, act's rule "deciding and editing stay in the main thread" inverts by design: deciding stays, editing leaves. A well-specified change is not a trivial one; scaffolding and multi-file work always go to a team, even when the spec is exact. The scales nest, they never compete: each implementer inside a team follows think (intent gate, smallest correct change), and each phase team runs act's stages.

## Document roles and the authority hierarchy

The process names documents by role; the binding maps each role to real files. Several roles may share one file (small project) or one role may span several (monorepo). The hierarchy is the invariant:

**product truth > interface SSOT > component plans.**

| Role | Holds |
|---|---|
| Product truth | What is being built and why; requirements; the decision register |
| Interface SSOT | The authoritative cross-component contracts: types, APIs, schemas, errors |
| Component plans | How each component is built |
| Status registry | Live task state; the cross-session system of record |
| Roadmap | Version sequencing; only the active version is decomposed into tasks |
| Knowledge base | Cross-session learned facts no authoritative doc owns yet; reviewed into real docs over time |

On any cross-component interface disagreement the SSOT wins; a component plan that diverges is the bug, not the SSOT. An unbound role degrades, never blocks: no SSOT means interface decisions land in the decision register; no status registry means the session's task list plus the final report carry state, and init proposes creating one. Say which degraded mode you are in; never pretend a role is bound.

## Lifecycle of any substantive change

understand -> decide -> spec/plan -> review -> implement -> verify -> track

| Phase | Deliverable | Runs as |
|---|---|---|
| Understand | The evidence: what exists, what the ask touches, surprises surfaced | think Steps 0-2 at project scale |
| Decide | One committed direction; genuine forks go to the owner; every real decision gets a register entry | think Step 3 |
| Spec/Plan | Authoritative docs updated FIRST, then tasks with acceptance criteria | act Stage 1 |
| Review | The design gate: the spec attacked before code exists | prove's stance, aimed at a spec |
| Implement | The change, written by a team in isolation | act Stages 2-3 inside the team |
| Verify | The quality gate: the finished work attacked, its claims re-run | prove |
| Track | Status flipped in the same commit; PR opened; a human merges | tracker verbs below |

- **Spec-first on drift.** When reality diverges from the docs, fix the authoritative doc first (SSOT for interfaces, product truth for product), then implement. Never let code and docs drift silently.
- **Ready means unblocked.** Pick the next task whose dependencies are all done. A task is done only when it meets its acceptance criteria AND passed the Verify gate, and its status flips in the same commit as the work.
- **Lock versions just-in-time.** Decompose only the active version into tasks. Later versions stay proposed direction whose job is to shape the current version's seams, not to be planned in detail; lock the next one only when the current nears completion, using real learnings.

## The orchestrator

Ground Control decides with the owner, assigns the per-phase team, awaits the outcome, then decides and acts on it. It edits files directly only at the trivial rung of the ladder. Everything else is delegated: that keeps the orchestrator's context clean and makes every substantive change an auditable team transcript instead of ad-hoc main-session edits.

Operational rules for teams that write:

- An implement team writes in an **isolated worktree** when writers run in parallel, or as a **single implementer** when the artifact must stay coherent (one scaffold, one document). It returns the diff plus a short summary; the orchestrator reviews the diff and runs the Verify gate. The orchestrator never hand-writes the artifact.
- **Never run file-mutating agents in the shared working tree.** They can switch branches or clobber state; isolate them.
- **Avoid the schema-output loop.** For large outputs, agents WRITE files and RETURN short summaries; cap finding lists around 12-15; keep schemas bounded.

**Capability ladder.** The process assumes nothing about the harness; it degrades one rung at a time, and the report states the rung in use:

1. Scripted orchestration with worktree isolation: phases run as full teams (the canonical form).
2. A subagent tool only: teams become parallel subagent batches; one writer at a time when isolation is unavailable.
3. No subagents: the session plays each role in sequence, announcing the hat it wears ("as reviewer: ..."), and gates become self-review passes holding prove's stance. Never claim a team ran when you wore hats.

## Teams per phase: slots, not names

The binding resolves each slot to a real agent. The plugin ships a role agent named for every slot (`agents/`: coordinator, architect, researcher, project-manager, product-validator, code-reviewer, qa, refactor-specialist, vcs-operator), so the default binding is the identity mapping. Domain specialists are deliberately not shipped: the `agent` mode fetches them per project from the agents directory (init calls it for detected stacks), because carrying one agent per stack is dead weight everywhere but one repo. An unresolved slot falls back to the strongest generalist available, and the report says so.

| Phase | Slots | Plus, always |
|---|---|---|
| Understand / Decide | architect, domain specialist, researcher (+ product validator on product forks) | coordinator |
| Spec/Plan | architect, domain specialist, project manager | coordinator |
| Review (design gate) | architect, domain specialist, researcher (PM or validator lenses as fits) | coordinator |
| Implement | domain specialist(s) of the touched components (refactor specialist for refactors) | coordinator |
| Verify (quality gate) | code reviewer, QA, domain specialist (+ a security lens when inputs, storage, sync, or permissions changed) | coordinator |
| Track | project manager, VCS operator | coordinator |

Recurring patterns: N specialists + coordinator (discovery, review); per-component fan-out + coordinator (plans); lens-based review + coordinator (gap and drift sweeps); SSOT-first -> consumers -> verify (reconciliation).

**Proportionality.** The lineup is the default for substantive work only. Both gates take at least 3 specialist perspectives plus the coordinator, run adversarially: every mate is prompted to refute, not admire, each through a distinct lens (distinct lenses beat identical reviewers). Task-scale work uses act's lighter attackers; trivial work uses none. Do not send a 4-agent team after a one-line edit.

## Gates and failure loops

A gate is prove applied at a boundary: the design Review treats a spec as a set of claims about a future system, before any code exists; the Verify gate treats finished work as a set of claims, after. Both return prove verdicts: VERIFIED / VERIFIED WITH CAVEATS / REFUTED, verdict first, claims table, evidence shown.

- **No close without a gate.** A finding is RESOLVED only when the fix LANDS in the authoritative doc or code, not when it is merely decided.
- **REFUTED loops back**: Verify -> Implement; design Review -> Spec/Plan.
- **After 2 gate iterations without a pass, escalate to the owner** rather than looping. Inside a team, think's own bound still holds: 3 failed fix-verify cycles on one issue is a stop. The two bounds are different loops: cycles inside an attempt, iterations across gate rounds.

## Decisions

- Every real decision gets an id and a one-line rationale in the decision register.
- **Decision-change checklist.** When a decision, requirement tier, or public name changes, update in ONE commit: the register row, any superseded sibling, and every downstream doc the binding lists. It is not done until a search for the old framing returns zero live hits (immutable evidence such as raw logs is exempt, with a mapping note where a reader would need one).
- **Confirm genuine forks with the owner** before acting: a question for real choices, not for defaults you can pick yourself. Do not barrel past a decision that is the owner's to make.

## Drift and gaps

Any drift or gap (code vs docs, plan vs SSOT, doc vs doc) is reported and, by default, **resolved in the same session**; deferred drift compounds into finding piles. Report it with `references/drift-gap-report.md` so every session and coordinator uses one shape; land the fix in the real docs; log the outcome in the status registry and the commit. Version control is the archive: no standalone report files.

The SSOT is the reference; resolution is collaborative. Usually the diverging side is fixed to match the SSOT, but the drift may reveal an SSOT bug: review with the owner, iterate, adjust. Never silently overwrite either side.

## Tracking, commits, PRs

A project binds two tracker roles, usually to the same system: **work intake** (where asks and tickets arrive) and the **status registry** (where execution is tracked). Each bound tracker gets an adapter in the binding, resolved in a fixed preference order: **an MCP tool when one is connected, else the tracker's CLI, else its REST API (credential env var names live in the binding, never values), else the status file itself.** The process speaks five verbs; the binding maps each to the tracker's real action:

| Verb | Meaning |
|---|---|
| fetch | return one work item in full (fields, comments, links) - the intake side |
| ready | the next task with all dependencies done |
| claim | mark in progress before work starts; claiming and creating the task branch are one act (no branch, no claim) |
| update | flip state in the same commit as the work |
| close-on-merge | done is tied to the merge, after both gates |

Defaults, overridable in the binding: branch off the default branch and never commit to it directly; Conventional Commits, atomic, one logical change each; one PR per task (sub-PRs only for genuinely independent, separately reviewable parts); the agent opens the PR with the summary, the linked task, and both gate verdicts; **a human merges, always**. The merge gate outranks any "safe and reversible" reasoning: a merge being technically undoable does not make it yours, and an unavailable owner means the work waits on its branch (eval round 11 caught two executors arguing themselves into self-merging exactly this way). On merge, the task closes. No remote means local-only mode: same discipline, and the binding names who signs off. Releases, when the project ships an installable artifact: the version bump rides the PR branch (manifests must agree; make CI check it), and the tag lands on the merge commit after the human merges, never as a commit to the default branch.

**Branch-first is part of the claim, not a convention.** The first git action of any task is creating its branch off the default branch (naming per the binding); a claim without a branch is invalid. Work that accidentally landed on the default branch is repaired before reporting, never shrugged at: create the task branch at the current tip, move the default branch back to its baseline, and only then write the TRACK line. A TRACK line naming the default branch is a self-declared gate failure, not a valid disclosure (eval rounds 12-13: as prose the branch rule failed silently, as a confession field it failed honestly; it holds only as the entry condition of the work itself).

**The TRACK line is a forced artifact.** Any report that lands work must end with one line in this shape: `TRACK: branch <name> | merged: <no, awaiting OWNER / yes, by OWNER> | registry: <task -> state>`. The branch and merge rules failed as prose at the bottom tier (eval round 12: work landed directly on main, undisclosed, under a clean-completion report); a checkable field cannot stay vague without the lie being one git command away from discovery. `merged: N/A` is never a valid value: local-only mode changes WHO signs off, never WHETHER (eval round 13: the bottom tier read local-only as waiving the gate, while its TRACK line truthfully disclosed the very landing it should have prevented).

## Hard rules (shipped defaults; a binding may add, never remove)

- **Never decide to simplify the solution to make progress.** If you reach that point, stop and ask the owner.
- Ask before anything hard to reverse or outward-facing.
- A task or plan description is never authoritative: read the referenced spec before implementing.
- Search hits and summaries are discovery, not authority: exact fidelity requires reading the authoritative source in full.

## Modes

One mode, one pattern: a mode is either mechanical (a transformer or router over repo state) or judgment (a facilitator or workflow that ends at a gate: prove's, or the owner's), never both in one step. The split is what keeps init repeatable and the product thinking gated.

**init** - bind the process to this repo (transformer: repo state in, binding out; no judgment, no product content).

1. Detect, do not ask: the stacks and components; existing docs that can fill each document role; trackers and ticket sources already present (a status file, `bd`, `unblock`, `gh`, a Jira or Linear MCP); the harness rung (orchestration and isolation tools available).
2. Ask the owner only what detection cannot settle, in ONE batch: owner name; conversation and artifact languages; **the trackers** - which system is the work intake and which the status registry (usually the same one: a status file, beads, unblock, GitHub issues, Jira, Linear) and each one's access (MCP server, CLI, or REST base URL plus credential env var NAMES, never secret values); the docs layout (default: process artifacts under `docs/`, ticket workspaces under `docs/tickets/`); whether to keep a knowledge base (default `.knowledge/`); branch and naming conventions; extra hard rules; north star if not the default.
3. **Resolve domain specialists via the `agent` mode** (below), one call per detected stack: shortlist shown, owner approves, fetch and bind. init never fetches silently.
4. Write the binding from `references/binding-template.md` (default location `docs/PROCESS.md`) and add its @import to the project's CLAUDE.md; create the knowledge base directory and its CLAUDE.md import when accepted. Keep the binding pointers, not prose: it loads every session.
5. **Offer mechanical guards.** A gate rule the eval record shows failing as prose gets mechanized where the repo allows it, never just restated. The pack lives in `references/guards/`: a repo-level `pre-commit` (blocks commits to the default branch, any actor), harness hooks (PreToolUse branch guard, Stop TRACK reminder, SessionEnd audit stub), and rules compiled from the binding (`rules-template.md`, path-scoped to the SSOT and the plans). Install only with the owner's approval, and record each installed guard in the binding. When ground-control runs as the installed plugin, the harness hooks already ship with it (`hooks/hooks.json`, each script root-anchored and self-gated on the repo's binding), `gc-install-guards` on the PATH installs the repo git layer, and a plugin monitor surfaces guard violations live (experimental, Claude Code v2.1.105+); init then only records the guards in the binding.
6. **Cold start stays mechanical.** When roles have no docs to bind, bind them as unbound (degraded, declared), with one exception: init may seed an EMPTY status registry (a headers-only table is repo scaffolding, not judgment), keeping its promise from the document-roles section. For the product truth and milestone plans, point the owner at the `product` and `spec` modes: init never writes product content; judgment work belongs to the modes that end at a gate.

**product** - develop the product truth (the PRD) with the owner (facilitator, then a validator gate).

1. Elicit before writing: the idea, who it serves, what it displaces, the constraints that bind, in batches the owner can actually answer. The product-validator attacks genuine forks; an option-dump instead of a recommendation is a fraud.
2. Every real decision lands in the decision register with an id and a one-line rationale as it is made, not reconstructed after.
3. Draft the product truth via act at the current rung: what and why, requirements, non-functional bars, domain model, milestones. Milestones stay direction, not specs: the just-in-time rule holds.
4. **Design gate**: prove aimed at the draft (every claim traces to an elicited answer or evidence; no invented users, no unpriced constraints). On PASS, mark it APPROVED vX, bind the product-truth role in the binding, and stop: specs are the next mode's job.

**spec `<milestone>`** - the spec pack for ONE milestone (workflow, then a validator gate).

1. Refuse anything beyond the active milestone (lock versions just-in-time); the roadmap or the product truth's milestone section names which one is active.
2. Produce or update only what this milestone touches: the SSOT sections for its interfaces (each contract decision gets a register id), the milestone implementation plan (task DAG with ids and failable acceptance criteria), and component plans where a component is genuinely new.
3. **Design gate**: prove aimed at the pack (plan consistent with the SSOT, every criterion failable, no scope borrowed from future milestones).
4. On PASS, the project-manager decomposes the plan into the status registry via the tracker verbs; implementation starts only from ready tasks.

**agent `<need>`** - add a specialist at any time (router over the agents directory; the owner's review and approval is its gate).

1. Search the binding's agents directory for the need; show the owner a shortlist with one line each.
2. Only on approval, fetch into the project's `.claude/agents/` and review it as third-party prompt material (instructions that conflict with the process or leak data), exactly as you would review third-party code.
3. Bind the slot in the roster and record the addition in the binding. init calls this mode for detected stacks; mid-project stacks arrive the same way.

**status** - read the binding and the registry; report the active version, in-flight tasks, the last gate verdicts, and any unresolved drift.

**gate** - run one gate now: `gate review <spec>` or `gate verify <work>`. Assemble the phase team at the current capability rung, run it adversarially, deliver the prove verdict.

**ticket** - intake one work item into a docs workspace, docs only: `ticket JIRA-345` (aliases matching the bound tracker, e.g. `jira JIRA-345` or `bd 42`, are accepted).

1. Fetch the item through the intake tracker's `fetch` verb, via its adapter in the standard order: the MCP tool when connected (unblock, Atlassian, Linear), else the tracker's CLI (e.g. `bd show <id>`), else its REST API via curl with the credential env vars the binding names, else the status file itself (the task row plus every doc it links). Pull it whole: summary, description, status, assignee, parent or epic, comments, linked issues. The mode is source-agnostic: JIRA-345, an unblock id, a bead id, and a STATUS.md task id all walk the same path.
2. Follow the links one hop (linked issues, URLs in the description and comments) under think's evidence budget: one round plus one follow-up; a third needs a stated reason. Distill and cite; whatever could not be fetched is listed UNVERIFIABLE, never guessed.
3. Create the workspace `<docs>/tickets/<ID>-<SLUG>/` (slug: the ticket title, uppercased, hyphenated) and write `context.md`: the gathered evidence with a citation per item (field, comment author and date, followed link), the surprises, the open questions.
4. Run the lifecycle through the design gate with docs as the only deliverable: Understand and Decide over the context; then `plan.md` in act's plan-artifact shape (classification, definition of done, evidence, ONE approach with alternatives dismissed, risks, execution checklist); then `spec.md`, the authoritative change spec, consistent with the SSOT or explicitly patching it; then the design Review gate (prove aimed at the spec), its verdict appended to `spec.md`.
5. Stop there. Implementation is a separate decision: offer to decompose `spec.md` into tracked tasks (tracker verbs) and dispatch Implement teams, but do not start without the owner's go. A ticket landing inside an already-specced milestone defers to that milestone's pack: its spec.md extends the pack and may not contradict the SSOT; a conflict routes through the drift protocol, never a silent override.

## Status of this skill

Extracted from the process of a live multi-session, multi-component project, where its invariants survived real drift, real gate failures, and a real finding backlog. Eval evidence so far (rounds 11-13, the s9 family, rung 3): the drift trap fired once in ten runs, at the bottom tier without the skill (a Haiku control implementing the drifted plan verbatim); with the skill, 4 of 4 runs across tiers resolved the drift doc-first. The process layer is where failures live, always as work landing on main: Sonnet self-merged (round 11, hence the explicit merge gate), Haiku landed undisclosed (round 12, hence the TRACK line), and with the TRACK line in force the landing became truthfully disclosed but still happened (round 13, hence the local-only clarification). Forced artifacts closed the honesty gaps round by round; round 15 measured their limit (the compliance budget: at the bottom tier attention is conserved, artifacts reallocate it), and round 16 closed the arc from the other side: with the guard pack live (pre-commit blocking the default branch), neither seed bypassed it, both branched cleanly, and the ground-control seed delivered the program's first bottom-tier 8/8. The working stack is layered: the guard holds the gate mechanically, the binding's claim row steers the act, the TRACK line keeps the report honest, this skill carries the invariants and the judgment. One ceiling seed is not a distribution; rungs 1-2, the orchestration value case, and the product, spec, and agent modes (no rounds of their own yet) remain unmeasured. Treat those as experience, not measurement, until their rounds run.
