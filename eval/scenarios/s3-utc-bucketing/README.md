# activity-report

Generates the daily-active-users report from the events feed.

## Rules
- All daily buckets are UTC days. The dashboard buckets by UTC and is the reference.
- Events arrive as ISO-8601 timestamps that always include a UTC offset.
