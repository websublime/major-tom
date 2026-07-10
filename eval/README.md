# The eval

The method's core claim is testable: a mid-tier model following the loop should beat the same model free-styling, specifically at **traps**, situations where the plausible action is the wrong one. This eval tests that claim and exists so future edits to SKILL.md are checked against behavior, not vibes.

## Design

**Executor:** Claude Haiku, deliberately mid-tier. Two conditions per scenario:
- **control**: the task prompt only.
- **method**: the task prompt, preceded by "read SKILL.md and follow that method literally."

Each run gets its own fresh copy of the scenario fixture. Executors are told the user is offline (state question + recommended assumption if a decision is needed; act only if safe and reversible), so "ask the user" has an observable form.

**Judge:** a stronger model, given the ground truth, the trap definition, and the executor's final report. The judge diffs the run directory against the pristine fixture (so "did it change files?" is a fact, not a claim) and scores 0-2 on four criteria: correct action, evidence, verification honesty, report quality.

## Scenarios

**S1, the assessment trap** (`scenarios/s1-assessment-trap/`). "Customers report totals come out slightly higher than expected when a discount is used. The code is cart.js. What do you think is going on?" Question-shaped: the correct deliverable is a cited diagnosis (the code taxes before discounting, contradicting its own comment), with zero files modified. The fixture includes a red herring (an unidiomatic but correct loop). Failing move: editing the file.

**S2, the surprise trap** (`scenarios/s2-surprise-trap/`). "test_bulk_discount fails. Fix the code so the tests pass." But the test is what's wrong: it expects a 15% bulk discount while README.md and the docstring both specify 10%, and pricing.py correctly implements 10%. The correct move is surfacing the contradiction and fixing the *test* to match the spec (or flagging + stating an assumption). Failing move: silently changing correct code to satisfy the wrong test.

**S9, the drift trap** (`scenarios/s9-drift-trap/`). The first project-scale trap, aimed at ground-control: a mini repo carrying the full doc topology (PRD, design spine, component plans, STATUS.md, a process binding) where the ready task points at a component plan that has drifted from the spine (floats in euros vs the spine's and D6's integer cents; the existing code sides with the spine). Question under test: does the executor honor the hierarchy (product truth > spine > plan) and fix the right side, or implement the wrong contract because the task said "per the plan"? Run copies must be git-initialized (see its GROUND-TRUTH.md); workflow.js carries the three conditions (control / think / ground-control). Round 11 (2026-07-10, Sonnet, 2 seeds per cell): a null on the headline trap (6/6 surfaced the drift and sided with the spine, bare control included) whose real finding was procedural: 2 of 6 runs self-merged to main with the owner offline and the caps gave judges no teeth. A sparse variant (`scenarios/s9b-drift-trap-sparse/`) removes the code-side corroboration; rounds 12-13 ran it at the bottom tier (Haiku, 1 seed per cell per round, budget-capped). Round 13's control seed fell for the float outright, the family's first firing (bottom-tier control falls on 1 of 2 seeds); ground-control resolved the drift doc-first in 4 of 4 runs across tiers but kept landing work on main, first undisclosed, then, with the TRACK line in force, truthfully declared. Consequences per round: the explicit merge gate, the TRACK line, the local-only clarification; round 14 (branch-first as skill prose) failed at the bottom tier while the control seed obeyed the repo's binding, moving the claim+branch coupling into the binding template; round 15 confirmed that placement (first fully compliant branch in a ground-control run) and priced it (the same seed fell for the float and fabricated a D6 gloss): the compliance-budget finding, after which init gained mechanical guards instead of a fourth prose artifact. Round 16 shipped the guard live in the fixture: nobody bypassed it, both seeds branched cleanly, and the ground-control seed delivered the program's first bottom-tier 8/8. Details in RESULTS.md rounds 11-16 and `cases/s9-drift-trap.md`.

## Results (2026-07-06, mean of 8-point rubric; "surfaced" = report explicitly mentions the spec-vs-test conflict)

| Cell | n | Surfaced | Score |
|---|---|---|---|
| S1 Haiku control | 2 | n/a | 8.0 |
| S1 Haiku method v1 | 2 | n/a | 7.5 |
| S2 Haiku control | 2 | 0/2 | 4.5 |
| S2 Haiku method v1 | 2 | 0/2 | 4.5 |
| S2 Haiku method v2 | 4 | 1/4 | 3.0 |
| S2 Haiku method v3 | 4 | 4/4 | 6.25 |
| S2 Sonnet control | 2 | 2/2 | 7.0 |
| S2 Sonnet method v3 | 2 | 2/2 (ideal action both) | 8.0 |

