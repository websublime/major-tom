#!/bin/sh
# ground-control plugin hook (PreToolUse, Bash): block git commit on the default branch.
# Self-gated: exits unless the repo carries a ground-control binding at docs/PROCESS.md.
grep -q ground-control docs/PROCESS.md 2>/dev/null || exit 0
input="$(cat)"
cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)"
case "$cmd" in *"git commit"*)
  b="$(git symbolic-ref --short HEAD 2>/dev/null)"
  d="$(git config ground-control.defaultBranch || echo main)"
  if [ "$b" = "$d" ]; then
    echo "ground-control: no commits on $d; claim = branch (git switch -c t<id>-<slug>)" >&2
    exit 2
  fi ;;
esac
exit 0
