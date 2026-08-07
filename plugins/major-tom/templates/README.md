# Templates

Source templates the onboard workflow renders into the target repository. This directory
lives at the repository root (D19) because it is shared by both plugins: the single template
source for both distribution variants (PRD packaging rule): the Copilot CLI output is derived
from the same source as the Claude Code output, never authored apart.

## The dashboard is not here

The dashboard application (its computation, its server, its page and its launcher) is
authored inside the plugin, at `plugins/major-tom/app/`, and never under `templates/`
(D44 point 1). Nothing under `templates/` renders, generates or serves any part of it.

Its authoring split, its build, its HTTP contract, and the snapshot schema that used to be
documented here, are in `plugins/major-tom/app/README.md`; the schema is the section
"Snapshot schema v2" there.

## Authoring vs runtime (D23)

Author here, and only here. Installed plugins cannot reference files outside their own
directory (the plugin cache copies only the plugin dir), so each plugin carries a verbatim
copy at `plugins/<plugin>/templates/`, produced by `node scripts/sync-templates.js`. Those
copies are generated artifacts: never edit them directly. After any change here, run the
sync; `node scripts/sync-templates.js --check` fails on drift and is the pre-publish gate.
At runtime the renderer receives the absolute path of the plugin-local copy, resolved by
the `onboard-check` plugin agent via `${CLAUDE_PLUGIN_ROOT}` substitution.

## Rendering contract

The canonical renderer is `templates/render.js` (D29): node, no dependencies, shipped
inside each plugin by the sync. The Execute-phase renderer agent runs it and never
re-implements the grammar. It has exactly two modes, and both carry the templates.
`render <tpl> <config.json>` writes to stdout; `apply <tpl> <config.json> <target>`
renders and applies the managed-block semantics (replace between markers, append when the
target has none, create when missing; content outside the markers is never touched). It
fails closed: missing files, unbalanced blocks, or unresolved `{{` in the output are
errors, never improvised around.

- Render context: the validated `.claude/major-tom.json` object, exactly as written. No value
  reaches a template that did not pass schema validation first.
- One source, one render (D26): `context.md.tpl` renders to `AGENTS.md` only, the shared
  agent-instructions file both hosts read. `CLAUDE.md` is a thin wrapper from
  `claude.md.tpl`: its managed block imports the content via the `@AGENTS.md` directive
  (Claude Code import syntax), so nothing is duplicated between the two files.
- Managed blocks (proposed, pending owner decision): rendered output is wrapped in
  `<!-- major-tom:begin -->` and `<!-- major-tom:end -->` markers. On re-render, only the
  content between markers is replaced; anything the user wrote outside the markers is
  untouched.

The renderer carries no dashboard path of any kind. It renders templates and writes managed
blocks; the D43 cut-over removed the one mode that ever touched the dashboard page, along
with the data island that mode existed to fill.

## Placeholder grammar

A minimal mustache-compatible subset, no engine dependency:

| Form | Meaning |
|---|---|
| `{{a.b.c}}` | Value at that config path |
| `{{#if a.b}}...{{/if}}` | Block rendered only when the value is present and non-empty |
| `{{#each a.b}}...{{/each}}` | Block repeated per array item; `{{this}}` is the item, `{{this.x}}` a field |

Anything beyond this subset is a design change: extend this table first, then `render.js`,
then the templates.

Whitespace semantics, exactly as `render.js` implements them: a line holding only a block
tag is consumed with its line break; a skipped block leaves nothing behind; runs of blank
lines collapse to one; trailing spaces are trimmed. A value that may be empty must be
guarded with `{{#if}}` (a bare `{{path}}` with an empty value renders as empty text in
place). A line's trailing newline belongs to the line, not to an inline `{{#if}}` block
that ends it; close the inline block before the line break.

## Inventory

| Template | Renders to | Status |
|---|---|---|
| `context.md.tpl` | `AGENTS.md` in the target repo root | second draft, restructured after the owner's reference analysis (role header, north star, hard rules, document map) |
| `claude.md.tpl` | `CLAUDE.md` in the target repo root, importing `@AGENTS.md` | done |
| `render.js` | not a template: the canonical renderer both templates go through, with exactly two modes, `render` and `apply` | done, fixture-verified (three topologies, apply idempotence, outside-marker preservation) |
| `launch-merge.js` | not a template: merges the managed `major-tom-dashboard` entry into the target's `.claude/launch.json` (Claude Desktop preview surface), preserving every other entry and field; refuses an unparseable file. The entry's `program` is the launcher the onboard writes, `.claude/server/launcher.js` (overridable by a second argument), and its `args` is an empty array: the launcher takes only the port, which `autoPort` supplies, and there is no dashboard path to pass because no dashboard artifact is written any more (D44). `args` stays present and empty rather than absent, so that re-running the merge actively clears a path an older onboard wrote there | done, scenario-tested |
| `settings-merge.js` | not a template: merges the three session defaults (`env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` `"1"`, `env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` `"1"`, `alwaysThinkingEnabled` `true`, D37) into the target's Claude Code settings: `.claude/settings.local.json` when it exists, else `.claude/settings.json` when it exists, else a fresh `.claude/settings.json`; every other key and every other `env` entry preserved; fails closed, writing nothing, when the existing file does not parse, is not a JSON object, or has a non-object `env` | done, scenario-tested |
| `gitignore-merge.js` | not a template: writes the mechanism-state ignore rules (`.claude/worktrees/`, `.claude/session/`, `.claude/server/`, D38 and D40) into the target repo's `.gitignore` as a managed block between the line markers `# major-tom:begin` and `# major-tom:end`: creates the file when missing, replaces only the block when the markers are present, appends the block when the file has none; every other line preserved, existing duplicate entries neither removed nor deduplicated, idempotent; fails closed, writing nothing, on malformed markers (begin without end, end without begin, end before begin, duplicates) or an unreadable file | done, scenario-tested |

Planned, not yet written: one doc template per lifecycle artifact (intent record, research
notes, decision record, spec/plan, review verdict, implementation log, verification report,
roadmap update, release record).
