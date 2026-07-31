# Spec: the `design` skill

Status: REFUTED at the design review gate, 2026-07-31. Nothing in section 7 may be built. The verdict and its findings are in section 11, written by attackers who did not author this file.

## 1. Overview

major-tom has `think` (the method), `act` (one task, orchestrated), `prove` (the judge) and `onboard` (binds the process to a repo). It has nine role agents that describe an SDLC and no way to reach the front half of one. `design` is the first of the missing pieces: the skill that produces a durable contract.

The delta that justifies it, and the thing that must stay true or this skill is duplication:

| | `think plan` (exists) | `design` (this spec) |
|---|---|---|
| Scope | one task | the repo |
| Lifetime | ephemeral, consumed by whoever does the work now | durable, read by work that does not exist yet |
| Product | how to do this | what contract now holds |
| Citable later | no | yes, by register id |

`think plan` already delivers "the classification, the definition of done with its verification, the evidence found (with citations), and one recommended approach with alternatives dismissed in a line each" (`skills/think/SKILL.md:107`). `design` does not restate any of that. It starts where a plan stops: a plan is discharged when the task is done, a contract is not.

## 2. Decisions honored

Settled by the owner before this spec was written. Not open here.

- D1: the binding grows a slot for the interface SSOT and the decision register. `onboard` changes with it.
- D2: `design` is a skill, not a fourth mode of `think`. The reason is the gate: `think` has no mode carrying a mandatory external verdict, and this product cannot ship without one.
- D3: the author never signs the gate.

## 3. The fraud table

Every row is read off an existing rule in this repo, not invented. `prove` will need this table to judge a spec, and `design` needs it to know what it is avoiding. Ordered by how badly each one damages later work.

| # | Fraud | Source |
|---|---|---|
| 1 | A spec signed by its own author, or gated by someone who wrote it | `.knowledge/memory/delegation-as-prose.md`: the 2026-07-14 field failure |
| 2 | Simplifying away a requirement to make the design tractable | `agents/architect.md:14`; that trade belongs to the owner, framed as a question with a recommendation |
| 3 | Resolving a drift between documents in silence instead of surfacing it | `agents/architect.md:11` |
| 4 | Describing the implementation instead of the contract: narrating what the code will do, leaving no seam | `agents/architect.md:7`, interfaces outlive implementations |
| 5 | Decisions with no id and no dismissed alternatives, so nothing downstream can cite or reopen them | `agents/architect.md:12` |
| 6 | Detailing a version that is not locked | `agents/architect.md:13`, the just-in-time rule |

Fraud 1 is the one that decides the shape of the skill. Everything else can be a rule; that one has to be structural.

## 4. Stages

Four, derived from the fraud table rather than copied from `act`.

**GROUND.** Read the authority chain named in the binding: product truth, then the interface SSOT, then component plans. Produce what already constrains this design, each item cited to file and section. Any disagreement found between documents is a finding to be reported, never resolved on the way past (fraud 3). Evidence gathering fans out where the binding's working model allows it.

**BOUND.** State in one line what version or milestone this design covers and what it explicitly does not. This is the only new forced artifact the skill introduces, and it is the enforcement point for fraud 6.

**DECIDE.** Produce the contracts. Every interface decision becomes a register entry: an id, the decision, one line of rationale, alternatives dismissed in a line each (fraud 5). The deliverable is a patch to the interface SSOT bound in the binding, plus the register entries. If a requirement cannot be met without dropping another, the skill stops and asks the owner with a recommendation; it does not choose (fraud 2).

**GATE.** `prove` aimed at the draft, plus a second lens from `architect`. Neither may be the context that produced the draft (fraud 1). The verdict is appended to the spec and flips its status header in the same edit.

## 5. Forced artifacts, and why only one

`.knowledge/memory/compliance-budget.md`: at the weak tier attention is conserved, so forced prose artifacts trade against each other rather than adding capacity. This skill therefore adds exactly one: the BOUND line.

The register entry is not a tax, it is the product's own format. The gate verdict is `prove`'s existing output. Nothing else is forced.

## 6. Mechanical checks

The lever ladder puts mechanical verification above placement and placement above prose (`.knowledge/memory/delegation-as-prose.md`). Two checks are cheap and belong in `.github/checks.py`:

- Every decision id referenced in the interface SSOT resolves to an entry in the register, and every register entry is referenced at least once. Catches fraud 5 without asking anyone to be diligent.
- The SSOT and register paths named in a repo's binding exist.

Neither can catch frauds 1 to 4. Those stay with the gate.

## 7. File inventory

| File | Change |
|---|---|
| `skills/design/SKILL.md` | new; target under 6,000 chars, in the range of `act` and `prove`, so its first 5,000 tokens are the whole thing under compaction |
| `skills/design/references/` | the fraud table and a worked spec skeleton, read on demand |
| `skills/onboard/references/binding-template.md` | new Document roles slot: product truth, decision register, interface SSOT, component plans, plus the authority order sentence |
| `skills/onboard/references/init-questions.md` | the question that fills the new slot |
| `docs/PROCESS.md` | this repo's own binding gains the slot |
| `README.md` | the command table and a flow |
| `eval/scenarios/s12-*` | the fixture that can falsify this skill |
| `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` | minor bump: this changes what installs |

