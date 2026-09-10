#!/usr/bin/env node
// Scenario suite for plugins/major-tom/workflows/onboard.js, the onboard workflow.
//
// Run with: node --test tests/onboard-workflow.test.js
//
// Node built-ins only: node:test and node:assert/strict, no runner to install, no
// dependencies. Every other suite in this directory drives a script as a child process,
// because every other script is a program. This one cannot: a workflow is not run by node.
// It is executed by the Claude Code workflow runtime, which injects a set of globals
// (agent, pipeline, parallel, phase, log, workflow, args, budget), forbids require and the
// filesystem, and treats the value the script returns as the run result. `node onboard.js`
// would fail on the first line.
//
// How this suite runs the real file, and what that costs.
//
// The source is read from disk on every run and never copied into this file, so what the
// tests execute is what the plugin ships. Two things are done to it, both mechanical:
//
//   1. `export const meta` becomes `const meta`. The runtime requires meta to be the first
//      statement of the file and a pure literal, and it is the file's only export; the
//      wrapper below is a function body, where an ESM export is a syntax error. Both facts
//      are asserted rather than assumed, so a file that grew a second export would fail here
//      instead of being silently half-loaded.
//   2. The whole source is wrapped in `return (async () => { ... })()` inside a
//      `new Function(...)` whose parameters are exactly the eight injected globals. That is
//      what makes the script's top-level `await` and its top-level `return` statements legal,
//      and it is why the injected names are the only free identifiers the code can reach:
//      inside a Function constructor body there is no require, no module and no __dirname,
//      which is the same isolation the real runtime gives it.
//
// What is real here: every branch, every guard, every schema object, every prompt string and
// every returned value, computed by the shipped file. What is stubbed: the eight globals.
// agent() records the prompt and the options it was called with and returns whatever the test
// declared for that label, so the suite can drive any path, including the paths where an agent
// returns null because the runtime stopped it.
//
// What this suite does NOT prove, and cannot. The prompts are strings here. Every assertion
// about a prompt says a piece of text reached an agent, never that an agent read it, obeyed
// it, or did the thing it describes. The writer step is asserted to carry the exact
// merge-script command lines; whether the agent runs them is outside any test in this
// repository. The same holds for the schemas: they are asserted to be handed to agent(), not
// to be enforced, since enforcement belongs to the runtime.
//
// One rule the suite keeps deliberately: it pins contracts, not prose. Agent labels and their
// order, agent types, report schemas, exact command lines, paths, booleans, returned stages
// and returned keys are pinned, because other files and other mechanisms depend on them.
// Sentences are not pinned. Where a piece of guidance has to be shown reaching a prompt, the
// assertion is on the shortest token that carries the contract (a field name, a path suffix, a
// command), and the comment above it says why that token is the contract and the sentence
// around it is only wording, free to improve without breaking a test.

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const REPO_ROOT = path.resolve(__dirname, '..')
const PLUGIN_ROOT = path.join(REPO_ROOT, 'plugins', 'major-tom')
const WORKFLOW = path.join(PLUGIN_ROOT, 'workflows', 'onboard.js')

// The globals the workflow runtime injects, in the order the wrapper passes them.
const RUNTIME_GLOBALS = ['agent', 'pipeline', 'parallel', 'phase', 'log', 'workflow', 'args', 'budget']

// The plugin root the stubbed onboard-check agent reports. The workflow gets no
// ${CLAUDE_PLUGIN_ROOT} substitution and threads this value into every prompt that needs a
// path (D23), so every path assertion below is built from this constant.
const PLUGIN = '/fixture/plugin-root'

// ---------------------------------------------------------------------------
// Loading the real workflow
// ---------------------------------------------------------------------------

function source() {
  return fs.readFileSync(WORKFLOW, 'utf8')
}

function loadWorkflow() {
  const text = source()
  assert.equal(text.indexOf('export const meta = {'), 0, 'meta must be the first statement of the workflow')
  assert.equal(text.split('\nexport ').length, 1, 'the workflow must carry no export other than the leading meta')
  const body = text.replace('export const meta = {', 'const meta = {')
  return new Function(RUNTIME_GLOBALS.join(', '), 'return (async () => {\n' + body + '\n})()')
}

