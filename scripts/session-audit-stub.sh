#!/bin/sh
# ground-control plugin hook (SessionEnd): writes the mechanical half of a session audit.
# Self-gated and root-anchored; granularity is repo-day by this git author, not session
# (SessionEnd carries no reliable per-session commit list), stated here on purpose.
root="$(git rev-parse --show-toplevel 2>/dev/null)"
[ -n "$root" ] || exit 0
grep -q "^# Process binding" "$root/docs/PROCESS.md" 2>/dev/null || exit 0
me="$(git config user.name)"
log="$(git -C "$root" log --oneline --since=midnight --all --author="$me" 2>/dev/null | head -20)"
[ -n "$log" ] || exit 0
dir="$root/.knowledge/audits"
mkdir -p "$dir"
f="$dir/$(date +%F)-session-$(date +%H%M).md"
[ -e "$f" ] && exit 0
{
  echo "# Session audit stub - $(date +%F' '%H:%M)"
  echo
  echo "## Mechanical (auto)"
  echo
  echo "Commits today by $me (all branches):"
  echo "$log"
  echo
  echo "## Judgment (fill via think audit + prove)"
  echo
  echo "- Method audit / gate verdicts / drift found / caveats open / next fix:"
} > "$f"
exit 0
