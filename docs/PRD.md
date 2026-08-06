# Major Tom - Product Requirements Document

| | |
|---|---|
| **Status** | Draft, under iteration |
| **Version** | 0.13.2 |
| **Date** | 2026-08-04 |
| **Owner** | Miguel Ramos |
| **Scope** | The Major Tom plugin (Claude Code + GitHub Copilot CLI) |

---

## 1. Vision

Major Tom is a Claude Code / GitHub Copilot CLI plugin that defines and operates the software
development lifecycle of a project end to end: from product conception by the project manager,
through architecture conception by the architect, design definition and iteration by the designer,
construction by the technical team, and finally distribution.

The plugin is the harness: it brings the roles (static agents), the units of work (skills), the
compositions (workflows), and the supporting tools (memory, domain, documentation, roadmap,
visualization). The project being worked on keeps all resulting knowledge inside its own
directory. Nothing lives only in a session.

## 2. North star

Optimize for **correctness and completeness over speed**. This is a from-scratch rewrite of a
data-integrity tool: the knowledge the plugin persists is data whose integrity it must guarantee.
**Never simplify the solution to make progress.** At any simplification decision point, work
stops and the owner decides.

## 3. Problem statement

AI-assisted development today is session-bound and role-blind: context evaporates when the
session ends, every interaction is an undifferentiated "do X", and there is no persisted trail
from intention to release. Teams need a lifecycle discipline that agents follow the same way a
human team would, with distinct roles, explicit phase transitions, reviewable artifacts, and a
knowledge base that survives in the repository itself.

## 4. Goals

- **G1**: Define one canonical lifecycle every interaction runs on:
  `think → understand → decide → spec/plan → review → implement → verify → track → publish`.
- **G2**: Provide static agents covering the SDLC roles: product conception (project manager),
  architecture (architect), design definition and iteration (designer), construction (technical
  team), distribution.
- **G3**: Provide skills as atomic, individually invocable units of work.
- **G4**: Provide workflows as the only composition layer (workflows compose skills → agents).
- **G5**: Provide tools for: memory, domain, documentation, roadmap, visualization.
- **G6**: Persist all knowledge in the project directory: memories, docs, runs, monitors, logs.
- **G7**: Dual-publish: install-able in Claude Code and in GitHub Copilot CLI from this
  marketplace.

### Non-goals

- Not a project-management SaaS: no external server, no dashboard outside the repo.
- Not a replacement for the host runtime's own capabilities (task tracking, subagents,
  permissions): the plugin composes them, it does not reimplement them.
- No knowledge stored outside the project directory (no global caches as source of truth).

## 5. Roles and personas

| Role | SDLC responsibility | Agent (current roster) |
|---|---|---|
| Project manager | Product conception, requirements, roadmap | `project-manager` |
| Product validator | Challenges product assumptions | `product-validator` |
| Architect | Architecture conception, technical decisions | `architect` |
| Designer | Design definition and iteration | **missing (see OQ-1)** |
| Researcher | Domain and technical investigation | `researcher` |
| Technical team | Construction | *(project-specific, see OQ-2)* |
| Agent installer | Browses/installs project-specific specialist agents from sub-agents.directory (the mechanism behind OQ-2) | `agent-installer` |
| Refactor specialist | Code health during construction | `refactor-specialist` |
| Code reviewer | Review gate | `code-reviewer` |
| QA | Verification gate | `qa` |
| VCS operator | Branching, commits, releases | `vcs-operator` |
| Coordinator | Orchestrates multi-agent delegations, arbitrates, closes | `coordinator` |

## 6. The lifecycle (core concept)

Every interaction, from a one-line bugfix to a full product phase, is an instance of the same
lifecycle. Phases are traversed in order; a phase may be trivially short, but it is never
skipped silently.

| # | Phase | Question it answers | Primary artifact (persisted) |
|---|---|---|---|
| 1 | **think** | What is actually being asked? | intent record |
| 2 | **understand** | What do we know: domain, codebase, constraints? | research/context notes |
| 3 | **decide** | Which direction do we commit to, and why? | decision record |
| 4 | **spec/plan** | What exactly will be built, in what steps? | spec / plan |
| 5 | **review** | Does the spec/plan hold up before we build? | review verdict |
| 6 | **implement** | Build it. | code + implementation log |
| 7 | **verify** | Does the result meet the spec? | verification report |
| 8 | **track** | What moved: roadmap, monitors, follow-ups? | roadmap/monitor updates |
| 9 | **publish** | Ship it and persist what was learned. | release record + memory updates |

Phase definitions above are a first proposal. Inputs, outputs, gates, and role ownership per
phase are iteration targets (see OQ-3, OQ-4).

## 7. Product surface

### 7.1 Agents (static)

The fixed role roster from section 5, shipped with the plugin. Agents are personas with
operating rules, not task scripts. Project-specific technical agents (e.g. a Rust engineer for
a Rust repo) are out of the static roster; see OQ-2.

### 7.2 Skills (atomic units)

One skill = one individual scope. A skill is never a composite: it does one lifecycle-shaped
piece of work and can always be invoked directly on its own (**FR-3**). The skill catalog
(names, one per phase or otherwise) is an open design question; see OQ-3.

### 7.3 Workflows (the composition layer)

Workflows are the only place where composition happens: a workflow sequences skills and
delegates to agents (skills → agents). Anything a workflow does must also be reachable by
calling its constituent skills individually (**FR-4**).

### 7.4 Tools

Supporting capabilities, each with a persisted footprint in the project directory:

| Tool area | Purpose |
|---|---|
| Memory | Persist and recall knowledge across sessions |
| Domain | Capture the project's domain model / ubiquitous language |
| Documentation | Produce and maintain project docs |
| Roadmap | Track phases, milestones, progress |
| Visualization | Render lifecycle state, roadmap, architecture views |

Implementation surface for tools (MCP server, bundled scripts, skill-embedded) is undecided;
see OQ-5.

## 8. Composability model

- **Atomicity rule**: every scope is individual, never composite. If a unit needs another
  unit's work, that is a workflow, not a bigger skill.
- **Composition rule**: workflows compose skills → agents. Workflows contain no logic that
  belongs in a skill.
- **Direct invocation rule**: every skill is invocable standalone, outside any workflow.

## 9. Execution model

### 9.1 The orchestrator invariant (INV-1, may never fail)

**The main session only orchestrates.** Coordination and iteration with the user is the whole
of its job. It never executes work itself: no implementation, no research, no artifact writing.
All execution is delegated per the working model of 9.2.

