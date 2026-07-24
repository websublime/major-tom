# STATUS: live task registry

Conventions: ready = unchecked task whose dependencies are all checked. Update a task's row in the same commit as the work it tracks (see docs/PROCESS.md, trackers).

| Id | Task | Deps | State |
|---|---|---|---|
| T1 | core store: models + load_entries per docs/plans/core.md | - | [x] done |
| T2 | report: summarize_by_day per docs/plans/report.md section 1 | T1 | [ ] ready |
| T3 | report: total_cents per docs/plans/report.md section 2 | T2 | [ ] blocked |
| T4 | CLI output per docs/plans/report.md section 3 | T2, T3 | [ ] blocked |
