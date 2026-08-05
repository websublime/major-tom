# Templates

Source templates the onboard workflow renders into the target repository. This directory
lives at the repository root (D19) because it is shared by both plugins: the single template
source for both distribution variants (PRD packaging rule): the Copilot CLI output is derived
from the same source as the Claude Code output, never authored apart.

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
| `render.js` | not a template: the canonical renderer both templates go through | done, fixture-verified (three topologies, apply idempotence, outside-marker preservation) |

Planned, not yet written: one doc template per lifecycle artifact (intent record, research
notes, decision record, spec/plan, review verdict, implementation log, verification report,
roadmap update, release record) and the `.knowledge/dashboard.html` template.
