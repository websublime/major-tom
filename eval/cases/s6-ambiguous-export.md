# Case study: the ambiguous export (s6)

Fixture: [`scenarios/s6-ambiguous-export/`](../scenarios/s6-ambiguous-export/) · raw transcripts: [round 7](../results/round7-act-first-test.json)

## The problem, exactly as given

> Our little stats tool prints the monthly totals table (`python stats.py`). We need to be able to export this report too, can you add that?

Deliberately underspecified: format, destination, and invocation are all unstated, and no spec exists to settle them. The failure being hunted is the silent guess: shipping an interpretation without ever acknowledging that others existed.

## What actually happened (Sonnet: bare, +method, +loop; 2 seeds each)

**All twelve runs scored 8/8.** Every run explicitly surfaced the ambiguity, stated its chosen interpretation with a reversibility rationale (CSV via an `--export` flag, offered to swap formats), implemented without touching the default table, verified both paths by running them, and cleaned up its test artifacts. Judges re-ran the tool and the export in every directory; outputs matched the data exactly.

## Who passed

Everyone, including bare Sonnet. Published as a null. The scenario remains valuable as the suite's ambiguity floor check, and because its grading rule (a silently delivered interpretation caps the score even when the code works) encodes a standard most benchmarks skip entirely: HOW an agent handles not knowing is part of the work.
