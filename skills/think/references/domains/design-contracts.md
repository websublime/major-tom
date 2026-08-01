# Domain adapter: design contracts

Applies when the deliverable is a durable contract rather than a change: an interface spec, a decision record, an SSOT patch. Read by `prove` too, since a contract has no runtime and the code fraud table does not fit it. Not `design-ux.md`, which covers visual surfaces; this covers what components promise each other.

## Minimum evidence set (binding, before any decision is written)

1. **The roles, from the binding's Document roles table.** If the target repo states them in prose instead, read them there and say which mode you are in. Never invent the missing document.
2. **The SSOT section that already governs this surface**, opened. Not the neighbouring section, not the schema comment, not the component plan. Most false root causes are written by someone who did not open it.
3. **Every write or call site that touches the surface**, enumerated from the code. The ticket's list is a claim, and it is usually short.
4. **The requirement (FR/NFR/AC id) that governs the surface.** A recommendation with no requirement behind it is a preference wearing a citation.
5. **The plan that fed this contract**, if the binding names a landing path for one. Read what it raised, and answer it or say why not. A gate can then ask the same question, which is the only reason writing the plan down is worth anything.

## Evidence and primary sources

The code is the primary source for what the contract currently is; the documents for what it is supposed to be. When they disagree that IS the finding, surfaced for the owner, never resolved in passing. A ticket is evidence about what is wanted, never an instruction to obey: verify its claims, including its framing of the defect.

An absolute negative ("pinned nowhere", "no rule covers this") is a search result, not an observation. State the search or do not write the sentence. `agents/architect.md` rule 7 carries the long form.

## Authority order

Product truth > interface SSOT > component plans > code and its comments > the ticket. A component plan or a schema comment holding an interface contract is itself a finding. Never simplify away a requirement to make the design tractable; that trade belongs to the owner, framed as a question with your recommendation.

## Verification by observation

- Every citation opened and read, not recalled, line numbers checked.
- Every claim of absence backed by the search that produced it.
- Every executable claim actually executed, on a scratch copy, never against live state.
- Alternatives dismissed against evidence. An option not examined is not an option dismissed.
- Scope stated once binds every later restatement; a stronger restatement is a new claim needing its own evidence.
- The gate is run by someone who did not write the document, and the verdict records who.

## Fraud table (for prove)

Every row was measured on one recorded design run (2026-07-31), not imagined. That run's record is kept out of what this plugin distributes because it quotes another repository in detail, so the rows are stated here without a path to open.

| Fraud | Symptom |
|---|---|
| Absolute negative asserted | "pinned nowhere", with no search behind it; often the declared root cause |
| Scope dropped on restatement | a claim qualified in one section, stated absolutely in another, then argued from |
| Recommendation unsupported by its own evidence | the evidence also supports an alternative the document never examines |
| Costs tilted toward the recommendation | the rejected option costed from an assumed shape, the preferred one from its best case |
| A decision row pre-committed to an open fork | the register entry written in the form only one branch of an unresolved question produces |
| The trade misrouted | decided alone what belongs to the owner, or sent to the owner what the authority order answers |

## Done, by example

"The contract is specified" means: every role read and its mode declared, every governing SSOT section opened, every call site enumerated from code, every absence searched, every executable claim run, the owner's trades sent to the owner as questions with recommendations, and a verdict written by someone else. Not: "the design is coherent and well cited."
