export const meta = {
  name: 'onboard',
  description: 'Install the Major Tom harness into the target repo: scan, interview, config, knowledge base, templates.',
  whenToUse: 'Onboard a repository onto Major Tom, or re-run to update its configuration.',
  phases: [
    { title: 'Check', detail: 'preconditions: git, existing config, required MCP' },
    { title: 'Prepare', detail: 'scan: stack, devops, topology, units, dependency graph' },
    { title: 'Execute', detail: 'validate fail-closed, write config, bootstrap .knowledge, render templates, install specialists' },
    { title: 'Finalize', detail: 're-validate everything written, record the run' },
  ],
}

// Two-stage protocol (PRD 12.3, D21). Stage 1 (no args): Check + Prepare, returns detected
// facts plus instructions; the main session interviews the user and relaunches with
// args = { stage: 'execute', config }. The runtime accepts no mid-run user input and the
// script has no filesystem access: agents do every read and write.

const PRECONDITIONS = {
  type: 'object',
  additionalProperties: false,
  required: ['isGitRepo', 'hasExistingConfig', 'existingConfig', 'codebaseMemoryMcpAvailable', 'pluginRoot', 'pluginAssetsPresent', 'projectTypeGuess', 'notes'],
  properties: {
    isGitRepo: { type: 'boolean' },
    hasExistingConfig: { type: 'boolean' },
    existingConfig: { type: ['object', 'null'] },
    codebaseMemoryMcpAvailable: { type: 'boolean' },
    pluginRoot: { type: 'string' },
    pluginAssetsPresent: { type: 'boolean' },
    projectTypeGuess: { enum: ['new', 'existing'] },
    notes: { type: 'string' },
  },
}

// The workflow script itself gets no ${CLAUDE_PLUGIN_ROOT} substitution and no filesystem
// access. Path resolution therefore goes through the plugin agent onboard-check, whose
// markdown body does get the substitution: it reports the absolute plugin root, and this
// script threads that path into every prompt that needs the schema or a template (D23).
function runPreconditions(phaseTitle) {
  return agent(
    'Run every check your role defines for the target repository (current working directory) and return the structured result.',
    { label: 'preconditions', phase: phaseTitle, schema: PRECONDITIONS, agentType: 'major-tom:onboard-check' }
  )
}

function blockedOnAssets(pre) {
  return {
    stage: 'blocked',
    at: 'check',
    reason: 'plugin assets missing (config.schema.json, templates, or templates/render.js not under the plugin root)',
    preconditions: pre,
    instructions: `Tell the user the installed major-tom plugin at ${pre.pluginRoot} is incomplete: config.schema.json, templates/context.md.tpl, templates/claude.md.tpl, and templates/render.js must exist there. Reinstall or update the plugin (for a dev checkout, run node scripts/sync-templates.js in the plugin repo), then relaunch /major-tom:onboard.`,
  }
}

const SCAN = {
  type: 'object',
  additionalProperties: false,
  required: ['stack', 'devops', 'topologyGuess', 'namespaceGuess', 'units', 'specialistCandidates', 'evidence'],
  properties: {
    stack: {
      type: 'object',
      additionalProperties: false,
      required: ['languages', 'frameworks', 'databases', 'messaging'],
      properties: {
        languages: { type: 'array', items: { type: 'string' } },
        frameworks: { type: 'array', items: { type: 'string' } },
        databases: { type: 'array', items: { type: 'string' } },
        messaging: { type: 'array', items: { type: 'string' } },
      },
    },
    devops: {
      type: 'object',
      additionalProperties: false,
      required: ['ci', 'containers', 'cloud'],
      properties: {
        ci: { type: 'string' },
        containers: { type: 'string' },
        cloud: { type: 'string' },
      },
    },
    topologyGuess: { enum: ['single', 'mono-repo', 'multi-repo'] },
    namespaceGuess: { type: 'string' },
    units: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name'],
        properties: {
          name: { type: 'string' },
          path: { type: 'string' },
          repo: { type: 'string' },
          dependsOn: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    specialistCandidates: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'source', 'reason'],
        properties: {
          name: { type: 'string' },
          source: { type: 'string' },
          reason: { type: 'string' },
        },
      },
    },
    evidence: { type: 'array', items: { type: 'string' } },
  },
}

