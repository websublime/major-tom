# The dashboard application

The application half of the dashboard: the code that computes the snapshot, and, from PR2
of the D43 chain onward, the server and the page that read it. It is authored here, inside
the plugin, and it is the only tree in this repository authored that way.

## Why it lives inside the plugin (D44 point 1)

A deliberate exception to the authoring-at-root rule of D19 and D23, taken with its reason
stated rather than drifted into.

An installed plugin's cache contains only the plugin's own directory: `${CLAUDE_PLUGIN_ROOT}`
resolves to a versioned copy of `plugins/major-tom/`, and paths outside it genuinely do not
exist at runtime (D44 establishes this by inspecting the installed cache, not by inferring
it from documentation). An app authored at the repository root would therefore not exist
when the plugin runs. The rule of D19 and D23 exists for assets shared by both distribution
variants; the app is not shared, and keeping it here also stops `plugins/major-tom-copilot/`
receiving a dashboard application it has no server to serve.

Two consequences follow:

- `scripts/sync-templates.js` does not touch this tree. It copies `templates/` into
  `plugins/*/templates/` and nothing else. Nothing here is a generated artifact of that
  sync, and nothing here has an authoring source somewhere else: these files are edited in
  place.
- Everything here is reached at runtime through the absolute plugin root that the
  `onboard-check` agent reports, the same path resolution the templates already use (D23).

## Dependency policy (D44 point 4)

Real dependencies are allowed. They are vendored as readable source files under `vendor/`,
with the version and the SHA-256 of the vendored file recorded beside them, and nothing is
ever installed anywhere: not in the target project, not in the plugin.

The policy holds only while the dependency set stays small and pure JavaScript. A dependency
carrying a native component can be neither vendored nor bundled, and that is the recorded
condition that reopens the question rather than something to work around quietly.

## What is here today

| Path | Role |
|---|---|
| `snapshot.js` | Computes the schema v2 snapshot for a repository and is the single implementation of the D33, D41 and D42 window rules. `node snapshot.js [--repo <dir>] [--out <file>]`, with `--repo` defaulting to the current working directory and `--out` to stdout. Reads `<repo>/.claude/major-tom.json`, emits the six required keys and omits `lastRun` and `roadmap`. Fails closed: a non-zero exit and a message on stderr. Zero dependencies beyond `vendor/js-yaml.cjs.js`. |
| `vendor/` | Vendored third-party source, with its provenance and its reverification commands in `vendor/README.md`. |

PR2 of the D43 chain brings the server and the dashboard page into this same tree, so the
tree holding one script today is the expected intermediate state, not an omission.
