# Templates

Source templates the onboard workflow renders into the target repository. This directory
lives at the repository root (D19) because it is shared by both plugins: the single template
source for both distribution variants (PRD packaging rule): the Copilot CLI output is derived
from the same source as the Claude Code output, never authored apart.

## Dashboard authoring split (D34)

The dashboard is authored in `templates/dashboard/` (`index.html` skeleton,
`dashboard.css`, and real ES modules under `src/`: data, state, ui, one module per view,
main) and built into the single-file artifact `templates/dashboard.html` by
`node scripts/build-dashboard.js`. The artifact is GENERATED: never edit it directly, and
`--check` fails when it is stale. The bundler enforces a declared subset and fails closed
outside it: static named relative `.mjs` imports only, no cycles, no dynamic import,
unique top-level declarations across modules (they share one scope after bundling).
Dev loop without a build: serve the authoring directory
(`node templates/dashboard-server.js templates/dashboard <port>`) and the browser loads
the modules natively; edit and refresh. The authoring directory is excluded from the
plugin sync: only the built artifact ships.

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
re-implements the grammar. Two modes: `render <tpl> <config.json>` writes to stdout;
`apply <tpl> <config.json> <target>` renders and applies the managed-block semantics
(replace between markers, append when the target has none, create when missing; content
outside the markers is never touched). It fails closed: missing files, unbalanced blocks,
or unresolved `{{` in the output are errors, never improvised around.

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

## Placeholder grammar

A minimal mustache-compatible subset, no engine dependency:

| Form | Meaning |
|---|---|
| `{{a.b.c}}` | Value at that config path |
| `{{#if a.b}}...{{/if}}` | Block rendered only when the value is present and non-empty |
| `{{#each a.b}}...{{/each}}` | Block repeated per array item; `{{this}}` is the item, `{{this.x}}` a field |

Anything beyond this subset is a design change: extend this table first, then `render.js`,
then the templates.

The dashboard is the exception to the grammar: `dashboard.html` is fully static and gets
its data through `render.js inject`, which replaces only the content of the
`<script type="application/json" id="major-tom-data">` island (escaping `</script` inside
the JSON).

Snapshot schema v2 (D33). Required: `generatedAt` (ISO), `config` (the validated config),
`git` (`[{hash, date, author, subject, kind, add, del}]`, 50-commit window), `knowledge`
(`{files: [{path, type, size, updated, frontmatter, body?, truncated?}]}`, body embedded
up to 32 KB per file and 1 MB total in index order, truncated flagged), `decisions`
(derived from OKF concepts with `type: decision`). Optional, no producer yet, the
dashboard shows empty states when absent: `lastRun` (`{id, workflow, mode, duration,
phases: [{name, artifact, status, elapsed}]}`) and `roadmap` (`{milestones: [{title,
version, status, pct, tasks: [{ref, title, status, owner}]}]}`).

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
| `render.js` | not a template: the canonical renderer both templates go through, plus the dashboard `inject` mode | done, fixture-verified (three topologies, apply idempotence, outside-marker preservation, island injection) |
| `dashboard/` | authoring split for the dashboard (D34): `index.html` + `dashboard.css` + ES modules; built by `scripts/build-dashboard.js`; excluded from the plugin sync | authoring source |
| `dashboard.html` | GENERATED from `dashboard/` (never edit directly). Injected into `<persistence.root>/dashboard.html` via `render.js inject` (never the mustache grammar): single-file vanilla port of the owner's Claude Design reference (D33): collapsible rail, five hash-routed views (overview grid/console, roadmap, git with search and kind filters, knowledge tree + viewer, config table/raw), persisted theme toggle, system fonts, honest empty states for lastRun/roadmap | v2 (D33, D34); runs window/retention and design iteration under OQ-13 |
| `dashboard-server.js` | not a template: localhost static server. Onboard copies it to `.claude/server/` in the target repo (D32); `/major-tom:dashboard` and Desktop's launch.json both run that copy. Honors the `PORT` env var (autoPort). | done, smoke-tested |
| `launch-merge.js` | not a template: merges the managed `major-tom-dashboard` entry into the target's `.claude/launch.json` (Claude Desktop preview surface), preserving every other entry and field; refuses an unparseable file | done, scenario-tested |
| `settings-merge.js` | not a template: merges the three session defaults (`env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` `"1"`, `env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` `"1"`, `alwaysThinkingEnabled` `true`, D37) into the target's Claude Code settings: `.claude/settings.local.json` when it exists, else `.claude/settings.json` when it exists, else a fresh `.claude/settings.json`; every other key and every other `env` entry preserved; fails closed, writing nothing, when the existing file does not parse, is not a JSON object, or has a non-object `env` | done, scenario-tested |
| `gitignore-merge.js` | not a template: writes the mechanism-state ignore rules (`.claude/worktrees/`, `.claude/session/`, `.claude/server/`, D38 and D40) into the target repo's `.gitignore` as a managed block between the line markers `# major-tom:begin` and `# major-tom:end`: creates the file when missing, replaces only the block when the markers are present, appends the block when the file has none; every other line preserved, existing duplicate entries neither removed nor deduplicated, idempotent; fails closed, writing nothing, on malformed markers (begin without end, end without begin, end before begin, duplicates) or an unreadable file | done, scenario-tested |

Planned, not yet written: one doc template per lifecycle artifact (intent record, research
notes, decision record, spec/plan, review verdict, implementation log, verification report,
roadmap update, release record) and the `.knowledge/dashboard.html` template.
