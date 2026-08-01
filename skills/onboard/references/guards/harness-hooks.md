# Harness guard pack (Claude Code)

onboard offers this when the harness is Claude Code. It installs only with the owner's approval and is recorded in the binding. Scripts live in the repo (`.githooks/`) so they are versioned; `settings.json` wires them. Hooks enforce outside the model's attention budget (the eval's compliance-budget finding).

When installed as the major-tom plugin, two hooks ship automatically via the plugin's `hooks/hooks.json`. The first is the branch guard below, root-anchored via `git rev-parse --show-toplevel` and self-gated (it exits unless the repo root carries a binding whose first line is `# Process binding`). A plugin monitor tails `.major-tom/violations.log` so guard blocks surface live; monitors are an experimental Claude Code component (v2.1.105+). Known limit, stated on purpose: the branch-guard command match is a heuristic (command-position regex, with the repo git hook as backstop). The second is the writing rule (`UserPromptSubmit`, `scripts/userprompt-writing-rule.sh`), which re-states think Step 6 as context on every prompt so that auto-compaction cannot drop it; it is self-gated the same way and its cost is about 1,200 characters per message rather than per session. This file remains the reference for standalone installs and for repos wanting the hooks without the plugin.

One guard was tried and removed. A PreToolUse hook refusing a mutating command aimed at another repository shipped on 2026-07-31 and was reverted the same day: a Verify gate measured 34 of 38 foreign writes getting past it, it blocked ordinary reads because its redirect pattern matched `2>/dev/null`, and it blocked the copy-to-scratch remedy its own message recommended. Reading a command string cannot decide what a command writes. If you want that protection, use the harness's own filesystem deny rules rather than a command-text guard.

## Branch guard, before the command even runs (PreToolUse)

```json
{"hooks": {"PreToolUse": [{"matcher": "Bash", "hooks": [{"type": "command", "command": "sh .githooks/pretool-branch-guard.sh"}]}]}}
```

`.githooks/pretool-branch-guard.sh`:

```sh
#!/bin/sh
# Root-anchored and self-gated: acts only inside a git repo whose root carries a binding.
root="$(git rev-parse --show-toplevel 2>/dev/null)"
[ -n "$root" ] || exit 0
grep -q "^# Process binding" "$root/docs/PROCESS.md" 2>/dev/null || exit 0
input="$(cat)"
if command -v jq >/dev/null 2>&1; then
  cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)"
else
  cmd=""
fi
# Fallback without jq. Stops at the first closing quote so a sibling JSON field cannot be swallowed.
[ -n "$cmd" ] || cmd="$(printf '%s' "$input" | sed -n 's/.*"command"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
# Command position, not substring: `git commit` inside a quoted string is not a commit.
if printf '%s\n' "$cmd" | grep -qE '(^|[;&|(][[:space:]]*)git[[:space:]]+commit([[:space:]]|$)'; then
  b="$(git symbolic-ref --short HEAD 2>/dev/null)"
  d="$(git config major-tom.defaultBranch || git config ground-control.defaultBranch || echo main)"  # ground-control.defaultBranch: intentional migration fallback, do not remove
  if [ "$b" = "$d" ]; then
    echo "major-tom: no commits on $d; claim = branch (git switch -c t<id>-<slug>)" >&2
    exit 2
  fi
fi
exit 0
```

Exit 2 blocks the tool call and feeds the message back to the model. Pair with the repo-level `pre-commit` (this directory): the git hook catches every actor, the harness hook catches it earlier with pedagogy at the decision point.
