---
name: lifecycle
description: The five phases that carry settled work to merged - distribute it across the roster behind a gated design, do the work, capture what was learned into the knowledge base, verify adversarially, and finalize with tests, atomic commits and a merge request carrying the verdicts. Runs on the goal, the classification and the entry point that intent settled, and will not start without them. Use on "/lifecycle", or proactively when the answer to any of these is yes. Is the goal already settled and the work now needing to be carried to done? Does the work produce or edit real artifacts someone will merge? Should the result be attacked before it ships rather than after it breaks? Does the finished work need tests, commits, and a merge request? Is the next step delegation rather than more thinking?
user-invocable: true
---

# Lifecycle

The five phases that carry work from a settled goal to merged. Every project-specific value lives in the binding `docs/PROCESS.md`: which agent runs which phase, which document carries which authority, which tracker holds the work, how large a gate is, how many repair rounds precede escalation, and who the Owner is. **Read the binding first.** An unbound slot degrades and the session declares the degraded mode; it is never invented and it never blocks.

The rules governing each individual step are `think`'s. This skill says which phases run, who runs them, what gates them, and what happens when a gate fails.

## Entry: what this skill will not start without

Three things from `intent`: the goal in one sentence, the classification, and where the work enters. **If they are absent, run `intent` first and do not proceed until it hands them over.** This is what stops the front door being bypassed by invoking this skill directly. An empty goal sentence is not a settled goal.

## Phase 1 - DISTRIBUTE

Turn one settled goal into work that specific agents can pick up, and do not hand out a design nobody attacked.

1. **Produce the plan:** what will be built, and the acceptance criteria that can fail. Criteria that cannot fail are not criteria. Where the binding binds a Decision register, a genuine decision goes in it with its rationale, and a genuine fork goes to the Owner first.
2. **Decompose** into pieces that can be worked independently, with their dependencies stated. Where the tracker supports it, each piece becomes a task with its acceptance criteria on it.
3. **Gate the design.** This is the first of two gates: adversarial, run by agents that did not write the plan, at the size the binding names. A failed design gate returns to step 1 of this phase. See Gates below.
4. **Assign** each piece to the team the binding's Lifecycle section names, under the working model it records (a team in isolated worktrees, or subagents on a single branch, with the coordinator orchestrating either way). Where the tracker supports claiming, claim before starting, so two sessions cannot take the same piece.

## Phase 2 - WORK

Run `act`. Its execution rules apply in full: the intent gate before any behavior change, the smallest correct change, precise edits, never destroy without looking first. Writers that could touch the same files run isolated. A surprise mid-execution is said out loud and re-routes the plan; it is never forced through.

## Phase 3 - CAPTURE

**A running collection, not a single write.** It opens when the lifecycle starts and stays open through Verify and into Finalize, because a gate that finds something new has taught you something too, and so has a repair round. This phase is where what has accumulated so far is consolidated. The filing into the knowledge base happens in Finalize.

- **Add as you learn, not at the end.** A behavior that was not what you expected, a constraint nobody had written down, a trap that cost time, a correction the user made: one entry of a sentence or two, at the moment it happens. Anything left to be remembered later is lost.
- **Where the collection lives while it is open:** the task's comment thread when the tracker supports recording an outcome, otherwise a scratch note. It is working material and not yet the knowledge base, so nothing here is quotable as knowledge until it is filed.

Filing, in Finalize, sends each entry to a destination with the category it belongs to:

| Destination | What belongs there |
|---|---|
| A memory file, one fact each | Something still true next month, stated as a fact with why it holds |
| A run record | What this run attempted, what happened, the traps hit |
| A topic page | An operational procedure a future session would follow |
| A domain page | Knowledge about the problem area rather than about this run |

- **Never normative.** The knowledge base describes how things went and how things behave. Rules, interfaces and decisions live in the documents the binding's Document roles name; nothing normative may originate here.
- **An entry that fits no destination is dropped out loud,** named in the report, never forced into the nearest file to look thorough.
- **Lands with the work,** in the same commit Finalize makes, not in a later cleanup that never comes.

### The file format

The knowledge base is one **Open Knowledge Format** bundle (OKF v0.2, https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md), unless the binding's Knowledge base slot names another format. A bundle is a directory tree of markdown files; each file is one concept, YAML frontmatter then a body; concepts link with ordinary markdown links.

