---
type: Fact
title: An invoked skill stays in context
description: a skill body is a one time load with a permanent session cost, and compaction drops the earliest invoked skill first
tags: [skills, context, compaction, measured, version-dependent]
status: stable
---

# An invoked skill stays in context

From the Claude Code skills documentation, read 2026-07-27: when a skill is invoked, the rendered `SKILL.md` content enters the conversation as a single message and stays there for the rest of the session. Claude Code does not re-read the file on later turns. A skill body is a one time load with a permanent cost, not a per turn cost.

Bodies measured in this repo that day, at this commit: think 13,375 chars (about 3,343 est. tokens), prove 5,662, act 5,283, onboard 3,509. `act` instructs the reader to open think's SKILL.md first, so invoking act lands both.

Auto-compaction re-attaches invoked skills within a budget: the first 5,000 tokens of each, 25,000 tokens combined, filled starting from the most recently invoked. On a long run the EARLIEST invoked skill is dropped first. For an orchestrator skill invoked at the start of a long run, that is the orchestrator's own body: the run can lose its driver silently while the model keeps writing as though it were still orchestrating.

Two consequences for skill design here. Keep an orchestrator body small enough that its first 5,000 tokens are the whole thing. Prefer delegating a stage to a spawned subagent over invoking a second skill inline: a spawn costs the parent only the dispatch prompt and the returned summary, never the subagent's internals, while an invocation is permanent. See [spawn-provenance](spawn-provenance.md).

Frontmatter detail with the same shape: `user-invocable: false` hides a skill from the `/` menu but keeps its description in context. Only `disable-model-invocation: true` removes the description. A model only helper skill is therefore not free.
