#!/bin/sh
# major-tom plugin hook (UserPromptSubmit): inject the writing rule as additional context.
#
# Why a hook and not prose. `skills/think/SKILL.md` Step 6 already says to report outcome first, in
# complete sentences a teammate who stepped away can follow. That rule is prose, it is read once at
# session start, and `.knowledge/memory/skill-context-cost.md` records that an early-invoked skill
# body is the FIRST thing auto-compaction drops. So on a long session the rule is silently gone
# exactly when the reports get long enough to need it. This is the same rule at the rung that holds:
# re-injected on every prompt, so compaction cannot reach it.
#
# The cost is real and is the point: this text is added once per user message, not once per session.
#
# Self-gated on the binding like the two PreToolUse guards, so the plugin does not change how Claude
# writes in every repository you open, only in repositories that opted into this process.
root="$(git rev-parse --show-toplevel 2>/dev/null)"
[ -n "$root" ] || exit 0
grep -q "^# Process binding" "$root/docs/PROCESS.md" 2>/dev/null || exit 0

# The rule text. Kept as one line inside the JSON string; the shell heredoc keeps it readable here.
rule='WRITING RULE (read before composing a reply): Write in plain, clear language. Every word must be literally TRUE: no metaphors, no figurative or vivid phrasing, no cleverness. Name things by what they DO, not by project code; put codes (H-5, D-061, P-24) in parentheses after a plain description. Tables and bulleted lists are fine and welcome: the requirement is clarity of language, not absence of structure. Default to short. If a result is uncertain or its evidence was compromised, say so first rather than after. END EVERY RESPONSE with a clear statement of what is happening now, what you need from the operator, or what happens next. STATUS REPORTS rebuild context from zero: the operator reads between other work and has NOT memorized the conversation. Name every file by filename plus a plain description of what it is, say what each change DOES, and never write phrases like the fix, the changes, the six files, the catch-all branch, or any shorthand coined earlier as if it were shared vocabulary. Structure long reports as: what happened, what we are doing, what happens next. SCOPE: this governs what you write to the operator in conversation. Files committed to the repository follow the conventions in docs/PROCESS.md instead.'

# Emit the hook JSON with python3 when available (correct escaping for any input), else with a
# hand-escaped fallback so the hook still works on a minimal host.
if command -v python3 >/dev/null 2>&1; then
  RULE="$rule" python3 -c 'import json,os; print(json.dumps({"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":os.environ["RULE"]}}))'
else
  escaped="$(printf '%s' "$rule" | sed 's/\\/\\\\/g; s/"/\\"/g')"
  printf '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"%s"}}\n' "$escaped"
fi
exit 0
