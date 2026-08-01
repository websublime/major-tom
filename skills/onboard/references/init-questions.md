# onboard question sheet

onboard: present the block below to the owner verbatim, in ONE batch; never summarize, condense, or drop any menu option.
Pre-fill a slot only when detection settled it, and mark it "detected:"; leave every other slot for the owner. For a menu, never remove or collapse options: mark the detected option in place (check its box and append "detected:") and keep all other options listed.

```
onboard needs the answers detection cannot settle. Fill each slot; check the box for what applies.

1. Owner (genuine forks and escalations go here): <name>

2. Languages
   - Conversation language: <language>
   - Artifact language (code, docs, commits): <default: English>

3. Working model: how should the session delegate substantial work? Check one.
   - [ ] team: specialists run in parallel, each in an isolated worktree; the coordinator orchestrates
   - [ ] subagents only: the coordinator delegates discrete tasks to subagents, one writer at a time, on a single branch

4. Issue tracker: do you use one? Check one.
   - [ ] no
   - [ ] jira
   - [ ] linear
   - [ ] github issues
   - [ ] beads (bd)
   - [ ] unblock
   - [ ] status file
   If yes, record how the session accesses it, first that applies: MCP server when connected; else its CLI; else a REST base URL plus credential env var NAMES (never values); else the status file itself.
   - Access: <MCP server name | CLI command | REST base URL + env var names (never values) | status file path>

5. Docs layout
   - Process artifacts: <default: docs/>
   - Design artifacts (where a spec or decision record lands): <default: docs/specs/, or "unbound">
   - Recorded runs (a pre-registered experiment and its evidence): <default: docs/runs/<date>-<slug>/, or a non-default branch if this repo is distributed from its default branch, or "unbound">

6. Document roles: which existing document carries which authority? Leave a role unbound rather than pointing it at something that is not actually authoritative; a role can be bound later by re-running onboard.
   - Product truth (what the project is for, and why): <path, or "unbound">
   - Decision register (the numbered decisions, D1, D2 and so on): <path to one file, or "unbound">
   - Interface SSOT (the contracts between components): <path, or "unbound">
   - Component plans (how each piece gets built): <pattern, e.g. docs/plans/<component>.md, or "unbound">

7. Knowledge base: keep one?
   - [ ] yes: <default path: .knowledge/>
   - [ ] no

8. Branch and naming conventions: <default: t<id>-<slug> off the default branch>

9. Extra hard rules (additions only; the shipped hard rules cannot be removed): <rule, or "none">

10. North star: <default: correctness and completeness over speed>
```