- **`type` is the only required key** and it must be non-empty. Values are not registered anywhere: pick one that describes the concept, and reuse the ones the binding already lists so a reader can filter.
- **Recommended on every concept:** `title`, `description` (one sentence, because the index reuses it), and `tags`. `resource` only when the concept describes a thing that has a URI.
- **`index.md` and `log.md` are reserved** and may never be a concept's filename. An `index.md` carries **no frontmatter at all**, except the bundle-root one which may carry `okf_version` and nothing else. Its body groups entries under headings, each entry a link plus the linked concept's own description.
- **Record who produced it and who confirmed it,** because the lifecycle already knows both: `generated: {by, at}` is the agent that wrote the concept, and `verified` is a list of `{by, at}`, one entry per gate attacker. These are kept apart on purpose, since the writer is never the confirmer. Actors are written `<producer>/<version>` for an agent or tool, `human:<id>` for a person, `process:<id>` for an automated process; consumers read trust off the `human:` prefix, so use it for anything a person wrote or signed off.
- **If you do not know an actor, omit the field.** It is optional, and an invented actor is worse than an absent one.
- **`status`** is `draft`, `stable` (the default when absent) or `deprecated`. Set **`stale_after`** to an absolute `YYYY-MM-DD` date only when the concept genuinely expires, for instance a measurement pinned to a tool version. Do not invent a date to fill the field.

## Phase 4 - VERIFY

Run `prove`. This is the second gate: adversarial, run by agents that did not do the work, at the size the binding names. The verdict is `prove`'s three words and nothing else: **VERIFIED**, **VERIFIED WITH CAVEATS**, **REFUTED**. Where the binding records a front-matter grammar for declaring a gate result, the verdict is written there verbatim with the attackers and the author named.

## Phase 5 - FINALIZE

1. **File the capture collection.** Close what Capture has been accumulating: send each entry to its destination in the knowledge base with its category, per the table in Phase 3, and say which entries were dropped for fitting nowhere. Entries added during Verify and during any repair round are filed here too, which is why the collection stays open until now.
2. Run the tests, the build, and the linters the project actually uses. Record the real output. A check that cannot be run is labeled unverifiable, never assumed to pass.
3. Atomic commits in the project's convention, one logical change each, carrying the filed knowledge alongside the work, on a branch named per the binding. Never commit to the default branch.
4. Record the outcome on the task through the tracker, and close it when the work merges.
5. Open the merge request carrying both gate verdicts. **Pushing and opening are outward-facing: they need the Owner's explicit go.** A human merges.

## Gates

Two phases are gates: **Distribute** gates the design before the work starts, **Verify** gates the result after. Both are adversarial and both are run by agents that did not produce what is under review. **The author is never an attacker.**

- **Size.** The binding's Lifecycle section names the minimum number of attacking agents plus the coordinator. Where it does not, the default is three plus the coordinator.
- **Proportionality.** That size is mandatory for substantive work: anything touching a public interface, a contract or a spec, or several files or components. A one-line mechanical edit does not get a four-agent gate.

## The repair loop

A gate that does not pass **returns the work to the phase before it**: Verify returns to Work, the design gate returns to the start of Distribute. That is the loop, and it has a bound.

1. Fix what the gate named, then re-run **the same gate with the same lenses**. Count the round.
2. At the bound the binding names (default: two rounds without a pass), **stop and escalate to the Owner.** Do not start a third round on your own authority. A loop that will not converge is information, and it belongs to the Owner.
3. Three things are forbidden inside the loop, because a repair round is exactly where they happen:
   - **Never shrink the gate to make it pass:** fewer attackers, a softer lens, a skipped check.
   - **Never rewrite the acceptance criterion to match the result.** The criterion came from the plan; the result answers to it, not the reverse.
   - **Never carry an unfixed finding forward as "known".** A finding is resolved when the fix lands in the authoritative document or the code, not when it is decided.

## The tracker

The lifecycle asks four things of whatever tracker the binding records. What the tracker cannot do degrades and is declared where it is needed; it does not block.

| Operation | Used by | When the tracker cannot do it |
|---|---|---|
| Next ready work | `intent`, resolving "the next task" | Say so, and ask the user which work to take |
| Claim | Distribute, before a piece is started | Say so. Concurrent sessions are then the user's risk to manage. |
| Record an outcome | Every phase result and both gate verdicts | Record it in the run record instead |
| Close | Finalize, tied to the merge | Say so, and report the state the task was left in |

With no tracker there is no state between sessions, so there is no queue and no repetition over one. Say that plainly rather than simulating a queue in conversation.

## Hard rules

- **Never decide to simplify the solution.** At the point where simplifying looks necessary, stop and ask the Owner.
- **A task description is never authoritative.** Read the document the binding's Document roles point at before implementing what a ticket says.
- **Ask before anything hard to reverse or outward-facing:** publishing, pushing, deleting, sending.
