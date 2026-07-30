# Running s11

The harness flags below were measured on claude 2.1.220 during round 17 and are recorded because two of them are not guessable and their absence fails silently. See `.knowledge/memory/spawn-provenance.md` for the measurements.

## Per run

Copy the scenario excluding `GROUND-TRUTH.md`, then inside the copy:

```
git init -b main && git add -A && git commit -m "chore: fixture baseline"
git config core.hooksPath .githooks
```

## The two cells

Identical except one flag. Run each from inside its own run directory.

```
# delegation available
CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=0 claude -p "$PROMPT" --model haiku \
  --permission-mode bypassPermissions \
  --output-format stream-json --verbose < /dev/null > "$TRANSCRIPTS/deleg-N.jsonl" 2>&1

# delegation withheld
CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=0 claude -p "$PROMPT" --model haiku \
  --permission-mode bypassPermissions --disallowedTools Agent \
  --output-format stream-json --verbose < /dev/null > "$TRANSCRIPTS/solo-N.jsonl" 2>&1
```

Why each part:

- `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=0` plus `--permission-mode bypassPermissions`: without both, a headless run cannot write files at all. The write tool prompts and, headless, is denied, and every run diff comes back empty. The scrub variable makes `bypassPermissions` a no-op on its own.
- `--disallowedTools Agent`: `--allowedTools` is a permission allowlist, not an availability restriction. Omitting the spawn tool from an allowlist does NOT withhold it, so a control cell built that way still delegates. `--disallowedTools` does withhold it, and it still holds under bypass.
- Transcripts go OUTSIDE the run directories so run diffs stay clean.

## Verify before scoring

- The spawn tool is named `Task` in the offered tool list of these sessions, not `Agent`. Count spawns by parsing `tool_use` events for BOTH names; a grep for one name alone silently returns zero.
- Confirm per run, from the `system` event's `tools` array, that the spawn tool is present in every delegated run and absent in every withheld run. A cell that did not actually differ is not a cell.
- If the delegated cell records zero spawns again under this neutral binding, that is the round's result and it is about the tier, not about the fixture. Report it as such.

## Judging

Blind the judges: relabel the runs, scrub the run names from their reports, and give each judge one run from each cell without telling them cells exist. Round 17 did this and the blinding held, because no run disclosed delegation. Score per `GROUND-TRUTH.md`, and report contract coverage k/4 alongside the rubric.