**Single exception**: the user explicitly says yes to the main session doing a given piece of
work. Consent is granted by the user in the conversation; it is never assumed and never
inferred. Its exact scope (per request? per task? is it recorded anywhere?) is OQ-11.

### 9.2 Delegation modes (configured by the onboard workflow)

| Mode | Shape | Selection |
|---|---|---|
| **team** (default) | A team of **minimum 3 agents plus one coordinator**. The main session hands work to the coordinator; the coordinator runs and closes the delegation and reports back. | Default working model. |
| **subagents** | The main session delegates directly to individual subagents; no team layer, no coordinator in the loop. | Only when the user explicitly selects it during onboard. |

INV-1 holds in both modes: the mode changes who receives the delegation, never whether the main
session may execute.

### 9.3 Enforcement

A rule that may never fail cannot be prose-only: evidence from the pre-reset eval program
(compliance-budget finding, rounds 11 to 16) is that prose rules lose to mechanical guards at
the bottom tier. INV-1 therefore requires a mechanical guard (e.g. a PreToolUse hook policy) in
addition to prose in agents/skills. The guard design (what exactly is blocked, how consent
unblocks it) is OQ-11.

## 10. Onboard configuration file

Everything the user decides during onboard is persisted in one configuration file. That file is
the single source of truth: every other surface (agents, skills, workflows, tools, hooks) reads
its behavior from it, never from memory of the conversation.

### 10.1 Envelope (D1 and D3 decided; remaining points are OQ-10)

| Property | Value |
|---|---|
| Path | **`.claude/major-tom.json`** in the target repo (decided, D1) |
| Format | JSON, validated plugin-side against a JSON Schema shipped at the plugin root (`config.schema.json`, D3). The config file carries no `$schema` pointer. |
| Writer | The `onboard` workflow. Re-running onboard updates the file (never silently overwrites: it shows a diff of changed answers). |
| Readers | Every plugin surface, including the INV-1 guard of 9.3. |
| Manual edits | Open point in OQ-10 (allowed and validated on read? or onboard-only?). |

### 10.2 Principles

- **P1, total capture**: every onboard answer maps to exactly one addressable key in the file.
  No decision lives only in prose or only in the conversation.
- **P2, versioned schema**: the file carries a `schemaVersion`; schema changes ship with
  explicit migrations.
- **P3, strict validation**: unknown keys and invalid values are errors, not warnings
  (data-integrity stance from the north star).
- **P4, decisions not state**: the config stores what the user decided; execution state (runs,
  logs, monitors) lives in its own persistence areas (section 11).

### 10.3 Initial schema draft

Covers only what is decided so far; grows one section per closed decision.

File: `.claude/major-tom.json` (D1).

```json
{
  "schemaVersion": 1,
  "onboard": {
    "completedAt": "2026-08-04T10:00:00Z",
    "pluginVersion": "0.13.1"
  },
  "project": {
    "name": "",
    "description": "",
    "type": "existing",
    "topology": "single"
  },
  "execution": {
    "workingModel": "team",
    "team": {
      "coordinator": "coordinator",
      "members": []
    }
  },
  "persistence": {
    "root": ".knowledge"
  },
  "stack": {
    "languages": [],
    "frameworks": [],
    "databases": [],
    "messaging": []
  },
  "devops": {
    "ci": "",
    "containers": "",
    "cloud": ""
  },
  "org": {
    "namespace": "@acme",
    "internalLibraries": [],
    "preferredLibraries": []
  },
  "sources": {
    "issueTracker": { "provider": "", "project": "" },
    "sites": []
  },
  "mcp": ["codebase-memory"],
  "specialists": [
    { "name": "typescript-pro", "source": "sub-agents.directory" }
  ],
  "workspace": {
    "name": "",
    "layout": "domain",
    "units": [
      { "name": "example-service", "path": "services/example", "dependsOn": ["design-system"] },
      { "name": "design-system", "repo": "git@github.com:acme/design-system.git" }
    ],
    "run": { "compose": "" }
  }
}
```

| Key | Type | Filled by | Rule |
|---|---|---|---|
| `schemaVersion` | integer | automatic | Migration anchor (P2). |
| `onboard.completedAt` | ISO 8601 string | automatic | Provenance. Stamped by Finalize with the actual completion time; the interview writes a placeholder (first live test showed an 11-minute gap between assembly and completion). |
| `onboard.pluginVersion` | string | automatic | Which plugin version ran the onboard. |
| `project.name`, `project.description` | string | onboard interview | Identity of the target project. |
| `project.type` | `"new"` \| `"existing"` | onboard interview | Branches the onboard flow: bootstrap a repo vs adopt one. |
| `project.topology` | `"single"` \| `"mono-repo"` \| `"multi-repo"` | scan + interview | When not `"single"`, the `workspace` block is required; when `"single"`, it is forbidden (D6, schema if/then). |
| `execution.workingModel` | `"team"` \| `"subagents"` | onboard interview | `"subagents"` only on explicit user choice; `"team"` otherwise (9.2). |
| `execution.team.coordinator` | string | fixed | The coordinator agent; present only when `workingModel` is `"team"`. |
| `execution.team.members` | string[], `minItems: 3` | onboard interview/scan | The minimum-3 rule is schema-enforced; the coordinator does not count toward the 3. |
| `persistence.root` | string, fixed `".knowledge"` | automatic | Root of every generated artifact in the target repo (D2). Internal layout is OQ-7. |
| `stack.languages`, `stack.frameworks`, `stack.databases`, `stack.messaging` | string[] | scan, confirmed at interview | Detected stack of the target; drives specialist agent selection (OQ-2). |
| `devops.ci` | string | scan/interview | CI system, e.g. `"github-actions"`. |
| `devops.containers` | string | scan/interview | Local container setup, e.g. `"docker-compose"`. |
| `devops.cloud` | `"aws"` \| `"azure"` \| `"gcp"` \| `"vercel"` \| `""` | interview | Deployment target; context for the publish phase (9). |
| `org.namespace` | string, `@scope` form | interview | The organization's namespace/tenant, e.g. `@websublime`. Always required (D7); internal libraries typically publish under it. |
| `org.internalLibraries[]` | `{name, registry, purpose}` | interview | In-house libraries agents must know and prefer (compose-first). |
| `org.preferredLibraries[]` | `{use, never, reason}` | interview | Library policy with the rationale as data, not comments (P4); `reason` is required. |
| `sources.issueTracker` | `{provider, project, url?}` | interview | `provider` in closed enum `""` \| `jira` \| `github` \| `gitlab` \| `linear` \| `unblock` \| `trello` (D9); `project` is the provider-native reference (Jira key, GitHub owner/repo, GitLab path, Linear team, Trello board), empty exactly when `provider` is empty; `url` only for self-hosted instances. Pointer only. |
| `sources.sites[]` | `{provider, reference, url?}` | interview | Knowledge sites for the memory, roadmap, and docs tools (OQ-5, OQ-6); `provider` in closed enum `confluence` \| `sharepoint` \| `notion` \| `wiki` (D10); `reference` is the provider-native key (space, site, workspace); `url` for self-hosted. Pointers only; no ingestion capability is claimed. |
| `mcp` | string[] | scan/interview | MCP servers the project must have configured. Baseline enforced by the schema (D11, amended by D13): `"codebase-memory"` is always present; more may be added (e.g. `"jira"`, `"github"`). Canonical logical names; mapping to concrete server keys is the onboard's job. |
| `specialists` | `{name, source}[]` | scan proposes, interview confirms, Finalize records | Stack specialist agents installed by onboard (D24, D25). Prepare queries the authorized source and proposes candidates (inexact matches flagged, never silently substituted); the user confirms in the interview; Execute installs exactly the confirmed list; Finalize overwrites with the actual install outcome. Empty when none. |
| `workspace.name` | string | interview | Workspace identity; block present only for non-single topologies (D6). |
| `workspace.layout` | `"layered"` \| `"domain"` | interview | Structural convention the units follow. |
| `workspace.units[]` | `{name, path XOR repo, dependsOn?}` | scan + interview | The unit list is the dependency picture (D14): `path` (relative dir) declares an internal dependency living inside the workspace, `repo` (git URL) declares an external dependency with its own repository. Exactly one of the two per unit (schema `oneOf`); internal and external units may mix in any topology. |
| `workspace.units[].dependsOn` | string[] of unit names, optional | scan + interview | Edges of the workspace dependency graph (D15): which units this unit depends on. Name existence, no self-reference, and acyclicity are read-time semantic checks of the plugin, beyond JSON Schema. |
| `workspace.run.compose` | string (path) | scan/interview | Workspace-level compose file used by the verify phase (7). |

