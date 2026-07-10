# Rules compiled from the binding (Claude Code)

init writes these into the project's `.claude/rules/`, substituting the paths from the binding's document-role map. Path-scoped rules load at the moment the matching file is touched: prose with placement at the decision point (the eval's round-14 lesson taken to its limit). They remind; the hooks in this directory enforce.

## ssot.md

```markdown
---
paths: <interface SSOT path, e.g. docs/design-spine.md>
---
This file is the interface SSOT. A component plan disagreeing with it is the bug, not this file. Never edit this file to make it match a plan: surface the drift per the binding's drift protocol, fix the plan, or escalate a suspected SSOT bug to the owner.
```

## plans.md

```markdown
---
paths: <component plans glob, e.g. docs/plans/**>
---
Component plans lose to the SSOT and the product truth on any disagreement. Before implementing from this plan, open the SSOT section it implements; if they disagree, the plan is the bug: fix it first, then implement. A task description pointing here is never authoritative.
```