const VALIDATION = {
  type: 'object',
  additionalProperties: false,
  required: ['valid', 'errors'],
  properties: {
    valid: { type: 'boolean' },
    errors: { type: 'array', items: { type: 'string' } },
  },
}

const WRITE_REPORT = {
  type: 'object',
  additionalProperties: false,
  required: ['written', 'failures'],
  properties: {
    written: { type: 'array', items: { type: 'string' } },
    failures: { type: 'array', items: { type: 'string' } },
  },
}

const RENDER_REPORT = {
  type: 'object',
  additionalProperties: false,
  required: ['written', 'failures', 'notes'],
  properties: {
    written: { type: 'array', items: { type: 'string' } },
    failures: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
}

const INSTALL_REPORT = {
  type: 'object',
  additionalProperties: false,
  required: ['installed', 'skipped', 'notes'],
  properties: {
    installed: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'source'],
        properties: {
          name: { type: 'string' },
          source: { type: 'string' },
        },
      },
    },
    skipped: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
}

const FINALIZE_REPORT = {
  type: 'object',
  additionalProperties: false,
  required: ['revalidated', 'runRecordPath', 'problems'],
  properties: {
    revalidated: { type: 'boolean' },
    runRecordPath: { type: 'string' },
    problems: { type: 'array', items: { type: 'string' } },
  },
}

// args may arrive as an object or as a JSON-encoded string depending on how the caller
// passed it; normalize before branching so stage 2 is not silently downgraded to stage 1.
let input = args
if (typeof input === 'string') {
  try {
    input = JSON.parse(input)
  } catch (e) {
    log('args arrived as an unparseable string; treating this as a stage 1 launch')
    input = null
  }
}

if (!input || input.stage !== 'execute') {
  phase('Check')
  const pre = await runPreconditions('Check')
  if (!pre) return { stage: 'aborted', at: 'check', reason: 'check agent did not complete' }
  if (!pre.isGitRepo) {
    return {
      stage: 'blocked',
      at: 'check',
      reason: 'target is not a git repository',
      preconditions: pre,
      instructions: 'Tell the user onboard requires a git repository. Offer to run git init, then relaunch /major-tom:onboard.',
    }
  }
  if (!pre.codebaseMemoryMcpAvailable) {
    return {
      stage: 'blocked',
      at: 'check',
      reason: 'codebase-memory MCP not available',
      preconditions: pre,
      instructions: 'Tell the user the codebase-memory MCP server is required (config baseline, PRD D11/D13) and must be installed before onboarding. Point them to the installation guide: https://deusdata.github.io/codebase-memory-mcp/. Once installed and configured, relaunch /major-tom:onboard.',
    }
  }
  if (!pre.pluginAssetsPresent) return blockedOnAssets(pre)

  phase('Prepare')
  const scan = await agent(
    [
      'You are the Prepare phase of the Major Tom onboard workflow, scanning the target repository (current working directory). Report evidence-based facts only; never invent. Empty strings and empty arrays where nothing is found.',
      'Detect:',
      '- stack: languages, frameworks, databases, messaging. Base each entry on manifests, lockfiles, or config files, and list the evidence file in evidence.',
      '- devops: ci (e.g. github-actions from .github/workflows), containers (e.g. docker-compose from compose files), cloud (only from explicit signals like vercel.json or terraform providers).',
      '- topologyGuess: single (one unit), mono-repo (workspace manifests or several packages in one repo), multi-repo (explicit references to sibling repositories).',
      '- namespaceGuess: the org scope if visible, e.g. the @scope of package names or publishConfig.',
      '- units: for mono-repo, each package/service with name and relative path, plus dependsOn edges derivable from internal manifest dependencies. For single topology return an empty array.',
      '- specialistCandidates: query the authorized specialist source (D24), https://sub-agents.directory/api, and propose one candidate per detected stack element that has a match. name is the agent slug, source is "sub-agents.directory", reason states which stack element it matches and whether the match is exact or a closest fit (e.g. "closest fit for express: no dedicated express agent upstream"). Never silently substitute: an inexact match must say so in reason. If the source is unreachable, return an empty array and record that in evidence.',
    ].join('\n'),
    { label: 'scan', schema: SCAN }
  )
  if (!scan) return { stage: 'aborted', at: 'prepare', reason: 'scan agent did not complete', preconditions: pre }

  return {
    stage: 'scan-complete',
    preconditions: pre,
    detected: scan,
    instructions: [
      'Main session, do this now, in order:',
      `1. Interview the user by walking the config schema at ${pre.pluginRoot}/config.schema.json. Ask only the keys marked as interview-filled that the scan did not settle, and present detected values as defaults to confirm. Enums are the options; their descriptions are the help text. Present detected.specialistCandidates (name, source, reason, flagging inexact matches) for the user to confirm or deselect: only confirmed entries go into the config as specialists [{name, source}], and nothing is installed beyond that list (D24). No candidates means specialists: [].`,
      '2. Assemble the full config object: schemaVersion 1, onboard.completedAt as the current UTC ISO 8601 time (a placeholder: Finalize re-stamps it with the actual completion time), onboard.pluginVersion from the installed plugin manifest, plus every interviewed and confirmed value.',
      '3. If preconditions.existingConfig is present this is a re-onboard: show the user a diff of changed answers and get confirmation before proceeding.',
      '4. Relaunch this workflow with args { stage: "execute", config: <the object> }. Pass args as a structured JSON object, never as a JSON-encoded string. Do not write any file yourself: the workflow writes everything.',
    ].join('\n'),
  }
}

