# Workflow script API reference

The contract `onboard.js` (and any future workflow here) is written against. Sources:

- Guide (the only dedicated public page): https://code.claude.com/docs/en/workflows
- Agent SDK reference, Workflow tool entry: https://code.claude.com/docs/en/agent-sdk/typescript
- Docs index for discovery: https://code.claude.com/docs/llms.txt

plus the Workflow runtime contract itself.

## Invocation

- Scripts in this `workflows/` directory at the plugin root are a native host surface: no
  skill wrapper is needed (verified by owner's local test, and by the docs section
  "Distribute a workflow in a plugin").
- Plugin workflows are namespaced by plugin name: `meta.name: 'onboard'` in the `major-tom`
  plugin runs as `/major-tom:onboard`. A script saved to a project's `.claude/workflows/`
  runs as bare `/onboard`.
- Requires Claude Code v2.1.154 or later, with dynamic workflows enabled. Organizations can
  disable workflows (`disableWorkflows`); the command does not exist there. Known limitation.

## The `meta` export

Must be the first statement. A pure literal: no variables, calls, spreads, or interpolation.

```javascript
export const meta = {
  name: 'onboard',              // required, becomes the command name
  description: 'One line',      // required, shown in the permission dialog
  whenToUse: 'Optional hint',   // optional, shown in the workflow list
  phases: [                     // optional, one entry per phase() call
    { title: 'Check', detail: 'optional subtitle', model: 'optional override' },
  ],
}
```

`phases[].title` is matched exactly against `phase()` calls in the body; a `phase()` call
with no matching entry still gets its own progress group.

## Script body globals

Plain JavaScript, not TypeScript (type annotations fail to parse). Top-level `await` works.
The script returns a value; that value is the run result delivered to the session.

| Global | Signature | Notes |
|---|---|---|
| `agent` | `agent(prompt: string, opts?): Promise<any>` | Spawns one subagent. Returns its final text as a string, or, with `opts.schema` (a JSON Schema), the validated object. Resolves to `null` if the agent is stopped mid-run or dies on a terminal API error; always `.filter(Boolean)` collections. |
| `pipeline` | `pipeline(items: any[], ...stages): Promise<any[]>` | Runs each item through all stages independently, no barrier between stages. Each stage callback receives `(prevResult, originalItem, index)`. A stage that throws drops that item to `null` and skips its remaining stages. Default choice for multi-stage work. |
| `parallel` | `parallel(thunks: Array<() => Promise<any>>): Promise<any[]>` | Concurrent execution with a barrier: awaits all thunks. A thunk that throws resolves to `null` in the result array; the call itself never rejects. Use only when a stage genuinely needs all prior results together. |
| `phase` | `phase(title: string): void` | Starts a progress group for subsequent `agent()` calls. Inside concurrent stages use `opts.phase` per agent instead, to avoid racing the global state. |
| `log` | `log(message: string): void` | Progress line shown to the user above the progress tree. |
| `workflow` | `workflow(nameOrRef: string \| {scriptPath}, args?): Promise<any>` | Runs another workflow inline as a sub-step. One nesting level only. Shares the parent's concurrency cap, agent counter, and budget. |
| `args` | `any` | The invocation input, passed as structured data (arrays and objects arrive as values, not JSON strings). `undefined` when not provided. |
| `budget` | `{total: number \| null, spent(): number, remaining(): number}` | Token target when the user set one. Hard ceiling: once `spent()` reaches `total`, further `agent()` calls throw. `remaining()` is `Infinity` with no target; guard loops on `budget.total`. |

### `agent()` options

| Option | Type | Effect |
|---|---|---|
| `label` | string | Display label in the progress view |
| `phase` | string | Progress group assignment (same string, same group) |
| `schema` | object (JSON Schema) | Forces structured output; the return value is the validated object, retried on mismatch |
| `model` | string | Model override for this agent; omit to inherit the session model (almost always correct) |
| `effort` | `'low' \| 'medium' \| 'high' \| 'xhigh' \| 'max'` | Reasoning effort override; omit to inherit |
| `isolation` | `'worktree'` | Fresh git worktree for the agent; expensive, only for parallel file mutation |
| `agentType` | string | Use a custom subagent type from the agent registry instead of the default workflow subagent |

## Hard constraints

| Constraint | Consequence for onboard |
|---|---|
| No filesystem or shell access from the script itself | Every write (config file, `.knowledge/` bootstrap, rendered templates, dashboard) is performed by an `agent()` the script spawns with a precise prompt. The script only coordinates. |
| No Node.js APIs, no `Date.now()`, no `Math.random()`, no argless `new Date()` | They would break resume determinism; they throw. Timestamps (e.g. `onboard.completedAt`) must be produced by an agent or passed in via `args`. |
| No mid-run user input | Only agent permission prompts can pause a run. The interview therefore cannot happen inside the workflow; see the PRD onboard design for where the interview lives. |
| No `${CLAUDE_PLUGIN_ROOT}` substitution in workflow scripts or `agent()` prompts | Substitution is documented only for skill/agent content, hook and monitor commands, and MCP/LSP server configs. Path resolution goes through a plugin agent (`onboard-check`) whose markdown does get the substitution; it reports the absolute plugin root and the script threads it into prompts (D23). |
| Installed plugins cannot reference files outside their directory | The plugin cache copies only the plugin dir; `../` paths die after install. Anything the workflow needs at runtime (schema, templates) must live under the plugin root; repo-root sources are synced in via `scripts/sync-templates.js` (D23). |
| Up to 16 concurrent agents (fewer on small machines) | Excess calls queue; all complete. |
| 1,000 agents per run; 4,096 items per single `pipeline()`/`parallel()` call | Runaway backstops. |
| Subagents run in `acceptEdits` mode and inherit the session's tool allowlist | File edits by agents are auto-approved; unlisted shell commands can still prompt mid-run. |

## Resume semantics

Every run persists its script and each agent's result. Relaunching with the same script
resumes: completed `agent()` calls with unchanged (prompt, opts) return cached results,
replayed in start order up to the first agent that did not finish; everything after that
point runs live. Same-session only: exiting Claude Code starts fresh. Fan-out across many
small agents therefore preserves more progress than one long agent.
