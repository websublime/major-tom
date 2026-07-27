# Spawn provenance is measurable

Measured 2026-07-27 on claude 2.1.220, by two probes run in this repo.

A subagent CAN spawn a subagent. A headless `claude -p` session with `--allowedTools Agent --output-format stream-json --verbose`, asked for a nested spawn, produced one: the inner agent had the `Agent` tool loaded and returned its result. The gc-iron calibration (2026-07-23, claude 2.1.209) had settled only the top level case.

Spawns form a TREE in the stream, not a flat list. Both spawn events appeared in the parent stream, discriminated by `parent_tool_use_id`: null for the one the main session issued, the outer agent's tool_use id for the one the subagent issued. This corrects the `gc-iron-spec` note that a subagent's internal steps do not reach the parent transcript: its own spawn calls do, with parent attribution. A judge can therefore count a delegation's fan-out, not only its top level spawn.

Scope caveat, measured the same day: Workflow agents do NOT have the Agent tool. A probe running as `general-purpose` inside a Workflow got "Task exists but is not enabled in this context" for both `Agent` and `Task`. The restriction belongs to the Workflow harness, not to subagents in general. Consequence for any orchestrator: delegate through the Agent tool, never through Workflow, or the delegate loses its own fan-out.

Two harness hook events serve this and were not recorded here before: `SubagentStart` (fires when a subagent is spawned) and `SubagentStop`, both matching on agent type. Every hook payload carries `agent_id`, documented as present only when the hook fires inside a subagent call. So a `SubagentStart` hook can write a spawn ledger the model cannot author, and a `PreToolUse` hook on `Edit|Write` can block main thread edits by testing for the absence of `agent_id`. That is the mechanical instrument the [delegation-as-prose](delegation-as-prose.md) diagnosis lacked, and it is why an orchestration layer is checkable now in a way it was not in 2026-07.

The calibration precondition in `eval/archive/workflow-s10.js` (a headless spawn visible via `grep -c` on the Agent tool_use event, at least one) is satisfied on 2.1.220: the probe scored two.
