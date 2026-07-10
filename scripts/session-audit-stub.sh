#!/bin/sh
# ground-control plugin hook (SessionEnd): writes the mechanical half of a session audit.
# Self-gated: exits unless the repo carries a ground-control binding; skips commit-less sessions.
grep -q ground-control docs/PROCESS.md 2>/dev/null || exit 0
[ -z "$(git log --oneline --since=midnight --all 2>/dev/null | head -1)" ] && exit 0
dir=".knowledge/audits"
mkdir -p "$dir"
f="$dir/$(date +%F)-session-$(date +%H%M).md"
[ -e "$f" ] && exit 0
{
  echo "# Session audit stub - $(date +%F' '%H:%M)"
  echo
  echo "## Mechanical (auto)"
  echo
  echo "Commits today (all branches):"
  git log --oneline --since=midnight --all 2>/dev/null | head -20
  echo
  echo "## Judgment (fill via think audit + prove)"
  echo
  echo "- Method audit / gate verdicts / drift found / caveats open / next fix:"
} > "$f"
exit 0