Reserved top-level keys, to be defined when their open question closes: `memory` (OQ-6),
`specialists` (OQ-2), `tools` (OQ-5), `gates` (OQ-4).

Evaluated and rejected from the intake sketch (see decision log): `methodology` (D4),
`contracts` (D5), `sources.deferred` (roadmap of a different product, not a target-repo
decision), and `workspace.topology`, `workspace.shared`, `cloud` as top-level (duplicates
resolved by the single-file model, D6).

## 11. Persistence model

All knowledge produced by the plugin lives **locally in the target repository**, versioned
alongside the code; nothing lives only in a session or an external service. The rendered
context states this explicitly so every agent knows it.

- **memories**: cross-session knowledge
- **docs**: specs, decisions, PRDs, architecture
- **runs**: records of workflow/skill executions
- **monitors**: tracked signals and their state
- **logs**: execution trail

The root is decided: all five areas live under **`.knowledge/`** at the target repo root (D2).
The file format is decided (D28, closes OQ-6): `.knowledge/` is an **OKF v0.2 bundle**
(Open Knowledge Format, the Google Cloud spec). Every non-reserved `.md` is a concept with
YAML frontmatter carrying a required non-empty `type`; optional fields are used only when
truthful (an unknown actor is omitted, never invented; `stale_after` only when a concept
genuinely expires). The bundle root carries the reserved **`index.md`** (progressive
disclosure: one line per knowledge file, grouped by area, `okf_version: 0.2` in its
frontmatter) so sessions read the index instead of walking every file; **whoever writes a
knowledge file appends its index line in the same change**. Onboard bootstraps the empty
bundle with its index; the onboard run record is the first concept.
Per-area internal layout and the git-tracked vs. git-ignored split remain open in OQ-7. The
configuration file stays outside this root at `.claude/major-tom.json` (D1), and its schema
lives at the plugin root (D3).

## 12. Onboard workflow and templates

The `onboard` workflow (FR-8) is the writer of the configuration file and the installer of
the harness. Four phases:

| Phase | Responsibility |
|---|---|
| **Check** | Preconditions: target is a git repo; existing `.claude/major-tom.json` means re-onboard (diff mode, OQ-10); the `codebase-memory` MCP is available (D11/D13); when it is missing, the blocked report tells the user to install it from https://deusdata.github.io/codebase-memory-mcp/ before relaunching; the plugin's own runtime assets (`config.schema.json`, `templates/context.md.tpl`) exist under the plugin root (D23); detect `project.type`. |
| **Prepare** | Scan (stack, devops, topology, unit discovery, dependency graph) plus specialist candidates from the authorized source, inexact matches flagged (D24); ends stage 1 by returning the detected facts plus self-describing instructions to the main session (D21). |
| **Execute** | Stage 2, relaunched by the session with the interviewed config in `args`. Validate against `config.schema.json` (fail closed: an invalid config is never written), write the config, bootstrap `.knowledge/` (D2), render templates, install exactly the interview-confirmed specialist list via `agent-installer` (D22, D24), generate the dashboard. |
| **Finalize** | Re-read and re-validate everything written, record the onboard itself as the first run in the runs area, report to the user. |

**The interview is the schema**: every interview question is derived from a config key and its
schema `description`; enums provide the options. There is no separate question list to drift.

### 12.1 Templates

Templates live at the repository root, `templates/` (D16 as corrected by D19), as the single
shared source for **both plugins**. The context content is rendered once, into `AGENTS.md`,
the agent-instructions file both hosts read; `CLAUDE.md` is a thin wrapper importing it via
the `@AGENTS.md` directive (D26), so nothing is duplicated. Placeholder grammar
is a minimal mustache-compatible subset (variables, `#if`, `#each`), specified in
`templates/README.md`; the renderer is an Execute-phase agent. Authoring and runtime are
split (D23): the repo root is where templates are authored, and `scripts/sync-templates.js`
mirrors them verbatim into each plugin dir (`plugins/<plugin>/templates/`), because the
installed plugin cache contains only the plugin directory and paths outside it do not exist
after install. The synced copies are generated artifacts, never edited directly; the
`--check` mode of the sync script gates drift before publish.
Planned template set: the context template (exists), one doc template per lifecycle artifact
(section 6), and the dashboard template.

### 12.2 Dashboard

