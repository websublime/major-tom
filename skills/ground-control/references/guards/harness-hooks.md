# Harness guard pack (Claude Code)

Hooks init offers when the harness is Claude Code. Each installs only with the owner's approval and is recorded in the binding. Scripts live in the repo (`.githooks/`) so they are versioned; `settings.json` wires them. Hooks enforce outside the model's attention budget (the eval's compliance-budget finding); rules (see rules-template.md) merely remind.

When ground-control is installed as the major-tom plugin, hooks 1 and 3 ship automatically via the plugin's `hooks/hooks.json`, each script self-gated (it exits unless the repo carries a ground-control binding at `docs/PROCESS.md`), and a plugin monitor tails `.ground-control/violations.log` so guard blocks surface live in the session. This file remains the reference for standalone installs and for repos wanting the hooks without the plugin.

## 1. Branch guard, before the command even runs (PreToolUse)

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
  d="$(git config ground-control.defaultBranch || echo main)"
  if [ "$b" = "$d" ]; then echo "ground-control: no commits on $d; claim = branch (git switch -c t<id>-<slug>)" >&2; exit 2; fi ;;
esac
exit 0
```

Exit 2 blocks the tool call and feeds the message back to the model. Pair with the repo-level `pre-commit` (this directory): the git hook catches every actor, the harness hook catches it earlier with pedagogy at the decision point.

## 2. TRACK reminder (Stop)

Sketch: a Stop hook that exits 2 with "add the TRACK line" when the session created commits (`git log --since` non-empty) but the final message carries no `TRACK:` line (the hook receives `transcript_path` on stdin). Implement per repo; keep it a reminder, not a lie detector: the Verify gate owns fraud.

## 3. Session audit stub (SessionEnd) and caveat reinject (SessionStart)

```json
{"hooks": {"SessionEnd": [{"hooks": [{"type": "command", "command": "sh .githooks/session-audit-stub.sh"}]}]}}
```

`.githooks/session-audit-stub.sh` writes the mechanical half of a session audit into `<knowledge>/audits/` (skips sessions with no commits); the judgment half comes from think audit and prove (template: `../session-audit-template.md`). A SessionStart hook may echo the latest audit's open caveats: SessionStart stdout is injected as context, so the next session starts where the last one left off.
