export const meta = {
  name: 'onboard',
  description: 'Install the Major Tom harness into the target repo: scan, interview, config, knowledge base, templates.',
  whenToUse: 'Onboard a repository onto Major Tom, or re-run to update its configuration.',
  phases: [
    { title: 'Check', detail: 'preconditions: git, existing config, required MCP' },
    { title: 'Prepare', detail: 'scan: stack, devops, topology, units, dependency graph' },
    { title: 'Execute', detail: 'validate fail-closed, write config, bootstrap .knowledge, quarantine consented residue, render templates, install specialists' },
    { title: 'Finalize', detail: 're-validate everything written, record the run' },
  ],
}

// Two-stage protocol (PRD 12.3, D21). Stage 1 (no args): Check + Prepare, returns detected
// facts plus instructions; the main session interviews the user and relaunches with
// args = { stage: 'execute', config, quarantine }. The runtime accepts no mid-run user input
// and the script has no filesystem access: agents do every read and write.
//
// That no-input constraint is also why the quarantine consent of D55 rides on the relaunch and
// is not a question Execute asks: between the two stages is the only place in this design
// where a human can be asked anything at all.

const PRECONDITIONS = {
  type: 'object',
  additionalProperties: false,
  required: ['isGitRepo', 'hasExistingConfig', 'existingConfig', 'codebaseMemoryMcpAvailable', 'pluginRoot', 'pluginAssetsPresent', 'projectTypeGuess', 'residuePlan', 'notes'],
  properties: {
    isGitRepo: { type: 'boolean' },
    hasExistingConfig: { type: 'boolean' },
    existingConfig: { type: ['object', 'null'] },
    codebaseMemoryMcpAvailable: { type: 'boolean' },
    pluginRoot: { type: 'string' },
    pluginAssetsPresent: { type: 'boolean' },
    projectTypeGuess: { enum: ['new', 'existing'] },
    // residuePlan is the artifact map's answer, never the checker's own judgement: onboard-check
    // derives it from migration.js --plan, exactly as it derives the asset list from --assets
    // (D54). One entry per residue subject the plan names, each with the path, whether the
    // plugin may quarantine it, and the script's reason; for an ineligible entry the reason is
    // why the declared evidence did not prove the file ours, which is why the plugin leaves it
    // alone (D55). The array is empty when the target has no config for --plan to resolve the
    // persistence root from, and that is a fact rather than a failure: both residues exist only
    // because a past onboard wrote them, so a first onboard cannot carry any.
    residuePlan: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'eligible', 'reason'],
        properties: {
          path: { type: 'string' },
          eligible: { type: 'boolean' },
          reason: { type: 'string' },
        },
      },
    },
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