const cfg = input.config
if (!cfg) {
  return {
    stage: 'failed',
    at: 'input',
    reason: 'args.config missing',
    instructions: 'Relaunch with args { stage: "execute", config: <full config object> }.',
  }
}
const cfgJson = JSON.stringify(cfg, null, 2)

phase('Execute')
// Re-locate the plugin root instead of trusting anything the session passed in args:
// onboard-check is the single source of truth for paths, in both stages.
const pre2 = await runPreconditions('Execute')
if (!pre2) return { stage: 'failed', at: 'execute-check', reason: 'precondition agent did not complete' }
if (!pre2.pluginAssetsPresent) return blockedOnAssets(pre2)
const schemaPath = `${pre2.pluginRoot}/config.schema.json`
const templatePath = `${pre2.pluginRoot}/templates/context.md.tpl`

const validation = await agent(
  [
    `Validate a Major Tom onboard config against the plugin schema at ${schemaPath}. Use node with ajv and ajv-formats (draft-07, strict mode with strictRequired disabled). Install them in a temporary directory if needed; never in the target repo.`,
    'Do not write any file into the target repository. Report valid plus the full ajv error list when invalid.',
    'Config to validate:',
    cfgJson,
  ].join('\n'),
  { label: 'validate config', schema: VALIDATION }
)
if (!validation) return { stage: 'failed', at: 'validation', reason: 'validation agent did not complete' }
if (!validation.valid) {
  return {
    stage: 'failed',
    at: 'validation',
    errors: validation.errors,
    instructions: 'Fail closed: nothing was written. Fix the config with the user and relaunch with args { stage: "execute", config }.',
  }
}

const write = await agent(
  [
    'You are the writer of the Major Tom onboard Execute phase, in the target repository (current working directory).',
    '1. Write .claude/major-tom.json with exactly this content, byte for byte, creating .claude/ if needed:',
    cfgJson,
    `2. Create the knowledge root ${cfg.persistence.root}/ with subdirectories: memories, docs, runs, monitors, logs. Put a .gitkeep file in each empty directory.`,
    `3. Create ${cfg.persistence.root}/index.md, the OKF v0.2 bundle index (D28): YAML frontmatter with okf_version: 0.2, then a heading per area (memories, docs, runs, monitors, logs) each stating it is empty for now, plus one line explaining the maintenance rule: every knowledge file added to the bundle gets a one-line entry here in the same change.`,
    'Report every path written and every failure. Change nothing else.',
  ].join('\n'),
  { label: 'write config + knowledge root', schema: WRITE_REPORT }
)
if (!write) return { stage: 'failed', at: 'write', reason: 'writer agent did not complete', validation }
if (write.failures.length > 0) {
  return {
    stage: 'failed',
    at: 'write',
    report: write,
    instructions: 'Report the write failures to the user; the config may be partially installed. Fix the cause and relaunch stage execute.',
  }
}