// meta is a pure literal by the runtime contract, so it can be read without executing
// anything: this takes the first statement and evaluates only that.
function loadMeta() {
  const match = /^export const meta = (\{[\s\S]*?\n\})\n/.exec(source())
  assert.ok(match, 'meta must be a pure object literal ending at column zero')
  return new Function('return (' + match[1] + ')')()
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// These are the clock readings the stubbed agents report (D57). The script reads no clock of
// its own and reduces
// them into the phase spans the run record carries. They are deliberately not in call order:
// the Execute span is the earliest start and the latest finish across that phase's agents, and
// a fixture ordered by call would pass under a first-and-last implementation just as well. The
// renderer starts after the installer and finishes after it, so the latest finish in Execute
// belongs to an agent that is not the last one called.
const CLOCK = {
  preconditions: ['2026-03-01T10:00:00Z', '2026-03-01T10:00:20Z'],
  scan: ['2026-03-01T10:00:25Z', '2026-03-01T10:01:00Z'],
  validate: ['2026-03-01T10:02:00Z', '2026-03-01T10:02:30Z'],
  write: ['2026-03-01T10:02:31Z', '2026-03-01T10:03:40Z'],
  quarantine: ['2026-03-01T10:03:41Z', '2026-03-01T10:03:50Z'],
  render: ['2026-03-01T10:03:55Z', '2026-03-01T10:05:30Z'],
  install: ['2026-03-01T10:03:51Z', '2026-03-01T10:04:10Z'],
  finalize: ['2026-03-01T10:05:35Z', '2026-03-01T10:06:00Z'],
}

function clock(name) {
  return { startedAt: CLOCK[name][0], finishedAt: CLOCK[name][1] }
}

// These two build an agent that reported no clock reading at all, and one that reported a
// chosen pair.
function unstamped(report) {
  const copy = Object.assign({}, report)
  delete copy.startedAt
  delete copy.finishedAt
  return copy
}

function stamped(report, startedAt, finishedAt) {
  return Object.assign({}, report, { startedAt: startedAt, finishedAt: finishedAt })
}

function preconditions(overrides) {
  return Object.assign(
    {
      isGitRepo: true,
      hasExistingConfig: false,
      existingConfig: null,
      codebaseMemoryMcpAvailable: true,
      pluginRoot: PLUGIN,
      pluginAssetsPresent: true,
      projectTypeGuess: 'existing',
      residuePlan: [],
      notes: '',
      startedAt: CLOCK.preconditions[0],
      finishedAt: CLOCK.preconditions[1],
    },
    overrides || {}
  )
}

function scan(overrides) {
  return Object.assign(
    {
      stack: { languages: ['javascript'], frameworks: [], databases: [], messaging: [] },
      devops: { ci: 'github-actions', containers: '', cloud: '' },
      topologyGuess: 'single',
      namespaceGuess: '',
      units: [],
      specialistCandidates: [],
      evidence: ['package.json'],
      startedAt: CLOCK.scan[0],
      finishedAt: CLOCK.scan[1],
    },
    overrides || {}
  )
}

function config(overrides) {
  return Object.assign(
    {
      schemaVersion: 1,
      persistence: { root: '.knowledge' },
      specialists: [{ name: 'nextjs-expert', source: 'sub-agents.directory' }],
      mcp: ['codebase-memory-mcp'],
      execution: { workingModel: 'team', team: { coordinator: 'coordinator', members: ['architect', 'qa', 'code-reviewer'] } },
      onboard: { completedAt: '2026-01-01T00:00:00Z', pluginVersion: '0.26.0' },
    },
    overrides || {}
  )
}

// The two residue subjects the artifact map declares (D54), in the shape onboard-check
// reports them after reading `migration.js --plan`.
const ELIGIBLE_RESIDUE = {
  path: '.knowledge/dashboard.html',
  eligible: true,
  reason: 'the evidence holds, so --quarantine will move this one',
}
const INELIGIBLE_RESIDUE = {
  path: '.claude/server/dashboard-server.js',
  eligible: false,
  reason: 'the evidence does NOT hold (first line differs), so nothing will touch it',
}

const QUARANTINE_DONE = {
  quarantined: ['QUARANTINED   .knowledge/dashboard.html -> .knowledge/dashboard.html.retired'],
  skipped: ['SKIPPED       .claude/server/dashboard-server.js  -- the evidence that this is ours does not hold'],
  failed: [],
  notes: '',
  startedAt: CLOCK.quarantine[0],
  finishedAt: CLOCK.quarantine[1],
}
const QUARANTINE_FAILED = {
  quarantined: [],
  skipped: [],
  failed: ['FAILED        .knowledge/dashboard.html  -- EACCES: permission denied'],
  notes: '',
  startedAt: CLOCK.quarantine[0],
  finishedAt: CLOCK.quarantine[1],
}

function defaultResponses() {
  return {
    preconditions: preconditions(),
    scan: scan(),
    'validate config': Object.assign({ valid: true, errors: [] }, clock('validate')),
    'write config + knowledge root': Object.assign({ written: ['.claude/major-tom.json'], failures: [], notes: '' }, clock('write')),
    'quarantine residue': QUARANTINE_DONE,
    'render context templates': Object.assign({ written: ['AGENTS.md', 'CLAUDE.md'], failures: [], notes: '' }, clock('render')),
    'install specialists': Object.assign({ installed: [{ name: 'nextjs-expert', source: 'sub-agents.directory' }], skipped: [], notes: '' }, clock('install')),
    'finalize + run record': Object.assign({ revalidated: true, mapVerified: true, runRecordPath: '.knowledge/runs/onboard-x.md', problems: [] }, clock('finalize')),
  }
}

// ---------------------------------------------------------------------------
// Running the real workflow against stubbed globals
// ---------------------------------------------------------------------------

async function run(options) {
  const opts = options || {}
  const responses = Object.assign(defaultResponses(), opts.responses || {})
  const calls = []
  const logs = []
  const phases = []

  const agent = async (prompt, agentOpts) => {
    const label = agentOpts && agentOpts.label
    calls.push({ label, prompt, opts: agentOpts || {} })
    assert.ok(
      Object.prototype.hasOwnProperty.call(responses, label),
      'the workflow spawned an agent this test did not stub: ' + JSON.stringify(label)
    )
    const value = responses[label]
    return typeof value === 'function' ? value(prompt, agentOpts || {}, calls.length) : value
  }

  // The documented behaviour of the real parallel(): it awaits every thunk and resolves a
  // thunk that threw to null instead of rejecting.
  const parallel = (thunks) => Promise.all(thunks.map((thunk) => Promise.resolve().then(thunk).catch(() => null)))

  // The workflow is expected to use neither of these. A call would be a change of shape worth
  // failing on, not something to absorb quietly.
  const pipeline = () => {
    throw new Error('the workflow called pipeline(), which it does not use')
  }
  const workflow = () => {
    throw new Error('the workflow called workflow(), which it does not use')
  }

  const result = await loadWorkflow()(
    agent,
    pipeline,
    parallel,
    (title) => phases.push(title),
    (message) => logs.push(message),
    workflow,
    opts.args,
    { total: null, spent: () => 0, remaining: () => Infinity }
  )

  return { result, calls, logs, phases, labels: calls.map((call) => call.label) }
}

function stage2(args) {
  return Object.assign({ stage: 'execute', config: config() }, args || {})
}

function callFor(run_, label) {
  const found = run_.calls.filter((call) => call.label === label)
  assert.equal(found.length, 1, 'expected exactly one agent labelled ' + JSON.stringify(label))
  return found[0]
}

function promptFor(run_, label) {
  return callFor(run_, label).prompt
}

function has(prompt, token) {
  return prompt.indexOf(token) !== -1
}

// Every report schema ends its required list with the two stamps (D57), which one test below
// owns outright. The per-report tests are about that report's own places, so they read the
// required list with the stamps taken off and keep saying what they were written to say.
function places(schema) {
  assert.deepEqual(schema.required.slice(-2), ['startedAt', 'finishedAt'], 'a report schema without the two stamps')
  return schema.required.slice(0, -2)
}

// The run block reaches Finalize as a JSON literal inside the prompt. Reading it back is what
// lets the tests assert the structure the agent is handed instead of matching a sentence.
function runBlockFrom(prompt) {
  const start = prompt.indexOf('{\n  "workflow": "onboard"')
  assert.notEqual(start, -1, 'the Finalize prompt must carry the run block as JSON')
  let depth = 0
  for (let i = start; i < prompt.length; i += 1) {
    if (prompt[i] === '{') depth += 1
    else if (prompt[i] === '}') {
      depth -= 1
      if (depth === 0) return JSON.parse(prompt.slice(start, i + 1))
    }
  }
  return assert.fail('the run block JSON in the Finalize prompt is unterminated')
}

function runBlock(run_) {
  return runBlockFrom(promptFor(run_, 'finalize + run record'))
}

function phaseNamed(block, name) {
  const found = block.phases.filter((entry) => entry.name === name)
  assert.equal(found.length, 1, 'expected exactly one phase entry named ' + JSON.stringify(name))
  return found[0]
}

// ---------------------------------------------------------------------------
// The runtime contract of the file itself
// ---------------------------------------------------------------------------

test('meta is the first statement, a pure literal, and the only export', () => {
  const meta = loadMeta()
  assert.equal(meta.name, 'onboard')
  assert.equal(typeof meta.description, 'string')
  assert.deepEqual(
    meta.phases.map((entry) => entry.title),
    ['Check', 'Prepare', 'Execute', 'Finalize']
  )
})

test('every phase the run opens has a declared entry in meta', async () => {
  // The runtime matches phase() titles against meta.phases[].title exactly
  // (workflows/README.md), so a phase opened under a title meta does not declare loses its
  // progress group.
  const meta = loadMeta()
  const titles = meta.phases.map((entry) => entry.title)
  const stage1 = await run({})
  const stage2Run = await run({ args: stage2() })
  for (const title of stage1.phases.concat(stage2Run.phases)) {
    assert.ok(titles.indexOf(title) !== -1, 'phase() opened an undeclared group: ' + title)
  }
})

test('the workflow uses only parallel, never pipeline and never a nested workflow', async () => {
  const result = await run({ args: stage2({ quarantine: true }) })
  assert.equal(result.result.stage, 'complete')
})

// ---------------------------------------------------------------------------
// Stage 1, Check
// ---------------------------------------------------------------------------

test('the precondition agent is the plugin agent, not a generic one', async () => {
  const result = await run({})
  assert.equal(callFor(result, 'preconditions').opts.agentType, 'major-tom:onboard-check')
})

test('the precondition schema declares exactly the facts the workflow branches on', async () => {
  const result = await run({})
  const schema = callFor(result, 'preconditions').opts.schema
  assert.equal(schema.additionalProperties, false)
  assert.deepEqual(places(schema), [
    'isGitRepo',
    'hasExistingConfig',
    'existingConfig',
    'codebaseMemoryMcpAvailable',
    'pluginRoot',
    'pluginAssetsPresent',
    'projectTypeGuess',
    'residuePlan',
    'notes',
  ])
})

test('the precondition schema pins the residue plan entry shape (D55)', async () => {
  const result = await run({})
  const items = callFor(result, 'preconditions').opts.schema.properties.residuePlan.items
  assert.equal(items.additionalProperties, false)
  assert.deepEqual(items.required, ['path', 'eligible', 'reason'])
  assert.equal(items.properties.eligible.type, 'boolean')
})

test('a target that is not a git repository is blocked at check', async () => {
  const result = await run({ responses: { preconditions: preconditions({ isGitRepo: false }) } })
  assert.equal(result.result.stage, 'blocked')
  assert.equal(result.result.at, 'check')
  assert.match(result.result.reason, /git repository/)
  assert.deepEqual(result.result.preconditions.isGitRepo, false)
  assert.deepEqual(result.labels, ['preconditions'])
})

test('a missing codebase-memory-mcp is blocked at check and named', async () => {
  const result = await run({ responses: { preconditions: preconditions({ codebaseMemoryMcpAvailable: false }) } })
  assert.equal(result.result.stage, 'blocked')
  assert.equal(result.result.at, 'check')
  // The server key is the contract: the config baseline and the agent tool policy (D50, D52)
  // both grant against this exact name.
  assert.match(result.result.reason, /codebase-memory-mcp/)
  assert.deepEqual(result.labels, ['preconditions'])
})

test('an incomplete plugin root is blocked at check and sends the user to the artifact map', async () => {
  const result = await run({ responses: { preconditions: preconditions({ pluginAssetsPresent: false }) } })
  assert.equal(result.result.stage, 'blocked')
  assert.equal(result.result.at, 'check')
  // The command is the contract (D54): neither this workflow nor onboard-check carries the
  // asset list, both get it from the map.
  assert.ok(has(result.result.instructions, 'node ' + PLUGIN + '/migration.js --assets'))
  assert.deepEqual(result.labels, ['preconditions'])
})

test('a precondition agent that does not complete aborts before the scan', async () => {
  const result = await run({ responses: { preconditions: null } })
  assert.equal(result.result.stage, 'aborted')
  assert.equal(result.result.at, 'check')
  assert.deepEqual(result.labels, ['preconditions'])
})

// ---------------------------------------------------------------------------
// Stage 1, Prepare and the scan-complete return
// ---------------------------------------------------------------------------

test('stage 1 runs check then prepare and returns scan-complete', async () => {
  const result = await run({})
  assert.deepEqual(result.labels, ['preconditions', 'scan'])
  assert.equal(result.result.stage, 'scan-complete')
  assert.deepEqual(Object.keys(result.result).sort(), ['detected', 'instructions', 'preconditions', 'stage'])
})

test('the scan agent is given the detection schema', async () => {
  const result = await run({})
  const schema = callFor(result, 'scan').opts.schema
  assert.equal(schema.additionalProperties, false)
  assert.deepEqual(places(schema), [
    'stack',
    'devops',
    'topologyGuess',
    'namespaceGuess',
    'units',
    'specialistCandidates',
    'evidence',
  ])
})

test('a scan agent that does not complete aborts at prepare and keeps the preconditions', async () => {
  const result = await run({ responses: { scan: null } })
  assert.equal(result.result.stage, 'aborted')
  assert.equal(result.result.at, 'prepare')
  assert.equal(result.result.preconditions.pluginRoot, PLUGIN)
})

test('the interview step points at the config schema the plugin ships', async () => {
  const result = await run({})
  assert.ok(has(result.result.instructions, PLUGIN + '/config.schema.json'))
})

test('the relaunch step declares the stage 2 argument shape', async () => {
  const result = await run({})
  // These three tokens are the contract between the main session and the branch at the top of
  // stage 2: the stage value it tests, the config key it reads, and the consent boolean it
  // reads. The sentences around them are wording.
  assert.ok(has(result.result.instructions, 'stage: "execute"'))
  assert.ok(has(result.result.instructions, 'config: <the object>'))
  assert.ok(has(result.result.instructions, 'quarantine: <true|false>'))
})

test('the consent step names the field it reads and the destination it promises (D55)', async () => {
  const result = await run({ responses: { preconditions: preconditions({ residuePlan: [ELIGIBLE_RESIDUE] }) } })
  // residuePlan is the field the main session has to look up, and .retired is the destination
  // the user is being asked to consent to; both are mechanism, not phrasing.
  assert.ok(has(result.result.instructions, 'preconditions.residuePlan'))
  assert.ok(has(result.result.instructions, '<path>.retired'))
})

test('the scan-complete return carries the residue plan the session must show', async () => {
  const result = await run({
    responses: { preconditions: preconditions({ residuePlan: [ELIGIBLE_RESIDUE, INELIGIBLE_RESIDUE] }) },
  })
  assert.deepEqual(result.result.preconditions.residuePlan, [ELIGIBLE_RESIDUE, INELIGIBLE_RESIDUE])
})

// ---------------------------------------------------------------------------
// Argument normalisation
// ---------------------------------------------------------------------------

test('an object relaunch reaches stage 2', async () => {
  const result = await run({ args: stage2() })
  assert.ok(result.labels.indexOf('write config + knowledge root') !== -1)
  assert.equal(result.result.stage, 'complete')
})

test('a JSON-encoded relaunch reaches stage 2 exactly as the object does', async () => {
  const result = await run({ args: JSON.stringify(stage2()) })
  assert.ok(result.labels.indexOf('write config + knowledge root') !== -1)
  assert.equal(result.result.stage, 'complete')
})

test('the consent boolean survives the JSON-encoded form', async () => {
  const result = await run({ args: JSON.stringify(stage2({ quarantine: true })) })
  assert.ok(result.labels.indexOf('quarantine residue') !== -1)
})

test('an unparseable string is treated as a stage 1 launch and logged', async () => {
  const result = await run({ args: 'not json at all' })
  assert.equal(result.result.stage, 'scan-complete')
  assert.equal(result.logs.length, 1)
})

test('any stage other than execute is a stage 1 launch', async () => {
  const result = await run({ args: { stage: 'check' } })
  assert.equal(result.result.stage, 'scan-complete')
})

test('stage 2 without a config fails at input and states the shape to relaunch with', async () => {
  const result = await run({ args: { stage: 'execute' } })
  assert.equal(result.result.stage, 'failed')
  assert.equal(result.result.at, 'input')
  assert.ok(has(result.result.instructions, 'stage: "execute"'))
  assert.deepEqual(result.labels, [])
})

// ---------------------------------------------------------------------------
// Stage 2, preconditions and fail-closed validation
// ---------------------------------------------------------------------------

test('stage 2 re-locates the plugin root instead of trusting the arguments', async () => {
  const result = await run({ args: stage2() })
  const call = callFor(result, 'preconditions')
  assert.equal(call.opts.agentType, 'major-tom:onboard-check')
  assert.equal(call.opts.phase, 'Execute')
})

test('stage 2 blocks on an incomplete plugin root before validating anything', async () => {
  const result = await run({
    args: stage2(),
    responses: { preconditions: preconditions({ pluginAssetsPresent: false }) },
  })
  assert.equal(result.result.stage, 'blocked')
  assert.deepEqual(result.labels, ['preconditions'])
})

test('a stage 2 precondition agent that does not complete fails at execute-check', async () => {
  const result = await run({ args: stage2(), responses: { preconditions: null } })
  assert.equal(result.result.stage, 'failed')
  assert.equal(result.result.at, 'execute-check')
})

test('the validation agent gets the shipped schema path and the validation schema', async () => {
  const result = await run({ args: stage2() })
  const call = callFor(result, 'validate config')
  assert.ok(has(call.prompt, PLUGIN + '/config.schema.json'))
  assert.equal(call.opts.schema.additionalProperties, false)
  assert.deepEqual(places(call.opts.schema), ['valid', 'errors'])
})

test('the validation agent is handed the config byte for byte', async () => {
  const cfg = config()
  const result = await run({ args: stage2({ config: cfg }) })
  assert.ok(has(promptFor(result, 'validate config'), JSON.stringify(cfg, null, 2)))
})

test('an invalid config fails closed: nothing is written and the errors come back', async () => {
  const result = await run({
    args: stage2(),
    responses: { 'validate config': { valid: false, errors: ['must have required property persistence'] } },
  })
  assert.equal(result.result.stage, 'failed')
  assert.equal(result.result.at, 'validation')
  assert.deepEqual(result.result.errors, ['must have required property persistence'])
  assert.deepEqual(result.labels, ['preconditions', 'validate config'])
})

test('a validation agent that does not complete fails closed too', async () => {
  const result = await run({ args: stage2(), responses: { 'validate config': null } })
  assert.equal(result.result.stage, 'failed')
  assert.equal(result.result.at, 'validation')
  assert.deepEqual(result.labels, ['preconditions', 'validate config'])
})

// ---------------------------------------------------------------------------
// Stage 2, the writer
// ---------------------------------------------------------------------------

test('the writer is handed the config byte for byte', async () => {
  const cfg = config()
  const result = await run({ args: stage2({ config: cfg }) })
  assert.ok(has(promptFor(result, 'write config + knowledge root'), JSON.stringify(cfg, null, 2)))
})

test('the writer report declares three places and no fourth (D53, D55)', async () => {
  const result = await run({ args: stage2({ quarantine: true }) })
  const schema = callFor(result, 'write config + knowledge root').opts.schema
  assert.equal(schema.additionalProperties, false)
  // The quarantine is not the writer's work and must not be reported through the writer's
  // failures, which halt the onboard; it has a step and a report of its own.
  assert.deepEqual(places(schema), ['written', 'failures', 'notes'])
})

test('the writer carries the exact merge-script command lines', async () => {
  const result = await run({ args: stage2() })
  const prompt = promptFor(result, 'write config + knowledge root')
  assert.ok(has(prompt, 'node ' + PLUGIN + '/templates/launch-merge.js .claude/launch.json'))
  assert.ok(has(prompt, 'node ' + PLUGIN + '/templates/settings-merge.js .claude'))
  assert.ok(has(prompt, 'node ' + PLUGIN + '/templates/gitignore-merge.js .'))
})

test('the writer copies the launcher from the plugin to the declared path', async () => {
  const result = await run({ args: stage2() })
  const prompt = promptFor(result, 'write config + knowledge root')
  assert.ok(has(prompt, PLUGIN + '/app/launcher.js'))
  assert.ok(has(prompt, '.claude/server/launcher.js'))
})

test('the writer is told the knowledge root the config declares', async () => {
  const result = await run({ args: stage2({ config: config({ persistence: { root: '.brain' } }) }) })
  const prompt = promptFor(result, 'write config + knowledge root')
  assert.ok(has(prompt, '.brain/index.md'))
})

test('a writer failure halts before the quarantine, the renders, the installs and the record', async () => {
  const result = await run({
    args: stage2({ quarantine: true }),
    responses: {
      'write config + knowledge root': { written: [], failures: ['gitignore-merge.js exited 1'], notes: '' },
    },
  })
  assert.equal(result.result.stage, 'failed')
  assert.equal(result.result.at, 'write')
  assert.deepEqual(result.result.report.failures, ['gitignore-merge.js exited 1'])
  assert.deepEqual(result.labels, ['preconditions', 'validate config', 'write config + knowledge root'])
})

test('a writer that does not complete fails at write', async () => {
  const result = await run({ args: stage2(), responses: { 'write config + knowledge root': null } })
  assert.equal(result.result.stage, 'failed')
  assert.equal(result.result.at, 'write')
})

// ---------------------------------------------------------------------------
// The residue quarantine (D55)
// ---------------------------------------------------------------------------

test('consent runs the one command the artifact map exposes for it', async () => {
  const result = await run({ args: stage2({ quarantine: true }) })
  assert.ok(has(promptFor(result, 'quarantine residue'), 'node ' + PLUGIN + '/migration.js --quarantine .'))
})

test('the quarantine report declares four places (D53 applied to D55)', async () => {
  const result = await run({ args: stage2({ quarantine: true }) })
  const schema = callFor(result, 'quarantine residue').opts.schema
  assert.equal(schema.additionalProperties, false)
  assert.deepEqual(places(schema), ['quarantined', 'skipped', 'failed', 'notes'])
})

test('the quarantine runs after the writer and before the renders and the record', async () => {
  const result = await run({ args: stage2({ quarantine: true }) })
  assert.deepEqual(result.labels, [
    'preconditions',
    'validate config',
    'write config + knowledge root',
    'quarantine residue',
    'render context templates',
    'install specialists',
    'finalize + run record',
  ])
})

test('no consent, no quarantine agent at all', async () => {
  const result = await run({ args: stage2({ quarantine: false }) })
  assert.equal(result.labels.indexOf('quarantine residue'), -1)
  assert.equal(result.result.stage, 'complete')
})

test('only an explicit true is consent', async () => {
  for (const value of ['true', 1, 'yes', {}, undefined, null]) {
    const result = await run({ args: stage2({ quarantine: value }) })
    assert.equal(result.labels.indexOf('quarantine residue'), -1, 'quarantine ran for ' + JSON.stringify(value))
  }
})

test('the quarantine outcome always has a place in the return', async () => {
  const done = await run({ args: stage2({ quarantine: true }) })
  assert.deepEqual(done.result.quarantine, QUARANTINE_DONE)

  const declined = await run({
    args: stage2({ quarantine: false }),
    responses: { preconditions: preconditions({ residuePlan: [ELIGIBLE_RESIDUE] }) },
  })
  assert.deepEqual(Object.keys(declined.result.quarantine).sort(), ['failed', 'notes', 'quarantined', 'skipped'])
  assert.deepEqual(declined.result.quarantine.quarantined, [])
  assert.notEqual(declined.result.quarantine.notes, '')
})

test('a rename the filesystem refused does not halt the onboard', async () => {
  const result = await run({
    args: stage2({ quarantine: true }),
    responses: {
      preconditions: preconditions({ residuePlan: [ELIGIBLE_RESIDUE] }),
      'quarantine residue': QUARANTINE_FAILED,
    },
  })
  assert.equal(result.result.stage, 'complete')
  assert.deepEqual(result.result.quarantine.failed, QUARANTINE_FAILED.failed)
  assert.ok(result.labels.indexOf('render context templates') !== -1)
  assert.ok(result.labels.indexOf('finalize + run record') !== -1)
})

test('a quarantine agent that does not complete does not halt the onboard and is recorded', async () => {
  const result = await run({
    args: stage2({ quarantine: true }),
    responses: {
      preconditions: preconditions({ residuePlan: [ELIGIBLE_RESIDUE] }),
      'quarantine residue': null,
    },
  })
  assert.equal(result.result.stage, 'complete')
  assert.deepEqual(result.result.quarantine.quarantined, [])
  assert.notEqual(result.result.quarantine.notes, '')
  assert.ok(result.labels.indexOf('finalize + run record') !== -1)
})

test('what the quarantine actually did reaches the run record', async () => {
  const result = await run({
    args: stage2({ quarantine: true }),
    responses: { preconditions: preconditions({ residuePlan: [ELIGIBLE_RESIDUE] }) },
  })
  assert.ok(has(promptFor(result, 'finalize + run record'), QUARANTINE_DONE.quarantined[0]))
})

test('a declined quarantine reaches the run record with the paths still on disk', async () => {
  const result = await run({
    args: stage2({ quarantine: false }),
    responses: { preconditions: preconditions({ residuePlan: [ELIGIBLE_RESIDUE] }) },
  })
  assert.ok(has(promptFor(result, 'finalize + run record'), ELIGIBLE_RESIDUE.path))
})

test('residue that was never eligible reaches the run record with the reason', async () => {
  const result = await run({
    args: stage2({ quarantine: false }),
    responses: { preconditions: preconditions({ residuePlan: [INELIGIBLE_RESIDUE] }) },
  })
  assert.ok(has(promptFor(result, 'finalize + run record'), INELIGIBLE_RESIDUE.reason))
})

test('an unknown quarantine outcome is stated as unknown in the run record', async () => {
  const result = await run({
    args: stage2({ quarantine: true }),
    responses: {
      preconditions: preconditions({ residuePlan: [ELIGIBLE_RESIDUE] }),
      'quarantine residue': null,
    },
  })
  const prompt = promptFor(result, 'finalize + run record')
  // The token is the contract: the record has to say the outcome is unknown, because a record
  // that says nothing reads as a run where nothing needed doing.
  assert.ok(has(prompt, 'did not complete'))
  assert.equal(has(prompt, QUARANTINE_DONE.quarantined[0]), false)
})

test('a repository with no residue is told there is nothing to record', async () => {
  const result = await run({ args: stage2() })
  assert.equal(has(promptFor(result, 'finalize + run record'), ELIGIBLE_RESIDUE.path), false)
  assert.equal(result.result.quarantine.notes.length > 0, true)
})

// ---------------------------------------------------------------------------
// Render and install
// ---------------------------------------------------------------------------

test('the renderer is invoked through the shipped script, twice, with the declared targets', async () => {
  const result = await run({ args: stage2() })
  const prompt = promptFor(result, 'render context templates')
  assert.ok(
    has(prompt, 'node ' + PLUGIN + '/templates/render.js apply ' + PLUGIN + '/templates/context.md.tpl .claude/major-tom.json AGENTS.md')
  )
  assert.ok(
    has(prompt, 'node ' + PLUGIN + '/templates/render.js apply ' + PLUGIN + '/templates/claude.md.tpl .claude/major-tom.json CLAUDE.md')
  )
})

test('the render report declares three places', async () => {
  const result = await run({ args: stage2() })
  const schema = callFor(result, 'render context templates').opts.schema
  assert.equal(schema.additionalProperties, false)
  assert.deepEqual(places(schema), ['written', 'failures', 'notes'])
})

test('the installer is the plugin installer agent with the install report schema', async () => {
  const result = await run({ args: stage2() })
  const call = callFor(result, 'install specialists')
  assert.equal(call.opts.agentType, 'major-tom:agent-installer')
  assert.equal(call.opts.schema.additionalProperties, false)
  assert.deepEqual(places(call.opts.schema), ['installed', 'skipped', 'notes'])
})

test('the installer is handed exactly the confirmed specialists and the mcp list (D24, D52)', async () => {
  const cfg = config({ specialists: [{ name: 'rust-pro', source: 'sub-agents.directory' }], mcp: ['codebase-memory-mcp', 'github'] })
  const result = await run({ args: stage2({ config: cfg }) })
  const prompt = promptFor(result, 'install specialists')
  assert.ok(has(prompt, JSON.stringify(cfg.specialists, null, 2)))
  assert.ok(has(prompt, JSON.stringify(cfg.mcp, null, 2)))
})

test('both Execute writers share the phase group', async () => {
  const result = await run({ args: stage2() })
  assert.equal(callFor(result, 'render context templates').opts.phase, 'Execute')
  assert.equal(callFor(result, 'install specialists').opts.phase, 'Execute')
})

test('a render agent that does not complete degrades and does not halt the run', async () => {
  const result = await run({ args: stage2(), responses: { 'render context templates': null } })
  assert.equal(result.result.stage, 'complete')
  assert.deepEqual(result.result.render.failures, ['render agent did not complete'])
  assert.ok(result.labels.indexOf('finalize + run record') !== -1)
})

test('an installer that does not complete degrades and the record reconciles from disk', async () => {
  const result = await run({ args: stage2(), responses: { 'install specialists': null } })
  assert.equal(result.result.stage, 'complete')
  assert.deepEqual(result.result.specialists.installed, [])
  // The installed list is what Finalize writes back into the config (D25); with no outcome
  // there is no list to write, so the prompt must not carry one.
  assert.equal(has(promptFor(result, 'finalize + run record'), '"nextjs-expert"'), false)
})

test('the installed list, not the interviewed one, is what the record writes back (D25)', async () => {
  const installed = [{ name: 'rust-pro', source: 'sub-agents.directory' }]
  const result = await run({
    args: stage2(),
    responses: { 'install specialists': { installed, skipped: [], notes: '' } },
  })
  assert.ok(has(promptFor(result, 'finalize + run record'), JSON.stringify(installed, null, 2)))
})

// ---------------------------------------------------------------------------
// Finalize and the returned run result
// ---------------------------------------------------------------------------

test('finalize verifies the target through the artifact map, by command (D54)', async () => {
  const result = await run({ args: stage2() })
  assert.ok(has(promptFor(result, 'finalize + run record'), 'node ' + PLUGIN + '/migration.js --verify .'))
})

test('finalize re-validates against the shipped schema and reports the two claims apart', async () => {
  const result = await run({ args: stage2() })
  const call = callFor(result, 'finalize + run record')
  assert.ok(has(call.prompt, PLUGIN + '/config.schema.json'))
  assert.equal(call.opts.schema.additionalProperties, false)
  assert.deepEqual(places(call.opts.schema), ['revalidated', 'mapVerified', 'runRecordPath', 'problems'])
})

test('the run record is written under the knowledge root the config declares', async () => {
  const result = await run({ args: stage2({ config: config({ persistence: { root: '.brain' } }) }) })
  assert.ok(has(promptFor(result, 'finalize + run record'), '.brain/runs/'))
})

test('a finalize agent that does not complete degrades without hiding either claim', async () => {
  const result = await run({ args: stage2(), responses: { 'finalize + run record': null } })
  assert.equal(result.result.stage, 'complete')
  assert.equal(result.result.finalize.revalidated, false)
  assert.equal(result.result.finalize.mapVerified, false)
  assert.deepEqual(result.result.finalize.problems, ['finalize agent did not complete'])
})

test('the complete return carries exactly the declared keys', async () => {
  const result = await run({ args: stage2({ quarantine: true }) })
  assert.deepEqual(Object.keys(result.result).sort(), [
    'finalize',
    'instructions',
    'quarantine',
    'render',
    'specialists',
    'stage',
    'validation',
    'written',
  ])
})

test('the closing instructions name the quarantine outcome in each situation (D55)', async () => {
  const done = await run({ args: stage2({ quarantine: true }) })
  assert.ok(has(done.result.instructions, '.retired'))

  const failed = await run({
    args: stage2({ quarantine: true }),
    responses: { 'quarantine residue': QUARANTINE_FAILED },
  })
  assert.ok(has(failed.result.instructions, 'failed'))

  const declined = await run({
    args: stage2({ quarantine: false }),
    responses: { preconditions: preconditions({ residuePlan: [ELIGIBLE_RESIDUE] }) },
  })
  // The word the user has to hear is that this was their choice, not a fault of the plugin.
  assert.ok(has(declined.result.instructions, 'declined'))

  const nothing = await run({ args: stage2() })
  assert.equal(has(nothing.result.instructions, 'quarantine'), false)
})

test('the closing instructions still cover the rest of the run', async () => {
  const result = await run({ args: stage2() })
  // The dashboard command and the artifact map decision are what the session has to relay
  // beyond the file list; both are mechanisms, not phrasing.
  assert.ok(has(result.result.instructions, '/major-tom:dashboard'))
  assert.ok(has(result.result.instructions, '/major-tom:onboard'))
})

// ---------------------------------------------------------------------------
// The run record's timing block (D57)
// ---------------------------------------------------------------------------

test('the script reads no clock, which is the constraint the whole design exists for', () => {
  // The runtime makes these throw, so a call would not be a wrong number: it would end the run
  // (workflows/README.md, hard constraints). The stamps exist because of this line.
  const text = source()
  assert.equal(has(text, 'Date.now('), false)
  assert.equal(has(text, 'new Date('), false)
  assert.equal(has(text, 'Math.random('), false)
})

test('every report schema carries the two stamps, in one fixed UTC format', async () => {
  const stage1 = await run({})
  const stage2Run = await run({ args: stage2({ quarantine: true }) })
  const schemas = new Map()
  for (const call of stage1.calls.concat(stage2Run.calls)) schemas.set(call.label, call.opts.schema)
  // These eight report-producing agents are every agent the workflow spawns.
  assert.deepEqual(Array.from(schemas.keys()).sort(), [
    'finalize + run record',
    'install specialists',
    'preconditions',
    'quarantine residue',
    'render context templates',
    'scan',
    'validate config',
    'write config + knowledge root',
  ])
  for (const [label, schema] of schemas) {
    assert.equal(schema.additionalProperties, false, label)
    assert.deepEqual(schema.required.slice(-2), ['startedAt', 'finishedAt'], label)
    for (const field of ['startedAt', 'finishedAt']) {
      assert.equal(schema.properties[field].type, 'string', label + '.' + field)
      // The pattern is what makes the reduction sound. The spans are compared as strings, which
      // is exact only while every stamp is the same fixed-width UTC form.
      const pattern = new RegExp(schema.properties[field].pattern)
      assert.equal(pattern.test('2026-03-01T10:00:00Z'), true, label + '.' + field)
      assert.equal(pattern.test('2026-03-01T10:00:00.000Z'), false, label + '.' + field)
      assert.equal(pattern.test('2026-03-01T10:00:00+01:00'), false, label + '.' + field)
      assert.equal(pattern.test('2026-03-01 10:00:00'), false, label + '.' + field)
    }
  }
})

test("every phase's agents are told to read the real clock twice", async () => {
  const stage1 = await run({})
  const stage2Run = await run({ args: stage2({ quarantine: true }) })
  for (const call of stage1.calls.concat(stage2Run.calls)) {
    // The command is the contract and the sentence around it is only wording. It is the only
    // thing that produces the exact format the schemas pin, and the script cannot produce it.
    assert.ok(has(call.prompt, 'date -u +%Y-%m-%dT%H:%M:%SZ'), call.label)
    assert.ok(has(call.prompt, 'startedAt'), call.label)
    assert.ok(has(call.prompt, 'finishedAt'), call.label)
  }
})

test('the run block states the workflow, the working model and nothing invented', async () => {
  const block = runBlock(await run({ args: stage2({ quarantine: true }) }))
  assert.deepEqual(Object.keys(block).sort(), ['mode', 'phases', 'startedAt', 'workflow'])
  assert.equal(block.workflow, 'onboard')
  assert.equal(block.mode, 'team')
  // The block carries no resumed flag, because the runtime exposes no signal a script can read
  // to tell a fresh run from a replayed one, and a flag nothing can set is worse than an absence
  // the PRD explains.
  assert.equal('resumed' in block, false)
})

test('a config with no execution block leaves mode out rather than writing it empty', async () => {
  const cfg = config()
  delete cfg.execution
  const block = runBlock(await run({ args: stage2({ config: cfg }) }))
  assert.equal('mode' in block, false)
})

test('the block carries the three phases the script measured and leaves Finalize to the writer', async () => {
  const result = await run({ args: stage2({ quarantine: true }) })
  const block = runBlock(result)
  assert.deepEqual(block.phases.map((entry) => entry.name), ['Check', 'Prepare', 'Execute'])
  // Finalize is the agent's own entry because the phase is writing the record it appears in, so
  // its end is not knowable here. The three tokens are the values the record must carry.
  const prompt = promptFor(result, 'finalize + run record')
  assert.ok(has(prompt, 'Finalize'))
  assert.ok(has(prompt, 'active'))
  assert.ok(has(prompt, 'no finishedAt'))
})

test('the phases that ran in stage 1 are listed without stamps, never with empty ones', async () => {
  const block = runBlock(await run({ args: stage2() }))
  // Stage 1 is a separate run of this script and its reports do not reach stage 2; the only
  // channel between them carries the config and the consent (D21). The record says the phases
  // happened and claims no timing it does not have.
  assert.deepEqual(phaseNamed(block, 'Check'), { name: 'Check', status: 'done' })
  assert.deepEqual(phaseNamed(block, 'Prepare'), { name: 'Prepare', status: 'done' })
})

test('the Execute phase names the artifact it produced and its own span', async () => {
  const block = runBlock(await run({ args: stage2({ quarantine: true }) }))
  assert.deepEqual(phaseNamed(block, 'Execute'), {
    name: 'Execute',
    artifact: '.claude/major-tom.json',
    status: 'done',
    startedAt: CLOCK.preconditions[0],
    finishedAt: CLOCK.render[1],
  })
  // The run starts where its earliest agent started.
  assert.equal(block.startedAt, CLOCK.preconditions[0])
})

test('a span is the earliest start and the latest finish, not the first and the last', async () => {
  // The installer is called last and starts first; the validator is called second and finishes
  // last. Reading the span off call order instead of off the stamps fails here.
  const result = await run({
    args: stage2({ quarantine: true }),
    responses: {
      'install specialists': stamped(defaultResponses()['install specialists'], '2026-03-01T09:00:00Z', '2026-03-01T09:30:00Z'),
      'validate config': stamped(defaultResponses()['validate config'], '2026-03-01T10:02:00Z', '2026-03-01T11:00:00Z'),
    },
  })
  const execute = phaseNamed(runBlock(result), 'Execute')
  assert.equal(execute.startedAt, '2026-03-01T09:00:00Z')
  assert.equal(execute.finishedAt, '2026-03-01T11:00:00Z')
})

test('the conditional quarantine is inside the span exactly when it ran', async () => {
  const late = stamped(QUARANTINE_DONE, '2026-03-01T10:03:41Z', '2026-03-01T10:09:00Z')
  const ran = await run({ args: stage2({ quarantine: true }), responses: { 'quarantine residue': late } })
  assert.equal(phaseNamed(runBlock(ran), 'Execute').finishedAt, '2026-03-01T10:09:00Z')

  const declined = await run({ args: stage2({ quarantine: false }), responses: { 'quarantine residue': late } })
  assert.equal(phaseNamed(runBlock(declined), 'Execute').finishedAt, CLOCK.render[1])
})

test('an agent that did not complete drops out of the span and fails the phase', async () => {
  const result = await run({ args: stage2(), responses: { 'render context templates': null } })
  const execute = phaseNamed(runBlock(result), 'Execute')
  assert.equal(execute.startedAt, CLOCK.preconditions[0])
  // The renderer held the latest finish; without it the installer's is the latest that exists.
  assert.equal(execute.finishedAt, CLOCK.install[1])
  // The onboard does not halt here and reports the gap to the session instead, so the record is
  // the only place that can state it. Recorded done, this run would claim a finished Execute,
  // with a measured elapsed, over templates that were never rendered.
  assert.equal(execute.status, 'failed')
})

test('every agent of the phase that did not complete fails it', async () => {
  const installer = await run({ args: stage2(), responses: { 'install specialists': null } })
  assert.equal(phaseNamed(runBlock(installer), 'Execute').status, 'failed')

  // The quarantine counts as an agent of the phase whenever the user authorised it, because
  // then it did run and returned nothing.
  const cleaner = await run({ args: stage2({ quarantine: true }), responses: { 'quarantine residue': null } })
  assert.equal(phaseNamed(runBlock(cleaner), 'Execute').status, 'failed')
})

test('Execute is done when every agent of the phase completed', async () => {
  const authorised = await run({ args: stage2({ quarantine: true }) })
  assert.equal(phaseNamed(runBlock(authorised), 'Execute').status, 'done')

  // The quarantine runs only where there is consent, and a step that never ran did not fail.
  const declined = await run({ args: stage2({ quarantine: false }) })
  assert.equal(phaseNamed(runBlock(declined), 'Execute').status, 'done')
})

test('the Finalize prompt states the vocabulary the statuses come from', async () => {
  const prompt = promptFor(await run({ args: stage2() }), 'finalize + run record')
  // The three words are the contract, and the sentence around them is only wording. A prompt
  // that forbids failed would have the agent overwrite the one status this script computes.
  assert.ok(has(prompt, 'done, failed and active'))
  assert.equal(has(prompt, 'status is done or active and never anything else'), false)
})

test('a phase whose agents reported no stamps carries no timing at all', async () => {
  const responses = {}
  const defaults = defaultResponses()
  for (const label of ['preconditions', 'validate config', 'write config + knowledge root', 'render context templates', 'install specialists']) {
    responses[label] = unstamped(defaults[label])
  }
  const block = runBlock(await run({ args: stage2(), responses: responses }))
  assert.deepEqual(phaseNamed(block, 'Execute'), {
    name: 'Execute',
    artifact: '.claude/major-tom.json',
    status: 'done',
  })
  assert.equal('startedAt' in block, false)
})
