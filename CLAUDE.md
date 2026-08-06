# CLAUDE.md, major-tom

Operational contract for any session working in this repository. Keep it lean: pointers
over prose, the authoritative detail lives in the documents mapped below.

## North star

Correctness and completeness over speed. Never decide to simplify the solution: at any
point where simplifying seems necessary, stop and ask Miguel.

## Working model

The main session orchestrates and delegates to sub-agents to implement. It decides with
Miguel, assigns the work, reviews the outcome; it does not hand-write substantive changes
itself.

## Lifecycle of any change

understand, then decide, then spec/plan, then review, then implement, then verify. No
phase skipped silently.

- Every real decision gets a D-id in the PRD decision log with its rationale. Decisions
  close only through new entries, never silent edits; superseding entries cross-reference
  both ways.
- Every iteration bumps the PRD version and adds a changelog row.
- Never claim mechanisms that do not exist: docs and templates state only what is built.

## Document map

| Doc | Role |
|---|---|
| `docs/PRD.md` | Product truth: decisions (D-ids), open questions (OQ-ids), changelog. Read before working. |
| `templates/README.md` | Rendering contract: grammar, whitespace semantics, snapshot schema, authoring split. |
| `plugins/major-tom/workflows/README.md` | Workflow script API contract and hard runtime constraints. |
| `assets/major-tom-design/` | Dashboard visual spec (reference only; its runtime never ships). |
| `temp/` | Read-only archive from before the reset. Off limits. |

## Conventions

- Ship flow: create a branch, atomic Conventional Commits, push, open the PR. Bump the
  plugin and marketplace manifest versions with the PR (D30 cadence). After the merge:
  sync main, delete the branch, create the tags (`claude plugin tag plugins/major-tom`
  for `major-tom--vX.Y.Z`, plus the lineage tag `vX.Y.Z`) and push them.
- Generated artifacts are never edited by hand: `templates/dashboard.html` comes from
  `templates/dashboard/` via the build; `plugins/*/templates/` come from `templates/` via
  the sync.
- No em or en dashes in repository files; grep after every edit batch.
- Converse in Portuguese; write all artifacts (code, docs, commits) in English.

## Checks before any commit

```
node scripts/build-dashboard.js --check
node scripts/sync-templates.js --check
claude plugin validate plugins/major-tom
grep -rn $'\u2014\\|\u2013' <edited files>   # em/en dash check, must return nothing
```

Plus, when the touched surface has one: the schema fixture suite (ajv strict,
strictRequired off) and the dashboard DOM-stub suite; both are recreated from the PRD
descriptions when no longer on disk.
