# Harness guard pack (Claude Code)

onboard offers this when the harness is Claude Code. It installs only with the owner's approval and is recorded in the binding. Scripts live in the repo (`.githooks/`) so they are versioned; `settings.json` wires them. Hooks enforce outside the model's attention budget (the eval's compliance-budget finding).

When installed as the major-tom plugin, the branch guard ships automatically via the plugin's `hooks/hooks.json`, root-anchored via `git rev-parse --show-toplevel` and self-gated (it exits unless the repo root carries a binding whose first line is `# Process binding`). A plugin monitor tails `.major-tom/violations.log` so guard blocks surface live; monitors are an experimental Claude Code component (v2.1.105+). Known limit, stated on purpose: the branch-guard command match is a heuristic (command-position regex, with the repo git hook as backstop). This file remains the reference for standalone installs and for repos wanting the hook without the plugin.

## Branch guard, before the command even runs (PreToolUse)

```json
{"hooks": {"PreToolUse": [{"matcher": "Bash", "hooks": [{"type": "command", "command": "sh .githooks/pretool-branch-guard.sh"}]}]}}
```

`.githooks/pretool-branch-guard.sh`:

```sh
#!/bin/sh
input="$(cat)"
cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)"
case "$cmd" in *"git commit"*)
  b="$(git symbolic-ref --short HEAD 2>/dev/null)"
  d="$(git config major-tom.defaultBranch || git config ground-control.defaultBranch || echo main)"  # ground-control.defaultBranch: intentional migration fallback, do not remove
  if [ "$b" = "$d" ]; then echo "major-tom: no commits on $d; claim = branch (git switch -c t<id>-<slug>)" >&2; exit 2; fi ;;
esac
exit 0
```

Exit 2 blocks the tool call and feeds the message back to the model. Pair with the repo-level `pre-commit` (this directory): the git hook catches every actor, the harness hook catches it earlier with pedagogy at the decision point.
