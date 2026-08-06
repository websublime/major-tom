---
name: think
description: Classify the current request, lane, type, and tier, and record that intent before any mutating tool runs. Invoke this first, before Edit, Write, Bash, or spawning an agent, whenever the PreToolUse gate blocks a call for a missing or stale intent record. Handles explicit skill/command invocations, free-form prompts, ticket grounding, and surfaces genuine ambiguity as side-by-side paths instead of guessing.
allowed-tools: Bash(node ${CLAUDE_SKILL_DIR}/scripts/record-intent.js *)
---

This skill records, mechanically, what the current prompt is before any mutating tool call
is allowed to run. A `PreToolUse` hook (`think-gate.js`) blocks `Edit`, `Write`, `Bash`, and
`Agent` calls until this skill has recorded an intent for the current prompt; reads
(`Read`, `Grep`, `Glob`) stay exempt.

## Steps

1. **Lane check.** Was this turn an explicit invocation of a skill or command with
   arguments, or a free-form prompt? If it was an explicit invocation, the instruction is
   already unambiguous, the invoked skill or command defines it, so skip straight to
   step 5 (tier assessment) using a type that reflects what was invoked. No vagueness
   handling applies to this lane.

2. **Ticket grounding (free-form only).** If the project's config (`.claude/major-tom.json`,
   `sources.issueTracker`) is configured and the prompt appears to reference an existing
   tracked item (a ticket ID, issue number, or similar), treat that as a strong `request`
   signal and ground the intent in the ticket rather than guessing scope from prose alone.
   This is recognition only, not a fetch mechanism: do not invent API calls to Jira,
   GitHub, or similar, that is explicitly out of scope for this skill (a future decision).

3. **Vagueness check (free-form only), two distinct forms.** Content vagueness: it is
   unclear what the request is even about. Cycle vagueness: the content is clear but it is
   unclear which type of interaction is wanted, a quick answer, a deeper exploration, or an
   actual implementation. If either applies:

   - Do not silently classify and proceed.
   - Do not pick one interpretation and ask a yes-or-no confirmation either, a confirmation
     question anchors the user toward the model's own first guess instead of surfacing the
     real ambiguity.
   - Instead, reformulate the request in your own words and lay out the plausible paths side
     by side, unweighted, no path presented as the likely or default one. Use a structured
     choice mechanism if the host provides one (for example a tool that presents selectable
     options), otherwise present the paths as a clearly labeled list in plain text and ask
     which one is wanted.
   - Stop here for this turn: do not proceed to type/tier classification (steps 4 to 6) and
     do not touch any mutating tool. The intent recorded for this turn is the reformulation
     itself and the paths offered, not a final classification (tier is judged on the effort
     spent surfacing the ambiguity well, not on whether an artifact got built; this can be
     substantive even though nothing was implemented). Still run step 7 to record that
     intent, then end the turn.

4. **Type classification** (free-form, once clear, or after the user picks a path). Classify
   into a type: which of the nine lifecycle phases (think, understand, decide, spec/plan,
   review, implement, verify, track, publish, from `docs/PRD.md` section 6) this turn
   actually touches. This is a first-draft list, open to growing, not exhaustive:

   - `question`: outside the nine-phase lifecycle entirely.
   - `learning`: an explanation request, outside the lifecycle, more about depth of
     explanation than process.
   - `research`: maps to the understand phase.
   - `brainstorm`: maps to think, understand, and decide together, in dialogue, no fixed
     artifact yet.
   - `request`: spans the full lifecycle, through implement, verify, publish.

5. **Tier classification.** This applies to every type, not only `request`, tier and type are
   independent axes. Same three tiers as before:

   - **trivial**: read-only questions, or a single well-understood one-line change with no
     design decision and no new files.
   - **task**: a scoped, well-understood piece of work touching one or a few files,
     following existing patterns already in the codebase, no new architectural decision
     required.
   - **substantive**: introduces a new decision, a new mechanism, spans multiple systems, or
     has hard-to-reverse consequences, the kind of thing that gets a D-id in `docs/PRD.md`.

   Pick the tier honestly. When in doubt between two tiers, pick the heavier one.

6. **Write a one-sentence summary** of what the request actually is (or, if step 3
   triggered, of the reformulation and paths offered), in plain language.

7. **Invoke the recorder script** with `Bash`, passing everything as CLI arguments:

   ```
   node ${CLAUDE_SKILL_DIR}/scripts/record-intent.js --session ${CLAUDE_SESSION_ID} --prompt <prompt_id> --tier <trivial|task|substantive> --type <type> --summary "<one-sentence summary>"
   ```

   `${CLAUDE_SESSION_ID}` is a host-substituted variable: the literal session ID is filled
   in before the model ever reads this text, the same mechanism as `${CLAUDE_SKILL_DIR}`.
   `<prompt_id>` is not a substitution; replace it with the `prompt_id` value read from the
   `[SESSION CONTEXT]` block injected by `writing-rule.js` (a `UserPromptSubmit` hook) into
   this turn: `[SESSION CONTEXT] session_id=<value> prompt_id=<value or omitted>`. If
   `prompt_id` was omitted (older Claude Code versions omit it until the first user input),
   pass an empty string for it.

   The script persists the intent (a log line for trivial/task, a full knowledge concept
   for substantive) and writes `.claude/session/<session_id>.json` so the `PreToolUse` gate
   recognizes this prompt as cleared. Run it once per prompt, before the first mutating
   tool call.

8. **Proceed with the request**, unless step 3 triggered: in that case this turn ends with
   the paths presented, waiting on the user to pick one.