const [render, install] = await parallel([
  () =>
    agent(
      [
        'Render the Major Tom context templates into the target repository (current working directory) using the canonical renderer the plugin ships (D29). Never re-implement the template grammar yourself.',
        'Run exactly these two commands from the target repo root:',
        `node ${pre2.pluginRoot}/templates/render.js apply ${templatePath} .claude/major-tom.json AGENTS.md`,
        `node ${pre2.pluginRoot}/templates/render.js apply ${pre2.pluginRoot}/templates/claude.md.tpl .claude/major-tom.json CLAUDE.md`,
        'The renderer owns the managed-block semantics (replace between markers, append without markers, create when missing) and fails closed on unresolved template syntax. The content is authored once (D26): the context render goes to AGENTS.md; CLAUDE.md is the thin wrapper importing @AGENTS.md.',
        'After running, verify: both files exist with the major-tom markers, no {{ remains in either, and content outside the markers was not touched. If the renderer script is missing or exits non-zero, report it as a failure; do not improvise content.',
        'Report the files written, failures, and notes.',
      ].join('\n'),
      { label: 'render context templates', phase: 'Execute', schema: RENDER_REPORT }
    ),
  () =>
    agent(
      [
        'Install exactly this user-confirmed specialist list into the target repository (current working directory), per your agent-installer role. The list was confirmed in the onboard interview (D24); install nothing beyond it and substitute nothing:',
        JSON.stringify(cfg.specialists || [], null, 2),
        'Download each agent from its stated source, verify the body you write matches the download (frontmatter derivation from API metadata is the expected transformation; the body itself stays byte-identical, check it by hash), and install into .claude/agents/.',
        'If the list is empty, install nothing and say so in notes. Report every entry actually installed as {name, source}, and anything skipped or failed with the reason in skipped/notes.',
      ].join('\n'),
      { label: 'install specialists', phase: 'Execute', schema: INSTALL_REPORT, agentType: 'major-tom:agent-installer' }
    ),
])

phase('Finalize')
const finalize = await agent(
  [
    'You are the Finalize phase of the Major Tom onboard workflow, in the target repository (current working directory).',
    '1. Update onboard.completedAt in .claude/major-tom.json to the current UTC ISO 8601 time: the field records when the onboard actually completed, and the value written so far is an interview-time placeholder.',
    install
      ? [
          'Also set specialists in .claude/major-tom.json to exactly this list, the actual install outcome reported by the installer (D25); the interview-confirmed list already in the file was the plan, this is the result:',
          JSON.stringify(install.installed, null, 2),
        ].join('\n')
      : 'The installer agent did not complete, so its outcome is unknown. Reconcile from disk: for each entry in the specialists list already in .claude/major-tom.json, check whether .claude/agents/<name>.md exists; keep the entries that do, drop the ones that do not, and record the reconciliation in problems.',
    `2. Re-read .claude/major-tom.json and re-validate it against the schema at ${schemaPath} (same ajv setup as validation: draft-07, strict, strictRequired disabled, temporary install, nothing added to the target repo).`,
    `3. Verify ${cfg.persistence.root}/ exists with memories, docs, runs, monitors, logs and the bundle index.md at its root, and that CLAUDE.md and AGENTS.md exist at the repo root with major-tom managed block markers.`,
    `4. Write the run record: a markdown file in ${cfg.persistence.root}/runs/ named onboard-<UTC timestamp>.md summarizing this onboard (config keys written, files rendered, specialists installed, problems). Use the current UTC time. The record is an OKF v0.2 concept (D28): YAML frontmatter with type: run, a title, and generated: {by: major-tom-onboard, at: <the same UTC time>}.`,
    `5. Append the run record's one-line entry under the runs area in ${cfg.persistence.root}/index.md (the bundle index maintenance rule).`,
    'Report revalidated, the run record path, and every problem found.',
  ].join('\n'),
  { label: 'finalize + run record', schema: FINALIZE_REPORT }
)

return {
  stage: 'complete',
  validation,
  written: write,
  render: render || { written: [], failures: ['render agent did not complete'], notes: '' },
  specialists: install || { installed: [], skipped: [], notes: 'installer agent did not complete' },
  finalize: finalize || { revalidated: false, runRecordPath: '', problems: ['finalize agent did not complete'] },
  instructions: 'Report the outcome to the user: files written, templates rendered, specialists installed, run record path, and any problems. Mention that re-running /major-tom:onboard updates the configuration. The dashboard is not rendered yet (PRD OQ-13: template pending).',
}