// The required-asset list is not written here and is not written in onboard-check either:
// both derive it from the artifact map (D54), which is the plugin's own declaration of what
// it needs and what it writes. It used to be hand-written in both places and the two copies
// had already drifted apart once.
function blockedOnAssets(pre) {
  return {
    stage: 'blocked',
    at: 'check',
    reason: 'plugin assets missing: the plugin root does not carry everything the artifact map requires',
    preconditions: pre,
    instructions: `Tell the user the installed major-tom plugin at ${pre.pluginRoot} is incomplete. Get the authoritative list by running: node ${pre.pluginRoot}/migration.js --assets ; it prints one plugin-root-relative path per line, and every one of them must exist under ${pre.pluginRoot}. Name the ones that do not. Ask the user to reinstall or update the plugin. For a dev checkout two of those paths are generated trees, rebuilt from the plugin repo with node scripts/sync-templates.js (which produces plugins/*/templates/ only) and node scripts/build-dashboard.js (which produces app/dashboard.html only); every other listed file is authored in place, so if one of those is missing the checkout itself is incomplete and neither script will produce it. If migration.js itself is the missing file, nothing can produce the list and the plugin install is broken outright. Then relaunch /major-tom:onboard.`,
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

// notes exists for the same reason RENDER_REPORT and INSTALL_REPORT have one (D53): without
// it, a writer with something to say that is neither a written path nor a failure has only
// failures to say it in, and any entry there halts the onboard.
const WRITE_REPORT = {
  type: 'object',
  additionalProperties: false,
  required: ['written', 'failures', 'notes'],
  properties: {
    written: { type: 'array', items: { type: 'string' } },
    failures: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
}

// The residue quarantine reports in four declared places, for the same reason the writer has
// notes (D53): a step whose outcomes do not all have a place put them in the wrong one. The
// script distinguishes three outcomes by itself, a rename performed, a subject left alone and
// a rename the filesystem refused, and notes takes everything else.
//
// failed is not the writer's failures and halts nothing. This step is cleanup of residue a
// PAST version of this plugin left behind; it is not part of onboarding this project, so a
// leftover file the filesystem refuses to rename must never get veto power over an otherwise
// correct onboard, which is what the writer's semantics would give it: any entry there stops
// the run before the templates are rendered, the specialists are installed and the run record
// is written. A failed rename is carried forward and reported instead. The file stays on disk,
// so the Finalize phase's migration.js --verify . reports it as RETIRED, that line goes into
// problems verbatim and mapVerified is false, exactly as for a subject the script skipped or a
// quarantine the user declined. The map keeps reporting what is on disk and nothing softens it.
//
// The consequence is worth naming: a failed rename and a declined quarantine converge on the
// same honest end state, the file still there and the problem reported. What tells them apart
// is the run record, which is why Finalize is told which of the two happened.
const QUARANTINE_REPORT = {
  type: 'object',
  additionalProperties: false,
  required: ['quarantined', 'skipped', 'failed', 'notes'],
  properties: {
    quarantined: { type: 'array', items: { type: 'string' } },
    skipped: { type: 'array', items: { type: 'string' } },
    failed: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
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

// revalidated and mapVerified are two different claims and are reported apart (D54): the
// first says the config still validates against the schema, which needs ajv and a temporary
// install, and the second says the target carries what the artifact map declares, which a
// script the plugin ships answers on its own. Collapsing them into one boolean would let a
// passing half hide a failing half.
const FINALIZE_REPORT = {
  type: 'object',
  additionalProperties: false,
  required: ['revalidated', 'mapVerified', 'runRecordPath', 'problems'],
  properties: {
    revalidated: { type: 'boolean' },
    mapVerified: { type: 'boolean' },
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
      reason: 'codebase-memory-mcp MCP not available',
      preconditions: pre,
      instructions: 'Tell the user the codebase-memory-mcp MCP server is required (config baseline, PRD D11/D13) and must be installed before onboarding. Point them to the installation guide: https://deusdata.github.io/codebase-memory-mcp/. Once installed and configured, relaunch /major-tom:onboard.',
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
      '4. If preconditions.residuePlan is not empty, get the user\'s decision on the quarantine now, because this is the only place it can be asked: the workflow runtime accepts no mid-run user input, so Execute can put no question to anyone (D55). Show every entry whose eligible is true, with its path and exactly what will happen to it: the file is renamed in place to <path>.retired. It is never deleted, an existing <path>.retired is never overwritten (that subject is skipped instead), and the plugin never touches the renamed file again, so whether it is ever removed is the user\'s call alone. Show every entry whose eligible is false with its reason, and say that those files are not touched at all: the plugin quarantines a file only where its own declared evidence proves the file is its own. Then get one explicit yes or no for the whole plan; do not ask path by path, do not proceed on silence, and do not argue the user into either answer. An empty residuePlan means there is nothing to ask.',
      '5. Relaunch this workflow with args { stage: "execute", config: <the object>, quarantine: <true|false> }. quarantine carries the answer from step 4, and is false whenever residuePlan was empty or the user said no. Pass args as a structured JSON object, never as a JSON-encoded string. Do not write any file yourself: the workflow writes everything.',
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
// The plugin never deletes a file in a user's repository. Residue is quarantined by renaming it
// in place, only where declared evidence proves the file is ours, and only where the user said
// yes in this session (D55). That consent was collected between the two stages because the
// runtime gives it nowhere else to be collected, so it arrives here as one boolean covering the
// whole plan. Anything that is not an explicit true is a no: a missing, malformed or absent
// answer must never be read as permission to touch someone's files.
const quarantineAuthorised = input.quarantine === true

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
    'Nothing below assumes an untouched repository. Where a step says ensure, bring the target to the stated shape and leave everything else that is already there alone; where it says write or copy, the file is this workflow\'s own product and replacing it is intended.',
    '1. Write .claude/major-tom.json with exactly this content, byte for byte, creating .claude/ if needed, and replacing any file already there: a re-onboard is expected and the main session has already shown the user the diff of the changed answers before relaunching.',
    cfgJson,
    `2. Ensure the knowledge root ${cfg.persistence.root}/ exists with the subdirectories memories, docs, runs, monitors, logs. Create only what is missing; never delete, empty or replace a directory that is already there, and never remove a file it already carries. Put a .gitkeep file in each empty directory. A directory that already holds files needs no .gitkeep and is not a problem: leave it as it is.`,
    `3. Ensure ${cfg.persistence.root}/index.md is the OKF v0.2 bundle index (D28): YAML frontmatter with okf_version: 0.2, a heading per area (memories, docs, runs, monitors, logs), and one line stating the maintenance rule, that every knowledge file added to the bundle gets a one-line entry here in the same change. The index must describe the bundle as it actually is on disk. If the file does not exist, create it and state under each area heading that the area is empty for now. If it already exists, do not overwrite it and do not treat that as a problem: it is the normal case, because the think gate (D51) requires a recorded intent before any command of this run may execute and the recorder (D36) creates the knowledge root, ${cfg.persistence.root}/runs/ and, for a substantive intent, this index and its first entry, as a side effect of recording. So: keep every entry the file already carries, add any area heading that is missing and the maintenance-rule line if it is absent, add a one-line entry for every file actually present in an area directory that has no entry yet, and write that an area is empty for now only under the areas whose directory is in fact empty.`,
    `4. Copy ${pre2.pluginRoot}/app/launcher.js byte for byte to .claude/server/launcher.js, creating .claude/server/ and replacing any launcher already there: it is generated mechanism state, gitignored by step 7 and never edited in the repository. It takes no substitution of any kind: copy it exactly as it is, never edit it, never rewrite a path inside it. What lands in the repo is a launcher and not a copy of the server (D32 as amended by D44 point 2): launch.json cannot reference the plugin path, so something has to sit in the repo, and a copy of the app would age silently, leaving a user who updates the plugin running the old dashboard until a re-onboard, with nothing to warn them. The launcher resolves the installed plugin at run time instead, so updating the plugin updates the dashboard.`,
    `5. Run: node ${pre2.pluginRoot}/templates/launch-merge.js .claude/launch.json`,
    'It merges the managed major-tom-dashboard entry into .claude/launch.json, preserving every other configuration and field. If it exits non-zero (an existing file that does not parse), report that as a failure; never hand-edit the file around it.',
    `6. Run: node ${pre2.pluginRoot}/templates/settings-merge.js .claude`,
    'It merges the project session defaults into the Claude Code settings file (D37): env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB "1", env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS "1", alwaysThinkingEnabled true.',
    'The script owns the file choice (.claude/settings.local.json when it exists, else .claude/settings.json, else a fresh .claude/settings.json) and the merge policy (every other key and every other env entry preserved). If it exits non-zero (an existing file that does not parse, is not a JSON object, or carries a non-object env), report that as a failure; never hand-edit the settings file around it.',
    `7. Run: node ${pre2.pluginRoot}/templates/gitignore-merge.js .`,
    'It merges the managed major-tom block into the repo root .gitignore, listing .claude/worktrees/ (the git worktrees for delegated work, D38), .claude/session/ (turn-correlation state, D36) and .claude/server/ (the generated dashboard launcher, D32 as amended by D44): all three are mechanism state that the mechanisms regenerate, never knowledge, so they stay out of version control.',
    'The script owns its managed block (markers # major-tom:begin and # major-tom:end) and preserves every other line, so re-running it changes nothing else. If it exits non-zero (an existing file whose markers are malformed, or a file that cannot be read), report that as a failure; never hand-edit the .gitignore around it.',
    'Report every path you wrote or changed in written, every failure in failures, and everything else you have to say in notes: what you found already in place and left alone, the entries you added to an index that already existed, a directory that was already populated, or a deviation you judged necessary and why.',
    'The failures list has one meaning and one only: a step that did not achieve its goal, such as a script exiting non-zero or a file that could not be written. Any entry in it halts the whole onboard, before the templates are rendered, the specialists are installed and the run record is written. It is not a place for notes, caveats, deviations or observations about pre-existing files. If every step above achieved its goal, failures must be an empty array, even when a file already existed or a directory was already populated.',
    'Change nothing else.',
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

// The quarantine is a step of its own and not part of the writer, because it is not part of
// onboarding this project at all: it cleans up residue a PAST version of this plugin left
// behind (D55). Inside the writer it would inherit that agent's failures semantics, under which
// any entry halts the run before the templates are rendered, the specialists are installed and
// the run record is written, and a leftover file the filesystem refuses to rename would get
// veto power over an otherwise correct onboard.
//
// Where it sits is fixed at both ends even so. It runs after the writer because --quarantine
// resolves the persistence root from the config the writer wrote in its step 1, and before
// Finalize because the artifact map reports what is on disk and knows nothing about anyone's
// consent, so the renames have to precede that verification. It runs before the render and
// install pair rather than inside it: renaming residue is disjoint from rendering, but
// sequencing it keeps the order deterministic and keeps one writer at a time touching the
// target. When the user did not consent there is no agent call at all.
let quarantine = null
if (quarantineAuthorised) {
  quarantine = await agent(
    [
      'You are the residue quarantine step of the Major Tom onboard Execute phase, in the target repository (current working directory). You run one command and report what it printed, line for line. You rename nothing yourself.',
      `Run: node ${pre2.pluginRoot}/migration.js --quarantine .`,
      'It is the only mode of the artifact map that writes, and all it writes is a rename: every residue subject whose declared evidence proves this plugin wrote it is renamed in place to <path>.retired. Nothing is deleted and no existing destination is overwritten, because the plugin never deletes a file in a user repository (D55). The user was shown this exact plan between the two stages of this workflow and said yes; that consent covers this run and no other.',
      'The script prints one line per subject: QUARANTINED <from> -> <to> for a rename it performed, SKIPPED <path>  -- <reason> for a subject it did not touch, and, on stderr, FAILED <path>  -- <error> for a rename the filesystem refused. Put every QUARANTINED line in quarantined, every SKIPPED line in skipped and every FAILED line in failed, one entry per line and in the script\'s own words. Everything else you have to say goes in notes. Report every line it printed: do not summarise, do not merge, do not reword and do not judge.',
      'A skip is the mechanism working and not a fault: a destination that already exists, or evidence that did not prove the file is ours, is precisely the case the script exists to refuse, and it still exits 0.',
      'A failed rename does not stop this onboard and is not yours to work around. Report it and stop there: do not retry it, do not change permissions, do not move the file some other way, and delete nothing. The file stays where it is, and the Finalize phase, which reports what is actually on disk, is what says so.',
      'Change nothing else in the repository.',
    ].join('\n'),
    { label: 'quarantine residue', phase: 'Execute', schema: QUARANTINE_REPORT }
  )
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
        'That is the whole of this step. Render nothing else. In particular, do not build a dashboard and do not run the snapshot script: the dashboard is no longer generated at onboard time at all (D43), the server computes its data on demand from the repository, and no dashboard artifact is written anywhere in the target project.',
        'You compute nothing in this step: you run the two commands and report what they did.',
        'Report the files written, failures, and notes.',
      ].join('\n'),
      { label: 'render context templates', phase: 'Execute', schema: RENDER_REPORT }
    ),
  () =>
    agent(
      [
        'Install exactly this user-confirmed specialist list into the target repository (current working directory), per your agent-installer role. The list was confirmed in the onboard interview (D24); install nothing beyond it and substitute nothing:',
        JSON.stringify(cfg.specialists || [], null, 2),
        'Download each agent from its stated source, verify the body you write matches the download byte for byte by hash (D24), and install into .claude/agents/.',
        'Derive each installed agent\'s tools frontmatter by the tool policy your role defines (D52), never from the upstream libs field: the read-only built-ins Read, Glob, Grep, plus one mcp__<server>__* entry per server in this project\'s mcp config list, in this order:',
        JSON.stringify(cfg.mcp || [], null, 2),
        'If the list is empty, install nothing and say so in notes. Report every entry actually installed as {name, source}, and anything skipped or failed with the reason in skipped/notes.',
      ].join('\n'),
      { label: 'install specialists', phase: 'Execute', schema: INSTALL_REPORT, agentType: 'major-tom:agent-installer' }
    ),
])

// What Finalize has to be told about the quarantine, and why it is told at all. The artifact
// map reports what is on disk and knows nothing about consent, nor about a rename the
// filesystem refused, so residue that is still there comes back out of migration.js --verify as
// RETIRED, lands in problems and sets mapVerified false. That is intended and nothing here
// softens it. What the map cannot say, and the run record must, is why each file is still
// there: declined, skipped, never eligible and failed to rename are four different facts that
// all reduce to the same RETIRED line, and a record that repeats the line without the reason
// leaves a reader with a defect of unknown origin (D55). A subject that was renamed is the one
// case that is not a problem at all: --verify reports the .retired form as quarantined, a state.
//
// pre2.residuePlan is the plan as it stood when Execute started, before anything in this stage
// ran, so it is the only place that still knows what was offered and what was never eligible.
const residuePlan = Array.isArray(pre2.residuePlan) ? pre2.residuePlan : []
const eligibleResidue = residuePlan.filter((entry) => entry && entry.eligible)
const ineligibleResidue = residuePlan.filter((entry) => entry && !entry.eligible)

// The quarantine outcome gets a place in the return whatever happened, so the main session
// never infers it from an absent key: an agent that did not complete is a fact about this run
// and must be reported as one, not degraded into silence. It does not abort the onboard, for
// the same reason a failed rename does not: this step is cleanup of a past version's residue,
// not part of onboarding this project.
const quarantineOutcome = quarantineAuthorised
  ? quarantine || {
      quarantined: [],
      skipped: [],
      failed: [],
      notes: 'the quarantine step did not complete, so what it did is unknown; migration.js --verify in Finalize is what reports the residue actually on disk',
    }
  : {
      quarantined: [],
      skipped: [],
      failed: [],
      notes:
        eligibleResidue.length > 0
          ? 'the user was offered the quarantine on this run and declined it, so nothing was renamed and nothing was deleted'
          : 'no residue in this repository was eligible for quarantine, so there was nothing to offer and nothing to run',
    }

const residueLines = []
if (quarantineAuthorised && !quarantine) {
  residueLines.push(
    'The user authorised the residue quarantine of D55 on this run and the step that performs it did not complete, so what it managed to do is unknown. Do not guess it and do not run the quarantine yourself. Step 5 reports what is actually on disk; the run record states that the quarantine was authorised, that its step did not complete, and that any residue step 5 reports is present for that reason, so nobody later reads it as a defect of unknown origin.'
  )
} else if (quarantineAuthorised) {
  residueLines.push(
    'The user authorised the residue quarantine of D55 on this run and it ran. This is what the script reported, in its own words:',
    JSON.stringify(quarantine, null, 2),
    'State it in the run record with the three outcomes kept apart rather than as a count. A renamed subject now sits at its .retired path, and step 5 reports that form as quarantined, which is a state and not a problem. A skipped subject and a rename that failed are both still on disk under the original name, so step 5 reports them as RETIRED and those lines go into problems verbatim; the record says which of them was skipped, with the reason the script gave, and which was a rename the filesystem refused, with the error it gave. A failed rename did not stop this onboard and is not a defect of unknown origin: it is a fact about this repository and the record states it as one.'
  )
} else if (eligibleResidue.length > 0) {
  residueLines.push(
    'The user was offered the residue quarantine of D55 on this run and declined it. Nothing was renamed and nothing was deleted, which is the plugin doing what it was told. These subjects are therefore still on disk:',
    JSON.stringify(eligibleResidue.map((entry) => entry.path), null, 2),
    'Step 5 reports them as RETIRED, those lines go into problems verbatim and mapVerified is false: the artifact map reports what is on disk and knows nothing about consent, and you neither weaken, filter nor reinterpret it. What the run record must add, beside those problems, is why they are there: the user was asked during this onboard and said no, and re-running /major-tom:onboard offers the quarantine again. Without that sentence a declined choice reads exactly like an unexplained defect.'
  )
}
if (ineligibleResidue.length > 0) {
  residueLines.push(
    'These residue subjects were not eligible for the quarantine, each with the reason the artifact map gave. They were never offered to the user and nothing in this run touched them, because the plugin quarantines a file only where declared evidence proves the file is ours. If step 5 reports them, record that this is why they are still present:',
    JSON.stringify(ineligibleResidue, null, 2)
  )
}

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
    `2. Re-read .claude/major-tom.json and re-validate it against the schema at ${schemaPath} (same ajv setup as validation: draft-07, strict, strictRequired disabled, temporary install, nothing added to the target repo). This step stays with you and is not covered by step 3: schema validation is draft-07 conformance over the whole document, which needs ajv and a temporary install, and the artifact map ships with zero dependencies and deliberately does not re-implement it. The map checks that the config is there and is ours; only ajv checks that it is valid.`,
    `3. Write the run record: a markdown file in ${cfg.persistence.root}/runs/ named onboard-<UTC timestamp>.md summarizing this onboard (config keys written, files rendered, specialists installed, problems). Use the current UTC time. The record is an OKF v0.2 concept (D28): YAML frontmatter with type: run, a title, and generated: {by: major-tom-onboard, at: <the same UTC time>}.`,
    residueLines.length > 0
      ? residueLines.join('\n')
      : 'This repository carried no residue from an older plugin version when this run started, so there is nothing about a quarantine to record.',
    `4. Append the run record's one-line entry under the runs area in ${cfg.persistence.root}/index.md (the bundle index maintenance rule).`,
    `5. Verify everything this onboard wrote by running, from the target repo root: node ${pre2.pluginRoot}/migration.js --verify .`,
    'That script is the artifact map (D54), the plugin\'s single declaration of everything it writes into a target project. It resolves the persistence root from the config you just wrote and checks every declared artifact, which is why this step is one command and not a list of assertions: a list written here is exactly what the map replaced, and the two lists it replaced had already drifted from each other. It runs last because it verifies the run record too, and the run record does not exist until step 3 has written it.',
    'It reports one line per artifact: ok; absent (declared optional or conditional, with the condition stated); MISSING; UNRECOGNISED (present at the declared path but not provably ours); UNEXPECTED (a file inside a directory the plugin owns whole that the map does not declare); RETIRED (an artifact an older plugin version wrote and this one no longer does).',
    'Do not re-assert in prose anything the map covers, and do not judge its output. Copy every MISSING, UNRECOGNISED, UNEXPECTED and RETIRED line into problems verbatim, and set mapVerified true only when the script exits 0. An absent line is not a problem and never goes into problems. If migration.js is not there or does not run, set mapVerified false and say so in problems; never substitute file-existence checks of your own for it.',
    'Nothing else of this phase moved into the map, and the split is deliberate: steps 1, 3 and 4 are writes rather than assertions, and step 2 is the one assertion the map cannot make. Every file-existence and managed-content assertion this phase used to state in prose is now in the map and is made by step 5.',
    'Report revalidated, mapVerified, the run record path, and every problem found.',
  ].join('\n'),
  { label: 'finalize + run record', schema: FINALIZE_REPORT }
)

// Four situations, and the main session has to tell them apart out loud, because three of them
// end with a file still sitting in the user's repository and only one of those three is a
// defect the plugin could have prevented (D55).
const quarantineInstructions =
  (!quarantineAuthorised
    ? eligibleResidue.length > 0
      ? 'Report the quarantine outcome first (D55): the user declined it on this run, so nothing was renamed and nothing was deleted. Any RETIRED line in the artifact map problems for those files is the user\'s own choice on this run and not a defect, the map simply reports what is on disk; say so plainly instead of listing it as a fault, and say that re-running /major-tom:onboard offers the quarantine again. '
      : ''
    : !quarantine
      ? 'Report the quarantine outcome first (D55): the user authorised it and the step that performs it did not complete, so what it did is unknown and nothing here guessed. Whatever the artifact map problems say about that residue is what is actually on disk. Say that the onboard itself finished regardless, because this step is cleanup of an older version\'s leftovers and not part of onboarding this project, and that re-running /major-tom:onboard offers the quarantine again. '
      : quarantineOutcome.failed.length > 0
        ? 'Report the quarantine outcome first (D55): name every residue file renamed in place to <path>.retired, every subject the script skipped with the reason it gave, and every rename that failed with the error it gave. A failed rename left that file exactly where it was and did not stop the onboard, which finished: the file shows up as a RETIRED line in the artifact map problems because the map reports what is on disk, so name it for what it is instead of leaving it as an unexplained fault, and say that re-running /major-tom:onboard tries the quarantine again. Nothing was deleted. '
        : 'Report the quarantine outcome first (D55): name every residue file renamed in place to <path>.retired, and every subject the script skipped with the reason it gave. Nothing was deleted, the renamed files are the user\'s to keep or remove, and the plugin will not touch them again. A skipped subject is still on disk and still shows up as a RETIRED line in the artifact map problems, which is the map reporting what it finds there. ') +
  (ineligibleResidue.length > 0
    ? 'Say too that some residue was never eligible for the quarantine, because the plugin\'s declared evidence did not prove those files are its own; they were not offered and nothing touched them, so a RETIRED line naming one of them is present for that reason. '
    : '')

return {
  stage: 'complete',
  validation,
  written: write,
  quarantine: quarantineOutcome,
  render: render || { written: [], failures: ['render agent did not complete'], notes: '' },
  specialists: install || { installed: [], skipped: [], notes: 'installer agent did not complete' },
  finalize: finalize || { revalidated: false, mapVerified: false, runRecordPath: '', problems: ['finalize agent did not complete'] },
  instructions:
    quarantineInstructions +
    'Report the outcome to the user: files written, templates rendered, specialists installed, the dashboard launcher written to .claude/server/, the run record path, whether the config revalidated and whether the target verified against the artifact map (D54), and any problems. Mention that re-running /major-tom:onboard updates the configuration and the generated files, and that /major-tom:dashboard opens the dashboard in the browser: the page computes its data from the repository every time it is loaded, and carries a refresh control, so nothing has to be re-run to see current data. Snapshot window and retention are still open (PRD OQ-13).',
}
