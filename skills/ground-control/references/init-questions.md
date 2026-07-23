# init question sheet

init: present the block below to the owner verbatim, in ONE batch; never summarize, condense, or drop any menu option.
Pre-fill a slot only when detection settled it, and mark it "detected:"; leave every other slot for the owner. For a menu, never remove or collapse options: mark the detected option in place (check its box and append "detected:") and keep all other options listed.

```
Ground Control init needs the answers detection cannot settle. Fill each slot; check the box for what applies.

1. Owner (genuine forks and escalations go here): <name>

2. Languages
   - Conversation language: <language>
   - Artifact language (code, docs, commits): <default: English>

3. Trackers: which system is the work intake, and which is the status registry (usually the same one). Check one box per role.
   Work intake:
   - [ ] status file
   - [ ] beads (bd)
   - [ ] unblock
   - [ ] GitHub issues
   - [ ] Jira
   - [ ] Linear
   Status registry:
   - [ ] status file
   - [ ] beads (bd)
   - [ ] unblock
   - [ ] GitHub issues
   - [ ] Jira
   - [ ] Linear
   Access per chosen tracker, first that applies: MCP server when connected; else its CLI; else a REST base URL plus credential env var NAMES (never values); else the status file itself.
   - Work intake access: <MCP server name | CLI command | REST base URL + env var names | status file>
   - Status registry access: <MCP server name | CLI command | REST base URL + env var names | status file>

4. Docs layout
   - Process artifacts: <default: docs/>
   - Ticket workspaces: <default: docs/tickets/>

5. Knowledge base: keep one?
   - [ ] yes: <default path: .knowledge/>
   - [ ] no

6. Branch and naming conventions: <default: per the binding template, e.g. t<id>-<slug> off the default branch>

7. Extra hard rules (additions only; the shipped hard rules cannot be removed): <rule, or "none">

8. North star: <default: correctness and completeness over speed>

9. Agent budget: max concurrent agents per team phase (counts spawned team agents; the coordinator, the orchestrating session, does not count). Minimum 3; init cannot record less.
   - Budget: <N, minimum 3>
```

init follow-through for the agent budget (init-facing, not part of the owner form):
- On any answer below 3, re-ask ONCE, emitting the refusal text below unchanged.
- If the owner still insists on a lower number, bind 3 (the floor) and record the owner's infrastructure note beside the budget line in the binding. No path records a value below 3.
- A tighter infrastructure limit is never a budget value: it becomes sequential sub-batches at execution time.

Refusal text (emit verbatim):
> The process's hard rules fix a gate minimum of 3 distinct adversarial perspectives, and a binding may add rules, never remove them, so I cannot record a budget below 3. If your infrastructure cannot run 3 agents at once, I will record 3 with your note, and oversized lineups will run as sequential batches.