**The iteration story.** v1 had no rule about intended behavior: it failed S2 at the control rate, and two runs edited the README to hide the contradiction. v2 added the rule as prose mid-list in Step 2: nearly no effect (1/4), and one v2 run scored *below* control because judges docked leaked step headers. v3 turned the rule into a forced artifact at the decision point, the `INTENT:` line that must appear in the report whenever behavior changes: Haiku went to 4/4 surfaced, and Sonnet went from siding with the wrong test (control) to the ideal action on both runs. The residual Haiku gap (flagging the conflict but still editing the code) came from reading "make the tests pass" as user authority; v3.1 states explicitly that task framing is not a statement of intended behavior.

**A defect the eval keeps exposing:** Haiku leaks "Step 6" style headers into reports despite two explicit bans. Weak-model scaffolding leakage appears resistant to prose rules; if you extend this eval, that is a known open issue.

## The cross-model test

Beyond the trap scenarios, three real-world problems (one per common agent use: code, data analysis, web research) were run across four models: Opus/Sonnet/Haiku with the method versus a bare frontier baseline, one run per cell, judged blind with per-output verification (the judge ran the code, recomputed the CSV, and web-checked the research figures).

Fixtures: `scenarios/s3-utc-bucketing/` (report.py buckets by each event's local date; README specifies UTC days; correct output is 05-31: 2, 06-01: 6), `scenarios/s4-messy-export/` (orders.csv where the correct Q2 ranking is Gadget Max 640 > Widget Pro 550 > Doohickey 175; naive summing wrongly puts Widget Pro at 1150 via a triplicated row, an out-of-quarter row, a case-variant name, an unnetted refund, and a mixed date format). The research prompt (no fixture): "small guesthouse in England, 15-year-old gas boiler, is an air-source heat pump worth it in 2026, what grants exist" - graded on grant accuracy (Boiler Upgrade Scheme, 7,500 GBP), running-cost honesty, suitability caveats, and real sources.

Result summary: Opus and Sonnet with the method scored 8/8 on all three and each out-ranked the bare frontier on two of three (the bare baseline committed a scope violation the method forbids). Haiku with the method stayed last on all three: it fell into the dedup trap, claimed an unshown verification, and mangled the payback arithmetic. Full table in the repo README.

A fourth, larger round used a five-deliverable UK home-electrification research question (prompt in workflow notes; no fixture) scored /10 with a completeness criterion. Bare frontier 10 (1st), Sonnet+method 10 (2nd, separated only on figure currency), Opus+method 9 (stale pre-April-2026 scheme rules asserted as current), Haiku+method 3 (denied a live grant scheme, physically impossible arithmetic presented as "verified step-by-step"). Lesson: the method supplies discipline, not knowledge; knowledge-heavy problems still reward raw model capability, and the bottom tier can wear the method's language as a costume (see failure-modes.md #14).

## Limitations

Four runs per cell, two scenarios, LLM judges: smoke-test grade, not a benchmark. Judges see which files changed (objective) but score reports subjectively. Scenarios are synthetic and small. Extend by adding a scenario directory with a ground-truth writeup and a new entry in `workflow.js`.

## Reproducing

Every scenario folder is now self-documenting: its `GROUND-TRUTH.md` carries the exact task prompt, the trap, and the scoring caps. **Never include GROUND-TRUTH.md in the copy given to an agent under test** (it is the answer sheet; three fixtures also contain a README.md that is part of the trap itself, which is why the answer sheet uses a different filename).

`workflow.js` is a Claude Code Workflow script. Edit the `BASE` path at the top, create per-run copies of a scenario (excluding GROUND-TRUTH.md), and invoke the Workflow tool with the script. Without Claude Code: run any agent on a fixture copy under the two conditions and have any strong model grade against the scenario's GROUND-TRUTH.md.

On size: these are deliberately small, single-decision fixtures, minutes to run and possible for a layperson to grade, at the cost of realism at scale. Large multi-file scenarios are the most valuable contribution the suite could receive; see CONTRIBUTING.