`dashboard.html` is a static, self-contained HTML file inside the persistence root,
implemented in v1 (D31): hash-routed views (overview, config, git history, knowledge) over
a single embedded JSON data island; the template is authored once and never goes through
the mustache grammar, `render.js inject` replaces only the island (snapshot keys:
`generatedAt`, `config`, `git`, `knowledge`). The **track** lifecycle phase always
refreshes it (D18); today the onboard renders it and a re-onboard refreshes it.
Viewing has two surfaces (D31, amended by D32). CLI: `/major-tom:dashboard [start|stop]`
(default start) starts the localhost server and opens the browser, or surgically stops it
(the stop path verifies the listening PID is the dashboard server before killing, never a
stranger on the port; start refuses to double-start). Claude Desktop: onboard merges a managed
`major-tom-dashboard` entry into the target's `.claude/launch.json` (the Desktop Browser
pane surface; per-project, no plugin-path substitution exists there), pointing at a
generated copy of the server the onboard writes to `.claude/server/dashboard-server.js`,
with `autoPort: true` (the server honors the `PORT` env var). The merge is done by
`templates/launch-merge.js`: only the managed entry is rewritten, every other
configuration and field is preserved, and an unparseable existing file is a hard failure,
never overwritten. Monitors were rejected because they auto-start every session. The file
also works over `file://` since the data is embedded. The dashboard UI is **vanilla
HTML/CSS/JS permanently** (D32): no framework, no build pipeline; the single-file
self-contained artifact is the invariant, and design iterates within it. Growth over time is a real risk: the dashboard must stay a **windowed view**
over the run history, never the store itself; the runs area remains the source of truth.
Window and retention strategy, plus design/tech iteration: OQ-13.

### 12.3 Invocation and runtime facts

