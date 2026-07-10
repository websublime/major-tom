# Session audit - <date> <slug>

One file per working session in `<knowledge>/audits/`, append-only. Two halves, two producers.

## Mechanical (hook-written or pasted)

- Date and goal of the session:
- Commits landed (branch, hash, subject):
- TRACK lines emitted:
- Checks run and their results:

## Judgment (think audit + prove)

- Method audit: per step, followed / skipped / faked, and the risk each skip created.
- Gate verdicts issued this session (VERIFIED / VERIFIED WITH CAVEATS / REFUTED), with pointers.
- Drift or gaps found, and where each was resolved.
- Caveats left open (the next session's SessionStart may reinject these):
- Single highest-value fix for the next session:
