#!/bin/sh
# major-tom plugin hook (PreToolUse, Bash): block git commit on the default branch.
# Self-gated and root-anchored: acts only inside a git repo whose root carries a
# major-tom binding (docs/PROCESS.md starting with "# Process binding").
root="$(git rev-parse --show-toplevel 2>/dev/null)"
[ -n "$root" ] || exit 0
grep -q "^# Process binding" "$root/docs/PROCESS.md" 2>/dev/null || exit 0
input="$(cat)"
if command -v jq >/dev/null 2>&1; then
  cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)"
else
  cmd=""
fi
# Fallback without jq (or on parse failure). The capture stops at the first closing quote:
# a greedy `.*` swallowed sibling JSON fields, so `echo a` with a description mentioning
# `; git commit` was blocked. Measured by a Verify gate. The trade is stated rather than hidden:
# a command containing an escaped quote is truncated here and a commit after that point is missed,
# which the repo `pre-commit` hook backstops. Blocking correct work gets a guard switched off.
[ -n "$cmd" ] || cmd="$(printf '%s' "$input" | sed -n 's/.*"command"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
# Match git commit in command position (start or after ; & | Q), not as quoted prose.
# Heuristic by design; the repo-level pre-commit hook is the backstop.
if printf '%s\n' "$cmd" | grep -qE '(^|[;&|(][[:space:]]*)git[[:space:]]+commit([[:space:]]|$)'; then
  b="$(git symbolic-ref --short HEAD 2>/dev/null)"
  d="$(git config major-tom.defaultBranch || git config ground-control.defaultBranch || echo main)"  # ground-control.defaultBranch: intentional migration fallback, do not remove
  if [ "$b" = "$d" ]; then
    echo "major-tom: no commits on $d; claim = branch (git switch -c t<id>-<slug>)" >&2
    exit 2
  fi
fi
exit 0