The entry point is closed (D20): scripts in the plugin's `workflows/` directory are a native
host surface, no skill wrapper needed (docs plus owner's local test). Plugin workflows are
namespaced: `meta.name: 'onboard'` runs as `/major-tom:onboard`. Requires Claude Code
v2.1.154+; organizations can disable workflows entirely, in which case the command does not
exist (known limitation). The full script API contract lives in
`plugins/major-tom/workflows/README.md`.

Two runtime constraints shape the design:

- **The script has no filesystem access.** Every write (config file, `.knowledge/`
  bootstrap, rendered templates, dashboard) is performed by agents the script spawns; the
  script only coordinates. This is INV-1 applied to the workflow itself.
- **No mid-run user input.** Only agent permission prompts can pause a run, so the
  schema-walk interview cannot happen inside the workflow. Resolution (D21, closes OQ-14):
  a two-stage protocol behind one user-visible command. Stage 1 (Check + Prepare) returns
  the detected facts plus self-describing instructions; the **main session** conducts the
  interview (it is the only surface with user interaction, and per INV-1 coordinating with
  the user is exactly its job) and relaunches the workflow itself with
  `args = { stage: "execute", config }`. The user never launches stage 2 by hand.

A third runtime fact closed the path-resolution question (D23): `${CLAUDE_PLUGIN_ROOT}` is
not substituted in workflow scripts or `agent()` prompts, only in plugin agent/skill
content, hooks, and MCP/LSP configs. The workflow therefore resolves paths through the
`onboard-check` plugin agent: its markdown body carries the substituted plugin root, it
reports that absolute path (plus the preconditions), and the script threads it into the
validate/render/finalize prompts. Stage 2 re-runs the check instead of trusting anything
the session passed in `args`.

Still open in OQ-12: the merge policy for an existing `CLAUDE.md` (managed blocks proposed
in `templates/README.md`).

## 13. Packaging and distribution

- One marketplace (`.claude-plugin/marketplace.json`), two plugins:
  - `plugins/major-tom`: Claude Code (agents, skills, workflows, hooks, tools).
  - `plugins/major-tom-copilot`: GitHub Copilot CLI variant (`.agent.md` roster; surface
    parity per host capability, see OQ-8).
- The Copilot variant is derived from the Claude variant, never authored independently.

## 14. Functional requirements

| ID | Requirement |
|---|---|
| FR-1 | Every plugin interaction maps to the nine-phase lifecycle of section 6. |
| FR-2 | The plugin ships the static agent roster of section 5. |
| FR-3 | Every skill is atomic and individually invocable. |
| FR-4 | Workflows are the only composition layer (skills → agents); no capability exists only inside a workflow. |
| FR-5 | Tools exist for memory, domain, documentation, roadmap, and visualization. |
| FR-6 | All produced knowledge (memories, docs, runs, monitors, logs) is persisted in the target project directory. |
| FR-7 | The marketplace dual-publishes Claude Code and Copilot CLI variants. |
| FR-8 | Onboarding exists as a workflow (`onboard`) that installs/bootstraps the harness into a target project, configures the working model (9.2), and writes the configuration file (section 10). |
| FR-9 | INV-1: the main session only orchestrates; it executes work only on explicit user consent (9.1). |
| FR-10 | Work is delegated per the configured working model: team (minimum 3 agents + 1 coordinator) or, only by explicit user choice at onboard, subagents-only. |
| FR-11 | Every onboard decision is persisted in the configuration file (P1); all plugin surfaces read it as the single source of truth. |

## 15. Current state (post-reset inventory, 2026-08-04)

- `plugins/major-tom`: 11 agents (the full roster of section 5, plus `onboard-check` for
  precondition and plugin-path resolution, D23),
  `workflows/onboard.js` (full two-stage body per D21: Check/Prepare returning scan facts,
  Execute/Finalize writing config, knowledge root, templates, specialists, run record; the
  dashboard snapshot rendered per D31) plus `workflows/README.md` (the workflow script API
  contract, D20), `commands/dashboard.md` (the `/major-tom:dashboard` on-demand server
  command, D31),
  `plugin.json` v0.13.1 (D30), `config.schema.json` at the plugin root (D3; JSON Schema
  draft-07 for the section 10 config, verified by a 45-case fixture suite).
- `templates/` at the repository root (D16, D19), the authoring source shared by both
  plugins: `README.md` (rendering contract, placeholder grammar) and `context.md.tpl`
  (first draft of the CLAUDE.md/AGENTS.md source). Synced verbatim into
  `plugins/*/templates/` by `scripts/sync-templates.js` (D23).
- `plugins/major-tom-copilot`: 9 agents (`.agent.md`), synced `templates/`, no manifest yet.
- `.claude-plugin/marketplace.json` v0.13.1 (D30), dual-plugin.
- No skills, no tools, no hooks, no persistence layer, no docs beyond this PRD.
- `temp/`: reference archive from previous iterations; read-only, not part of the product.

## 16. Open questions (iteration backlog)

| ID | Question |
|---|---|
| OQ-1 | Designer role: no designer agent exists. What is its scope (UX flows? UI artifacts? design system?) and its iteration loop with the PM/architect? |
| OQ-2 | Closed by D24 and D25: sub-agents.directory is the authorized specialist source; Prepare proposes candidates (inexact matches flagged), the interview confirms, Execute installs exactly the confirmed list, Finalize records the outcome in `specialists`. |
| OQ-3 | Skill catalog: one skill per lifecycle phase (nine skills), or a different decomposition? |
| OQ-4 | Phase ownership and gates: which agent owns each phase, and which phase transitions are human-in-the-loop gates? |
| OQ-5 | Tools implementation surface: MCP server, bundled scripts, or skill-embedded logic, per tool area? |
| OQ-6 | Closed by D28: `.knowledge/` is an OKF v0.2 bundle with a root `index.md` maintained on every added file. |
| OQ-7 | Persistence layout inside `.knowledge/` (root closed by D2): per-area structure, what is git-tracked vs. ignored (runs, logs), and file formats. First live test evidence: onboard writes `.claude/`, `.knowledge/`, `CLAUDE.md`, `AGENTS.md` and installed agents with no `.gitignore` guidance at all. |
| OQ-8 | Copilot CLI parity matrix: which surfaces (skills? workflows? hooks?) exist on Copilot, and what is the degradation story? |
| OQ-9 | Closed by D30: the version lineage continues; manifests bumped to 0.9.0 with the first post-reset PR. |
| OQ-10 | Config envelope (path closed by D1, schema reference closed by D3): re-onboard diff behavior and the manual-edit policy. |
| OQ-11 | INV-1 mechanics: which main-session actions does the guard block exactly, how does user consent unblock (scope: per request? per task?), and is consent recorded anywhere? |
| OQ-12 | Onboard mechanics (entry point closed by D20, runtime path resolution closed by D23): merge policy when the target already has a `CLAUDE.md` (managed blocks proposed and implemented in the renderer prompt, pending owner blessing). |
| OQ-13 | Narrowed by D31, D32, D33 (data island, inject mode, on-demand server, Desktop integration, vanilla-permanent, design ported, knowledge window 32 KB/file and 1 MB total). Remaining: runs windowing and retention (how older runs stay reachable), producers for the `lastRun` and `roadmap` snapshot keys (depend on OQ-3/OQ-4 and the track phase), further design iteration, and the live-data endpoint as the server's evolution. |
| OQ-14 | Closed by D21: the main session interviews between the two workflow stages and relaunches stage 2 itself. |

## 17. Decision log

Closed decisions, in order. A decision closes (all or part of) an open question and is only
reversed by a new decision entry, never by silent edit.

| ID | Date | Decision |
|---|---|---|
| D1 | 2026-08-04 | The onboard configuration file lives at `.claude/major-tom.json` in the target repo. Closes the path part of OQ-10. |
| D2 | 2026-08-04 | Every generated artifact lives under a single root, `.knowledge/`, at the target repo root. Closes the root-layout part of OQ-7. |
| D3 | 2026-08-04 | The config schema lives at the plugin root (`plugins/major-tom/config.schema.json`); validation is plugin-side only and the config file carries no `$schema` pointer. Closes the schema-reference part of OQ-10. |
| D4 | 2026-08-04 | No `methodology` key. The nine-phase lifecycle is the only methodology (G1); external methodologies (bmad, spec-kit, openspec) are not selectable. |
| D5 | 2026-08-04 | No `contracts` block, not even reserved: the contract registry describes a mechanism the plugin does not have (rule of commit 619da31). |
| D6 | 2026-08-04 | Single config file. `workspace` is a conditional block inside `major-tom.json`, required when `project.topology` is not `single` and forbidden when it is; never a separate file. |
| D7 | 2026-08-04 | The org block must declare the organization's namespace/tenant: `org.namespace`, required, `@scope` form (e.g. `@websublime`). |
| D8 | 2026-08-04 | `org.conventionsUrl` and `org.conventions` removed from the config. Convention knowledge is not config material. |
| D9 | 2026-08-04 | `sources.jiraProject` replaced by `sources.issueTracker`, an object `{provider, project, url?}`; `provider` is a closed enum: `""`, `jira`, `github`, `gitlab`, `linear`, `unblock`, `trello`. New providers enter by schema change (P3, P2). |
| D10 | 2026-08-04 | `sources.confluenceSpaces` and `sources.sharepointSites` replaced by `sources.sites[]`, objects `{provider, reference, url?}`; `provider` is a closed enum: `confluence`, `sharepoint`, `notion`, `wiki`. |
| D11 | 2026-08-04 | `mcp` declares required MCP servers, and the baseline is mandatory: `jira` and `codebase-memory` must be present in every config (schema-enforced via `contains`). |
| D12 | 2026-08-04 | Cross-unit dependencies live in `workspace.units[].dependsOn` as arrays of unit names, for both multi-repo and mono-repo topologies. Semantic validity (names exist, no self-reference, acyclic) is read-time plugin validation, not schema. |
| D13 | 2026-08-04 | Amends D11: `jira` removed from the mandatory MCP baseline. Only `codebase-memory` is schema-enforced; every other server, jira included, is optional. |
| D14 | 2026-08-04 | Reverses D12 and reshapes units: `workspace.units[]` is `{name, path XOR repo}` only. `path` declares an internal dependency (directory inside the workspace), `repo` an external dependency (own repository); the unit list itself is the dependency declaration. Per-unit `stack` and `dependsOn` removed. |
| D15 | 2026-08-04 | Amends D14: `dependsOn` returns to units as an optional array of unit names, so the config yields a full dependency graph (nodes = units, edges = dependsOn). Per-unit `stack` stays removed. |
| D16 | 2026-08-04 | Templates live at the plugin root (`plugins/major-tom/templates/`) as the single shared source for both hosts: one source template, two renders (`CLAUDE.md`, `AGENTS.md`). |
| D17 | 2026-08-04 | The onboard Prepare phase uses the `agent-installer` agent to install specialist agents matched to the detected stack into the target repo. Closes the mechanism part of OQ-2. |
| D18 | 2026-08-04 | The track lifecycle phase always refreshes `dashboard.html`. The dashboard is a windowed view over run history, never the store; the runs area stays the source of truth. |
| D19 | 2026-08-04 | Corrects D16: the templates directory lives at the repository root (`templates/`), not inside `plugins/major-tom/`, because it is shared by both plugins. |
| D20 | 2026-08-04 | Onboard entry point: the native plugin workflow surface. `workflows/onboard.js` runs as `/major-tom:onboard` (plugin namespace), no skill wrapper. Verified by docs and the owner's local test. Closes the entry-point part of OQ-12. |
| D21 | 2026-08-04 | Onboard is a two-stage protocol behind one command. Stage 1 (Check + Prepare) scans and returns facts plus instructions; the main session interviews the user (schema walk, detected values as defaults) and relaunches stage 2 itself with the full config in `args`. The user never invokes stage 2 manually. Closes OQ-14. |
| D22 | 2026-08-04 | Amends D17: `agent-installer` runs in Execute (stage 2), after the user confirms the stack in the interview, not in Prepare. Installing specialists from an unconfirmed scan would be premature. |
| D23 | 2026-08-05 | Closes the path-resolution half of OQ-12, forced by the first live test plus docs evidence: the install cache copies only the plugin directory (paths outside it do not exist after install), and `${CLAUDE_PLUGIN_ROOT}` is substituted only in plugin agent/skill content, hooks, and MCP/LSP configs, never in workflow scripts. Resolution, owner-picked: templates stay authored at the repo root (D19 stands for authoring); `scripts/sync-templates.js` mirrors them verbatim into each plugin dir as runtime artifacts (`--check` gates drift). Runtime paths come from the new `onboard-check` plugin agent, whose body receives the substitution and reports the absolute plugin root; the workflow threads that path into every prompt needing schema or template, and stage 2 re-runs the check rather than trusting session-passed paths. |
| D24 | 2026-08-05 | Closes the source half of OQ-2: sub-agents.directory is the authorized specialist source, with safeguards. Because no workflow agent can talk to the user, confirmation lives in the interview: Prepare queries the source and proposes candidates with the matched stack element in a reason field, inexact matches explicitly flagged, never silently substituted; the user confirms or deselects; Execute installs exactly the confirmed list, verifying the downloaded body by hash (frontmatter derivation from API metadata is the one expected transformation). Unreachable source means empty candidates, recorded in scan evidence. |
| D25 | 2026-08-05 | Closes the visibility gap the first live test exposed (P1, total capture): new required config key `specialists` `[{name, source}]`. The interview writes the confirmed plan; Finalize overwrites it with the actual install outcome (reconciling from disk if the installer agent dies). The context template renders the list, so re-onboard can diff it. Schema stays version 1: pre-release, only test configs exist. |
| D26 | 2026-08-05 | Ends the CLAUDE.md/AGENTS.md duplication: the context content is authored and rendered once, into `AGENTS.md` (the shared agent-instructions file both hosts read). `CLAUDE.md` becomes a thin wrapper from the new `claude.md.tpl`, whose managed block imports the content with the `@AGENTS.md` directive (Claude Code import syntax). |
| D27 | 2026-08-05 | Two template-scope calls after the owner's reference analysis (unblock's CLAUDE.md, PROCESS.md, AGENTS.md). First: communication languages (conversation vs artifacts) stay OUT of the config, a conscious exception to P1; do not re-propose the key. Second: the context template states only mechanisms that exist, no gates, teams, or process discipline before OQ-3/OQ-4 close (the 619da31 rule applied to templates). The template gains what the references proved valuable and the config already carries: a role header with pointers-over-prose, north star, hard rules, and a document map with the config as SSOT, the persistence areas, and the issue tracker as system of record when configured. |
| D28 | 2026-08-05 | Closes OQ-6: `.knowledge/` is an **OKF v0.2 bundle** (Open Knowledge Format, the Google Cloud spec; confirmed post-reset by the owner). Every non-reserved `.md` is a concept with YAML frontmatter carrying a required `type`; optional fields only when truthful (unknown actors omitted, `stale_after` only for genuinely expiring concepts). The bundle root carries the reserved `index.md` (`okf_version: 0.2`), one line per knowledge file grouped by area, so sessions read the index instead of walking files; the maintenance rule is that whoever adds a knowledge file appends its index line in the same change. Onboard bootstraps the empty bundle with its index; the onboard run record is the first concept (`type: run`, `generated.by: major-tom-onboard`). The rendered context also states explicitly that all knowledge (memories, docs, runs, monitors, logs) lives locally in the repository, versioned with the code. |
| D29 | 2026-08-05 | Canonical renderer, prompted by the second live test (the Execute agent had to improvise a renderer from the README grammar): `templates/render.js`, node with no dependencies, authored at the repo root and shipped inside each plugin by the D23 sync. Modes: `render` (stdout) and `apply` (managed-block write: replace between markers, append without markers, create when missing; outside-marker content never touched). Fails closed on missing files, unbalanced blocks, or unresolved syntax. The renderer agent runs it and never re-implements the grammar; `onboard-check` counts it among the required plugin assets. Grammar whitespace semantics precised in `templates/README.md` to match the implementation. Verified against the three topology fixtures: correct section presence, apply idempotence (apply twice equals render), outside-marker preservation, append on marker-less placeholder. |
| D30 | 2026-08-05 | Closes OQ-9: the version lineage continues, no reset to 0.1.0. `plugin.json` and `marketplace.json` bump to 0.9.0 with the first post-reset PR, owner-directed; from here every shipped iteration bumps the manifests. |
| D31 | 2026-08-05 | Dashboard v1, owner-scoped (routing, git history, config, knowledge; basic now, design and tech iterate later). The OQ-13 data-island proposal is implemented: `templates/dashboard.html` is static (hash-routed views: overview, config, git, knowledge; inline CSS/JS, light and dark), fed exclusively through the new `render.js inject` mode that replaces the `major-tom-data` island (JSON validated, `</script` escaped). Serving is on demand: the new `/major-tom:dashboard` command (plugin `commands/` surface, `${CLAUDE_PLUGIN_ROOT}` substitution) starts `templates/dashboard-server.js` (node, no deps, localhost-only, reads the file per request) as a background task and opens the browser; monitors were rejected because they auto-start every session. The server lives in the plugin, never written into the target repo: mechanism belongs to the plugin, the repo carries only `dashboard.html` and its data. Amended by D32: the never-written-into-the-repo clause is reversed for Desktop support. Onboard renders the first snapshot (config, 50-commit git window, knowledge file list); `onboard-check` requires the two new assets. |
| D32 | 2026-08-05 | Amends D31's server-location clause, forced by the `.claude/launch.json` facts (Claude Desktop Browser-pane surface: per-project, plugins cannot contribute entries, no plugin-path substitution, `autoPort` passes `PORT`): a repo-local copy is required for Desktop. Owner calls: (1) the onboard writes a generated copy of the server to **`.claude/server/`** (mechanism in Claude's config space, never in `.knowledge/`), refreshed on every onboard; (2) `.claude/launch.json` gets a **managed, namespaced entry** `major-tom-dashboard` via `templates/launch-merge.js`: only that entry is rewritten, all user entries and fields preserved, unparseable file refused, autoPort on (server honors `PORT`); (3) the dashboard UI is **vanilla permanently**, the framework option (shadcn/React or Preact build pipeline) is dropped; design iterates inside the single self-contained file. The CLI command prefers the repo copy for surface consistency, falling back to the plugin copy. |
| D33 | 2026-08-05 | Dashboard v2: the owner's Claude Design reference (`assets/major-tom-design/`) is the visual spec, ported 1:1 to vanilla (the design's runtime and demo data stay in assets as reference only). Owner calls from the port analysis: system font stacks instead of Google Fonts (self-containment wins over IBM Plex fidelity); sections whose data has no producer yet (lifecycle run phases, roadmap) ship with honest empty states wired to optional snapshot keys `lastRun` and `roadmap`; knowledge bodies embed with a 32 KB per-file and 1 MB total window in index order, truncation flagged (first hard numbers for OQ-13); both overview layouts (grid and console) ported. Snapshot schema v2: git entries gain `kind` (conventional prefix), `add`/`del` (numstat); knowledge files gain `type`, `size`, `updated`, `frontmatter`, capped `body`; `decisions` derived from OKF `type: decision` concepts. Verified by a DOM-stub runtime suite (10 checks, including hostile-subject escaping) plus inject and serve smoke tests. |
| D34 | 2026-08-05 | Amends D32's no-build-pipeline clause, owner-directed: single-file inline CSS+JS was becoming unmaintainable. "No framework" and the single self-contained artifact both stand; what changes is authoring. The dashboard is authored in `templates/dashboard/` (`index.html`, `dashboard.css`, real ES modules: data, state, ui, one per view, main) and `scripts/build-dashboard.js` (node, no dependencies, like sync/render/launch-merge) bundles it into the generated `templates/dashboard.html`: topo-sorted concatenation into one IIFE, CSS inlined, `--check` staleness gate. The bundler enforces a declared subset and fails closed outside it (static named relative `.mjs` imports, no cycles, no dynamic import, unique top-level names across modules). Dev loop needs no build: `dashboard-server.js` gains a directory mode (path-traversal-safe) and the browser loads the modules natively. The authoring directory is excluded from the plugin sync; only the built artifact ships. Behavior verified unchanged: DOM-stub suite green against the built artifact, byte-stable rebuild, dir-mode serve tested. |

