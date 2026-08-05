<!-- major-tom:begin -->
# {{project.name}}

{{project.description}}

Agent instructions for this repository, rendered by the Major Tom onboard from
`.claude/major-tom.json`. Keep it lean: pointers over prose, the authoritative values live
in the config and the documents mapped below, never in memory of a conversation. This block
is managed: content between the major-tom markers is replaced on re-onboard; anything
outside the markers is yours and stays untouched.

## North star

Correctness and completeness over speed. Never decide to simplify the solution: at any
point where simplifying seems necessary, stop and ask the owner.

## Hard rules

- The config `.claude/major-tom.json` is the single source of truth for every onboard
  decision. Read values from it; never edit it by hand, re-run /major-tom:onboard instead.
- Ask before anything hard to reverse or outward-facing: publishing, deleting, sending
  over the network.
- A task or plan description is never authoritative: read the referenced source before
  acting on it.

## Document map

| Where | Role |
|---|---|
| `.claude/major-tom.json` | Every onboard decision: project, execution, stack, org, sources, specialists{{#if workspace}}, workspace{{/if}}. |
| `{{persistence.root}}/index.md` | The knowledge bundle index. Read this first, never walk every file; every knowledge file has a one-line entry here. |
| `{{persistence.root}}/memories/` | Atomic facts worth keeping across sessions. |
| `{{persistence.root}}/docs/` | Generated documents. |
| `{{persistence.root}}/runs/` | One record per workflow run; the onboard itself is the first. |
| `{{persistence.root}}/monitors/` | Monitoring artifacts. |
| `{{persistence.root}}/logs/` | Operational logs. |
{{#if sources.issueTracker.provider}}
| {{sources.issueTracker.provider}}, project {{sources.issueTracker.project}} | Issue tracker: the system of record for tasks. |
{{/if}}

## Harness

- Working model: {{execution.workingModel}}. The main session only orchestrates (INV-1): it
  never implements, researches, or writes artifacts itself. The single exception is explicit
  user consent, granted in the conversation, never assumed.
{{#if execution.team}}
- Delegation goes to the coordinator agent, which leads this team and reports back:
{{#each execution.team.members}}
  - {{this}}
{{/each}}
{{/if}}
- Every interaction follows the nine-phase lifecycle: think, understand, decide, spec/plan,
  review, implement, verify, track, publish. No phase is skipped silently.
- All generated knowledge lives **locally in this repository**, under `{{persistence.root}}/`,
  versioned alongside the code: memories, docs, runs, monitors, logs. Nothing lives only in
  a session or in an external service.
- `{{persistence.root}}/` is an Open Knowledge Format (OKF v0.2) bundle: every knowledge
  file is a markdown concept with YAML frontmatter carrying a `type`. When you add one,
  append its one-line entry to `{{persistence.root}}/index.md` in the same change.

## Organization

- Namespace: {{org.namespace}}
{{#if org.internalLibraries}}
- Internal libraries, compose-first:
{{#each org.internalLibraries}}
  - {{this.name}}: {{this.purpose}}
{{/each}}
{{/if}}
{{#if org.preferredLibraries}}
- Library policy:
{{#each org.preferredLibraries}}
  - Use {{this.use}}{{#if this.never}}, never {{this.never}}{{/if}}: {{this.reason}}
{{/each}}
{{/if}}

## Stack

{{#if stack.languages}}
- Languages:
{{#each stack.languages}}
  - {{this}}
{{/each}}
{{/if}}
{{#if stack.frameworks}}
- Frameworks:
{{#each stack.frameworks}}
  - {{this}}
{{/each}}
{{/if}}
{{#if stack.databases}}
- Databases:
{{#each stack.databases}}
  - {{this}}
{{/each}}
{{/if}}
{{#if stack.messaging}}
- Messaging:
{{#each stack.messaging}}
  - {{this}}
{{/each}}
{{/if}}
{{#if devops.ci}}
- CI: {{devops.ci}}
{{/if}}
{{#if devops.containers}}
- Containers: {{devops.containers}}
{{/if}}
{{#if devops.cloud}}
- Cloud: {{devops.cloud}}
{{/if}}

## Sources

{{#if sources.issueTracker.provider}}
- Issue tracker: {{sources.issueTracker.provider}}, project {{sources.issueTracker.project}}.
  Track work there, not in documents; record outcomes on the task itself.
{{/if}}
{{#if sources.sites}}
- Knowledge sites:
{{#each sources.sites}}
  - {{this.provider}}: {{this.reference}}
{{/each}}
{{/if}}
- Required MCP servers:
{{#each mcp}}
  - {{this}}
{{/each}}

{{#if specialists}}
## Specialists

Stack specialist agents installed by onboard into `.claude/agents/`; delegate stack-specific
work to them:

{{#each specialists}}
- {{this.name}} (from {{this.source}})
{{/each}}
{{/if}}

{{#if workspace}}
## Workspace

{{workspace.name}}, layout {{workspace.layout}}. Units and their dependency graph:

{{#each workspace.units}}
- {{this.name}}{{#if this.path}} (internal, `{{this.path}}`){{/if}}{{#if this.repo}} (external, `{{this.repo}}`){{/if}}{{#if this.dependsOn}}, depends on:{{/if}}
{{#each this.dependsOn}}
  - {{this}}
{{/each}}
{{/each}}
{{/if}}
<!-- major-tom:end -->