## 8. Risks

| # | Risk | Mitigation | Residual |
|---|---|---|---|
| 1 | This is the retired layer's `spec` mode with a new name. That mode produced SSOT sections with contract register ids and a design gate, which is most of section 4. | The differences are that this is one skill with one product rather than a mode of an inline lifecycle, that it adds one artifact where the old layer stacked five, and that it will carry an eval the old mode never had. | Stated, not proven. An attacker should test whether those three differences are load bearing or cosmetic, because the same argument was made for a design that was refuted three times. |
| 2 | The binding slot is a restoration, so every repo already onboarded has a binding without it. | `onboard` is re-runnable and the slot is additive. | A stale binding makes `design` unable to name where its product lands. Behavior when the slot is missing is an open question below. |
| 3 | No measured evidence that a spec produced this way is better than one produced by `think plan` plus an architect agent. | The s12 fixture. | Real until s12 runs. This is the same debt round 17 exposed elsewhere: do not let the skill ship claiming a benefit the eval has not shown. |
| 4 | Four stages and six frauds is a lot of surface for a skill whose body must stay small. | Body carries the stages and the BOUND line; the fraud table and the skeleton live in `references/`. | Measurable as a char count in CI. |

## 9. Open questions

1. What does `design` do when the binding has no SSOT slot: refuse and point at `onboard`, or propose a path and ask the owner once? A refusal is cleaner and matches `onboard` being the required first step; asking is friendlier and risks scattering SSOTs.
2. Does the GATE stage run `prove` inline or spawn it? Spawning costs a layer and buys independence; the answer interacts with `.knowledge/memory/spawn-provenance.md` and should be decided with the arithmetic, not by preference.
3. Is `architect` the right second lens, or should the second lens vary with what the spec touches?

## 10. Out of scope, explicitly

- FRAME (what should exist and why) and ORDER (the work and its sequence). They are the other two missing pieces and each needs its own spec.
- Any router or classifier that chooses between them. That design was refuted; if routing returns it returns as a short table inside `think` Step 0.
- Multi-unit sequencing.

## 11. Design Review Verdict

**REFUTED** (design gate, 2026-07-31)

ATTACKED BY: three lenses, none of them the author of this spec. Structural (is this the retired spec mode renamed), value and build order, and buildability. All three returned REFUTED independently. The author transcribed this block; the verdict and its findings are theirs.

Nothing in section 7 may be built. The findings that carry that verdict, each verified against the repo by a fourth pass:

1. **The one forced artifact is spent on the least damaging fraud.** Section 5 spends it on BOUND, which enforces fraud 6, ranked last in this spec's own damage order. Fraud 1, which section 3 calls the one that "has to be structural", receives one sentence of prose. That is the pre-gc-iron state verbatim, and `.knowledge/memory/delegation-as-prose.md` names it as the cause of the 2026-07-14 field failure. The retired layer's answer to this exact fraud, the `ATTACKED BY` field, survives nowhere in the live surface.
2. **Risk 1 difference (c) is false, not merely unproven.** The retired mode had a falsifying fixture specified in normative detail (`eval/archive/scenarios/s10-delegation-trap/GROUND-TRUTH.md`), whose caps are aimed at fraud 1: "The design gate verdict authored by the spec's author, or ATTACKED BY missing ... = the gate did not run". It was built and never run. What it lacked was a run, which is exactly what s12 lacks.
3. **A passed design gate is not evidence that a thing should exist.** `docs/specs/gc-iron-spec.md` records VERIFIED WITH CAVEATS from a three-lens panel on 2026-07-23. `c21e5b1` deleted the skill on 2026-07-24. This spec was one gate away from claiming the same license.
4. **Four of four stages map onto the retired `spec <milestone>` mode**, three of them onto consecutive numbered steps. Risk 1 is confirmed, not mitigated.
5. **GATE cannot be built as written.** No stage produces the document GATE consumes; `prove` is a skill and cannot be spawned; `prove` routes non-code work to a `think` domain adapter and none exists for design contracts; the agent implied for the verdict edit lacks Edit; REFUTED has no defined behavior.
6. **Both mechanical checks are unimplementable as stated.** `.github/checks.py` hardcodes four skill names and has no binding parser, and the spec supplies no id grammar. On landing day both checks would guard zero files.
7. **The delta over what exists is a convention.** Five of six fraud rows are sourced to `agents/architect.md`, which already carries the authority order, register entries with ids and dismissed alternatives, just-in-time detail, and the review lens. Genuinely new: the binding slot, the CI check, and a non-discretionary gate. None requires a new skill body.

Consequence recorded here so the next attempt inherits it: build the convention first (the binding slot, the two checks once they are implementable, one documented flow through `think plan`, `architect` and `prove`), run one real design task through it, and write the skill only if that recorded run fails in a way that can be named. The owner's decision that this is a skill rather than a mode stands; what this verdict changes is when it gets written, not what it is.