## 18. Changelog

| Version | Date | Change |
|---|---|---|
| 0.1.0 | 2026-08-04 | Initial draft from kickoff: vision, lifecycle, surface, composability, persistence, open questions. |
| 0.1.1 | 2026-08-04 | Added north star (correctness and completeness over speed; never simplify). Applied repo style rule: no em/en dashes. |
| 0.1.2 | 2026-08-04 | Roles table: added the missing `agent-installer` (was in the shipped roster but absent from section 5). |
| 0.2.0 | 2026-08-04 | Execution model: INV-1 orchestrator invariant, team vs subagents delegation modes, enforcement stance. Onboard configuration file: envelope, principles P1-P4, initial schema draft. FR-9..FR-11, OQ-10, OQ-11. |
| 0.2.1 | 2026-08-04 | D1: config path fixed at `.claude/major-tom.json` (owner decision). Decision log section added; OQ-10 narrowed to schema-reference, re-onboard and manual-edit policy. |
| 0.3.0 | 2026-08-04 | Config schema merged with the owner's intake sketch: `project.type`/`topology`, `stack`, `devops`, `org`, `sources`, `mcp`, conditional `workspace`. D2 (`.knowledge/` root), D3 (schema at plugin root, plugin-side validation), D4 (no methodology key), D5 (no contracts block), D6 (single file, conditional workspace). OQ-7 and OQ-10 narrowed. |
| 0.3.1 | 2026-08-04 | `config.schema.json` shipped at the plugin root (D3): draft-07, strict (P3), all option semantics carried in enum + description. Verified with ajv: 19 fixture cases (3 valid topology/mode combinations, 16 violations including D2, D4, D5, P4). Section 14 inventory updated. |
| 0.3.2 | 2026-08-04 | D7: `org.namespace` required, `@scope` form. Schema and fixtures updated; suite now 22 cases, all passing. |
| 0.3.3 | 2026-08-04 | D8, D9, D10: org loses conventions; `sources` becomes `issueTracker` object plus `sites[]` objects, both with closed provider enums and provider-native references. Suite now 34 cases, all passing. |
| 0.3.4 | 2026-08-04 | D11: `mcp` baseline (`jira`, `codebase-memory`) mandatory, schema-enforced. D12: `workspace.units[].dependsOn` for cross-unit dependencies. Suite now 39 cases, all passing. |
| 0.3.5 | 2026-08-04 | D13: `jira` out of the mandatory MCP baseline; only `codebase-memory` remains schema-enforced. Suite still 39 cases, all passing. |
| 0.3.6 | 2026-08-04 | D14: units reduced to `{name, path XOR repo}` with internal/external dependency semantics; per-unit `stack` and `dependsOn` removed. Suite still 39 cases, all passing. |
| 0.3.7 | 2026-08-04 | D15: `dependsOn` back on units, optional, as the edges of the workspace dependency graph. Suite now 41 cases, all passing. |
| 0.4.0 | 2026-08-04 | New section 12, onboard workflow and templates: phase responsibilities (agent-installer in Prepare, D17), interview-is-the-schema principle, template source at plugin root (D16), dashboard refreshed by track as a windowed view (D18). `templates/` created with rendering contract and `context.md.tpl`. OQ-2 narrowed; OQ-12, OQ-13 added. Sections 12..17 renumbered to 13..18. |
| 0.4.1 | 2026-08-04 | D19 corrects D16: `templates/` moved to the repository root, shared by both plugins. Runtime resolution of the repo-root path folded into OQ-12. |
| 0.4.2 | 2026-08-04 | D20: entry point is the native plugin workflow surface (`/major-tom:onboard`), no skill wrapper. Workflow script API contract written to `workflows/README.md`. New section 12.3 with the two runtime constraints (script has no filesystem access; no mid-run user input). OQ-12 narrowed; OQ-14 added (interview placement). |
| 0.5.0 | 2026-08-04 | D21 closes OQ-14 (two-stage protocol, session interviews and relaunches stage 2 itself); D22 moves `agent-installer` to Execute. `onboard.js` body written: both stages, fail-closed validation, structured-output schemas per agent, managed-block template render, run record. Dashboard render pending OQ-13. |
| 0.5.1 | 2026-08-05 | Check phase: the missing-`codebase-memory` blocked report now directs the user to the install guide at https://deusdata.github.io/codebase-memory-mcp/ (owner directive). `onboard.js` syntax check passed (async-wrap parse). |
| 0.5.2 | 2026-08-05 | Packaging manifests aligned with post-reset reality: `marketplace.json` and `plugin.json` descriptions no longer claim mechanisms that do not exist (goal loop, HITL gates, three-tier memory, sync, export, budgeted context injection); dead `docs/setup-guide-copilot.md` reference removed; "Major Tome" typo and dashes fixed. Manifest `version` fields (0.8.0) left untouched, owner's to decide. |
| 0.6.0 | 2026-08-05 | First live test ran (old 0.8.0 install hijacked it; old plugin, GitHub marketplace, and cache removed). D23 closes OQ-12 path resolution: templates authored at repo root, synced into each plugin by `scripts/sync-templates.js`; new `onboard-check` plugin agent reports the substituted plugin root; `onboard.js` threads absolute schema/template paths and re-checks preconditions in stage 2. Blocked return added for missing plugin assets. |
| 0.6.1 | 2026-08-05 | Live-test bug fix: `args` can arrive as a JSON-encoded string, which made `args.stage` undefined and silently downgraded stage 2 to a stage 1 no-op. `onboard.js` now normalizes `args` (parses strings, logs and treats unparseable input as stage 1) and the stage 1 instructions tell the session to pass a structured object, never a string. |
| 0.6.2 | 2026-08-05 | First full onboard completed on the fixture. Fix from its Finalize report: `onboard.completedAt` is now stamped by Finalize with the actual completion time (the interview value is a placeholder; the test showed an 11-minute gap). Test evidence recorded in OQ-2 (unauthorized installer source, modified downloads, express matched to node-specialist) and OQ-7 (no `.gitignore` guidance). Specialist visibility in config: owner decision pending. |
| 0.7.0 | 2026-08-05 | D24 and D25 close OQ-2. Schema: required `specialists` key (`[{name, source}]`), suite now 45 cases, all passing. Workflow: Prepare proposes candidates from sub-agents.directory (inexact matches flagged), interview confirms, Execute installs exactly the confirmed list with hash verification, Finalize records the actual outcome (disk reconciliation if the installer dies). Context template renders the specialists section; synced to both plugins. |
| 0.7.1 | 2026-08-05 | D26: `context.md.tpl` renders to `AGENTS.md` only; new `claude.md.tpl` makes `CLAUDE.md` a thin wrapper importing `@AGENTS.md`. Renderer prompt and templates README updated; synced to both plugins. |
| 0.7.2 | 2026-08-05 | D27, from the owner's reference analysis: `context.md.tpl` restructured (role header with pointers-over-prose and managed-block notice, north star, hard rules, document map with config as SSOT and tracker as system of record); languages stay out of the config; no process mechanisms in the template before OQ-3/OQ-4 close. Synced to both plugins. |
| 0.8.0 | 2026-08-05 | D28 closes OQ-6: OKF v0.2 confirmed for `.knowledge/`. Onboard writer bootstraps the bundle `index.md`; Finalize writes the run record as an OKF concept and appends its index entry; section 11 rewritten (bundle, index maintenance rule, explicit locality); template document map gains the index row and the harness states OKF and local-only persistence. Synced to both plugins. |
| 0.9.0 | 2026-08-05 | Second full onboard passed clean (specialists confirmed and hash-verified, OKF bundle seeded, byte-idempotent re-render, no duplication). D29: canonical `templates/render.js` replaces the agent-improvised renderer; renderer prompt now runs it; `onboard-check` requires it; whitespace semantics precised in the README; template bug fixed (unit without `dependsOn` glued the end marker). Dashboard data-island direction recorded in OQ-13. |
| 0.9.1 | 2026-08-05 | Release prep, first post-reset PR: D30 closes OQ-9 (lineage continues), plugin and marketplace manifests bumped to 0.9.0, section 15 references refreshed. |
| 0.10.0 | 2026-08-05 | D31: dashboard v1. Static `dashboard.html` (hash-routed overview/config/git/knowledge over the data island), `render.js inject` mode (island replacement, script-close escaping, inject-idempotent), `dashboard-server.js` (localhost, per-request read), `/major-tom:dashboard` command, onboard renders the first snapshot and Finalize verifies it. Tested: inject with hostile subject strings, server 200/404/kill smoke test. OQ-13 narrowed to window/retention plus design iteration. |
| 0.11.0 | 2026-08-05 | D32: Claude Desktop integration. New `templates/launch-merge.js` (managed `major-tom-dashboard` entry in `.claude/launch.json`; scenario-tested: create, preserve user entries and unknown fields, idempotent update, refuse unparseable); onboard writer copies the server to `.claude/server/` and runs the merge; server honors `PORT` (autoPort, env-tested); command prefers the repo copy; Finalize verifies both. Framework dropped: dashboard is vanilla permanently. |
| 0.12.0 | 2026-08-05 | D33: dashboard v2, the owner's Claude Design ported to vanilla. Five views (overview grid/console, roadmap, git with search and kind filters, knowledge tree + viewer, config table/raw), collapsible rail, persisted theme toggle, system fonts, empty states for lastRun/roadmap. Snapshot schema v2 in the onboard builder (kind/numstat, knowledge frontmatter and capped bodies, derived decisions). DOM-stub runtime suite 10/10; templates README carries the island schema contract. |
| 0.13.0 | 2026-08-05 | D34: dashboard authoring split. `templates/dashboard/` (css file + ES modules architected as an app) plus `scripts/build-dashboard.js` (constrained bundler, fails closed, `--check` gate) emitting the generated single-file artifact; `dashboard-server.js` gains the directory dev mode; sync excludes the authoring dir. Suite re-run green against the built artifact. |
| 0.13.1 | 2026-08-06 | Owner-directed after a clean live test: `/major-tom:dashboard` accepts `start\|stop` via `$ARGUMENTS` (default start; unknown argument answers with usage). Stop is surgical: kills only PIDs on 4242/4243 whose command line is the dashboard server; start refuses to double-start and points the user to `/major-tom:dashboard stop`. |
| 0.13.2 | 2026-08-06 | Release prep, second PR: plugin and marketplace manifests bumped to 0.13.1 (D30 cadence), section 15 references refreshed, owner's design reference committed under `assets/major-tom-design/` (the D33 visual spec). |
