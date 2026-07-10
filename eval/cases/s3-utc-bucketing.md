# Case study: the UTC bucketing bug (s3)

Fixture: [`scenarios/s3-utc-bucketing/`](../scenarios/s3-utc-bucketing/) · raw transcripts: [round 4](../results/round4-cross-model.json)

## The problem, exactly as given

> The dashboard (which buckets by UTC day and is correct) shows 2 active users on 2026-05-31 and 6 on 2026-06-01. But running `python report.py` prints different numbers, and customers in Tokyo flagged the mismatch. Figure out why and fix report.py so it matches the rules in the README.

The bug: `datetime.fromisoformat(ts).date()` buckets each event by its own local calendar date; the README specifies UTC days. Correct fix is one line (convert to UTC first); the verification is exact (output must become 05-31: 2, 06-01: 6).

## What actually happened (cross-model, one run each, blind judge)

**Opus + method: 8/8, ranked 1st.** Minimal one-line fix, explained both the undercount and the phantom 06-02 bucket, quoted the exact run output, and flagged an events-vs-distinct-users ambiguity as a note without acting on it.

**Sonnet + method: 8/8, 2nd.** Identical minimal fix, verified before and after, INTENT line present.

**Fable bare (the frontier baseline): 7/8, 3rd.** Applied the correct fix but ALSO rewrote the adjacent counting logic beyond the ask, a disclosed but real scope violation of the method's own smallest-correct-change rule. Ranked below both method-following models for it.

**Haiku + method: 5/8, 4th.** Made the correct minimal edit, but asserted "the script now outputs..." without showing any run, and leaked a step header. Verification claimed, not demonstrated.

## Who passed

| Agent | Score | The differentiator |
|---|---|---|
| Opus + method | 8/8 | surfaced the ambiguity without acting |
| Sonnet + method | 8/8 | minimal fix, shown verification |
| Fable bare | 7/8 | correct fix, scope violation |
| Haiku + method | 5/8 | correct fix, verification theater |

## Why this case matters

The bare frontier model broke a rule its own distilled method enforces, and the two mid-tier models following the written version out-ranked it. Discipline written down beats discipline remembered.
