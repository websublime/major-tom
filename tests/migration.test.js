#!/usr/bin/env node
// Scenario suite for plugins/major-tom/migration.js, the artifact map (D54).
//
// Run with: node tests/migration.test.js
//
// Node built-ins only: node:test and node:assert/strict, no runner to install, no
// dependencies. The suite is written against the specification (D54 and the module's own
// header, which states the four modes and what each one promises), never against the
// implementation: the four modes are driven as a real child process over a real directory
// tree, which is the only way to observe the one promise that matters most, that --plan
// writes nothing.
//
// Every fixture is a throwaway directory under os.tmpdir(), built by onboardedProject and
// removed by the test that built it. Nothing is ever written inside this repository. The
// fixtures are not git repositories: the map reads the filesystem and the config and never
// asks git anything, so initialising one would only claim a dependency that does not exist.
//
// The --check failure cases need a plugin root that is wrong, and the plugin root is
// resolved from the script's own __dirname, so those tests copy the whole plugin directory
// into os.tmpdir() and damage the copy. That is the only way to make the gate fail without
// damaging this repository, which is exactly what the gate exists to prevent.

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const REPO_ROOT = path.resolve(__dirname, '..')
const PLUGIN_ROOT = path.join(REPO_ROOT, 'plugins', 'major-tom')
const SCRIPT = path.join(PLUGIN_ROOT, 'migration.js')

// The persistence root every fixture uses; the config schema fixes it to .knowledge.
const KNOWLEDGE_ROOT = '.knowledge'
const AREAS = ['memories', 'docs', 'runs', 'monitors', 'logs']

// The markers and managed values the map declares, written here literally rather than
// imported: the suite tests the specification, so a disagreement between these and the
// module is exactly what these tests exist to report.
const HTML_BEGIN = '<!-- major-tom:begin -->'
const HTML_END = '<!-- major-tom:end -->'
const GITIGNORE_BEGIN = '# major-tom:begin'
const GITIGNORE_END = '# major-tom:end'
const IGNORED_PATHS = ['.claude/worktrees/', '.claude/session/', '.claude/server/']
const LAUNCH_ENTRY_NAME = 'major-tom-dashboard'
const LAUNCHER_PROGRAM = '.claude/server/launcher.js'

// The plugin versions the transitions turn on, as D54 records them.
const BEFORE_EVERYTHING = '0.19.0'
const CURRENT = '0.26.0'

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

function write(root, relative, content) {
  const full = path.join(root, relative)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, content)
  return full
}

function defaultConfig(overrides) {
  const config = {
    schemaVersion: 1,
    onboard: { completedAt: '2026-08-07T10:00:00Z', pluginVersion: CURRENT },
    project: { name: 'fixture', description: '', type: 'existing', topology: 'single' },
    execution: { workingModel: 'subagents' },
    persistence: { root: KNOWLEDGE_ROOT },
    snapshot: { days: 30, limit: 500 },
    stack: { languages: [], frameworks: [], databases: [], messaging: [] },
    devops: { ci: '', containers: '', cloud: '' },
    org: { namespace: '@fixture', internalLibraries: [], preferredLibraries: [] },
    sources: { issueTracker: { provider: '', project: '' }, sites: [] },
    mcp: ['codebase-memory-mcp'],
    specialists: [],
  }
  return Object.assign(config, overrides || {})
}

// A project in the shape a current onboard leaves behind: every entry the map declares as
// always required, and nothing else.
function onboardedProject(options) {
  const opts = options || {}
  const root = tempDir('major-tom-map-')
  const config = defaultConfig(opts.config)

  write(root, '.claude/major-tom.json', JSON.stringify(config, null, 2) + '\n')

  for (const area of AREAS) {
    fs.mkdirSync(path.join(root, KNOWLEDGE_ROOT, area), { recursive: true })
    write(root, KNOWLEDGE_ROOT + '/' + area + '/.gitkeep', '')
  }
  write(
    root,
    KNOWLEDGE_ROOT + '/index.md',
    ['---', 'okf_version: 0.2', '---', '', '## runs', '', '- runs/onboard-fixture.md type=run', ''].join('\n')
  )
  write(
    root,
    KNOWLEDGE_ROOT + '/runs/onboard-2026-08-07T10-00-00-000Z.md',
    [
      '---',
      'type: run',
      'title: Onboard',
      'generated: {by: major-tom-onboard, at: 2026-08-07T10:00:00Z}',
      '---',
      '',
      'Onboard run record.',
      '',
    ].join('\n')
  )

  write(root, 'AGENTS.md', [HTML_BEGIN, '# fixture', '', 'Context.', HTML_END, ''].join('\n'))
  write(root, 'CLAUDE.md', [HTML_BEGIN, '@AGENTS.md', HTML_END, ''].join('\n'))

  fs.mkdirSync(path.join(root, '.claude', 'server'), { recursive: true })
  fs.copyFileSync(path.join(PLUGIN_ROOT, 'app', 'launcher.js'), path.join(root, '.claude', 'server', 'launcher.js'))

  write(
    root,
    '.claude/launch.json',
    JSON.stringify(
      {
        version: '0.0.1',
        configurations: [
          Object.assign(
            { name: LAUNCH_ENTRY_NAME, program: LAUNCHER_PROGRAM, args: [], port: 4242, autoPort: true },
            opts.launchEntry || {}
          ),
        ],
      },
      null,
      2
    ) + '\n'
  )

  write(
    root,
    '.claude/settings.json',
    JSON.stringify(
      {
        env: { CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: '1', CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1' },
        alwaysThinkingEnabled: true,
      },
      null,
      2
    ) + '\n'
  )

  write(
    root,
    '.gitignore',
    ['node_modules/', '', GITIGNORE_BEGIN, '# Major Tom mechanism state, never knowledge.'].concat(IGNORED_PATHS, [GITIGNORE_END, '']).join('\n')
  )

  for (const specialist of config.specialists) {
    write(
      root,
      '.claude/agents/' + specialist.name + '.md',
      [
        '---',
        'name: ' + specialist.name,
        'description: A fixture specialist.',
        'tools: ' + (opts.specialistTools === undefined ? derivedTools(config) : opts.specialistTools),
        '---',
        '',
        'Body.',
        '',
      ].join('\n')
    )
  }

  return root
}

function derivedTools(config) {
  return ['Read', 'Glob', 'Grep'].concat((config.mcp || []).map((s) => 'mcp__' + s + '__*')).join(', ')
}

function remove(root) {
  fs.rmSync(root, { recursive: true, force: true })
}

// ---------------------------------------------------------------------------
// Running the script
// ---------------------------------------------------------------------------

function run(args, options) {
  const opts = options || {}
  const result = spawnSync(process.execPath, [opts.script || SCRIPT].concat(args), {
    encoding: 'utf8',
    cwd: opts.cwd || REPO_ROOT,
  })
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '', all: (result.stdout || '') + (result.stderr || '') }
}

// The status lines the map prints are the contract this suite reads, so they are matched
// on the status token and the path together rather than on a substring of the whole output.
function lineFor(output, status, target) {
  return output
    .split('\n')
    .filter((line) => line.startsWith(status + ' ') && line.indexOf(target) !== -1)
}

function statusOf(output, target) {
  for (const line of output.split('\n')) {
    const match = /^(\S+)\s+(\S+)\s/.exec(line)
    if (match && match[2] === target) return match[1]
  }
  return null
}

// A content hash of a whole directory tree, path by path, so a test can assert that a mode
// changed nothing at all rather than that it changed nothing it happened to look at.
function treeDigest(root) {
  const hash = crypto.createHash('sha256')
  const walk = (dir, prefix) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = path.join(dir, entry.name)
      const rel = prefix ? prefix + '/' + entry.name : entry.name
      if (entry.isDirectory()) {
        hash.update('D ' + rel + '\n')
        walk(full, rel)
      } else {
        hash.update('F ' + rel + ' ' + crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex') + '\n')
      }
    }
  }
  walk(root, '')
  return hash.digest('hex')
}

// ---------------------------------------------------------------------------
// --verify
// ---------------------------------------------------------------------------

test('--verify accepts a correctly onboarded project', (t) => {
  const repo = onboardedProject()
  t.after(() => remove(repo))

  const result = run(['--verify', repo])
  assert.equal(result.status, 0, result.all)
  assert.match(result.stdout, /verify: \d+ ok, \d+ absent, 0 missing, 0 unrecognised, 0 unexpected, 0 retired/)
})

test('--verify reports every always-required artifact it declares', (t) => {
  const repo = onboardedProject()
  t.after(() => remove(repo))

  const result = run(['--verify', repo])
  for (const target of [
    '.claude/major-tom.json',
    KNOWLEDGE_ROOT,
    KNOWLEDGE_ROOT + '/memories',
    KNOWLEDGE_ROOT + '/index.md',
    'AGENTS.md',
    'CLAUDE.md',
    '.claude/launch.json',
    '.claude/settings.json',
    '.gitignore',
    '.claude/server/launcher.js',
  ]) {
    assert.equal(statusOf(result.stdout, target), 'ok', 'expected ok for ' + target + '\n' + result.all)
  }
})

test('--verify refuses a directory that is not an onboarded project', (t) => {
  const repo = tempDir('major-tom-map-bare-')
  t.after(() => remove(repo))

  const result = run(['--verify', repo])
  assert.equal(result.status, 1)
  assert.match(result.stderr, /not an onboarded project/)
})

test('--verify reports what is missing, one line per artifact', (t) => {
  const repo = onboardedProject()
  t.after(() => remove(repo))

  fs.rmSync(path.join(repo, 'AGENTS.md'))
  fs.rmSync(path.join(repo, KNOWLEDGE_ROOT, 'monitors'), { recursive: true })
  fs.rmSync(path.join(repo, '.claude', 'server', 'launcher.js'))

  const result = run(['--verify', repo])
  assert.equal(result.status, 1)
  assert.equal(statusOf(result.stdout, 'AGENTS.md'), 'MISSING', result.all)
  assert.equal(statusOf(result.stdout, KNOWLEDGE_ROOT + '/monitors'), 'MISSING', result.all)
  assert.equal(statusOf(result.stdout, '.claude/server/launcher.js'), 'MISSING', result.all)
  assert.match(result.stdout, /3 missing/)
})

test('--verify tells an absent artifact apart from one present but not recognisably ours', (t) => {
  const absentRepo = onboardedProject()
  const strangerRepo = onboardedProject()
  t.after(() => {
    remove(absentRepo)
    remove(strangerRepo)
  })

  fs.rmSync(path.join(absentRepo, '.claude', 'server', 'launcher.js'))
  // Same path, a file that is not the launcher this plugin ships. Byte-identical evidence
  // is the only thing that can tell these two situations apart, and they migrate
  // differently: one is restored by a re-onboard, the other is somebody else's file.
  fs.writeFileSync(path.join(strangerRepo, '.claude', 'server', 'launcher.js'), '// not ours\n')

  const absent = run(['--verify', absentRepo])
  const stranger = run(['--verify', strangerRepo])

  assert.equal(statusOf(absent.stdout, '.claude/server/launcher.js'), 'MISSING', absent.all)
  assert.equal(statusOf(stranger.stdout, '.claude/server/launcher.js'), 'UNRECOGNISED', stranger.all)
  assert.match(stranger.stdout, /differs from the plugin's app\/launcher\.js/)
  assert.equal(absent.status, 1)
  assert.equal(stranger.status, 1)
})

test('--verify calls a managed block without its markers unrecognised, not missing', (t) => {
  const repo = onboardedProject()
  t.after(() => remove(repo))

  fs.writeFileSync(path.join(repo, 'AGENTS.md'), '# fixture\n\nNo markers here.\n')

  const result = run(['--verify', repo])
  assert.equal(statusOf(result.stdout, 'AGENTS.md'), 'UNRECOGNISED', result.all)
  assert.match(result.stdout, /marker pair/)
})

test('--verify checks the gitignore block content, not only its markers', (t) => {
  const repo = onboardedProject()
  t.after(() => remove(repo))

  write(repo, '.gitignore', [GITIGNORE_BEGIN, '.claude/session/', GITIGNORE_END, ''].join('\n'))

  const result = run(['--verify', repo])
  assert.equal(statusOf(result.stdout, '.gitignore'), 'UNRECOGNISED', result.all)
  assert.match(result.stdout, /\.claude\/worktrees\//)
})

test('--verify checks each managed settings key', (t) => {
  const repo = onboardedProject()
  t.after(() => remove(repo))

  write(repo, '.claude/settings.json', JSON.stringify({ env: { CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: '1' } }, null, 2))

  const result = run(['--verify', repo])
  assert.equal(statusOf(result.stdout, '.claude/settings.json'), 'UNRECOGNISED', result.all)
  assert.match(result.stdout, /alwaysThinkingEnabled/)
})

test('--verify follows the settings file choice: settings.local.json wins when it exists', (t) => {
  const repo = onboardedProject()
  t.after(() => remove(repo))

  write(
    repo,
    '.claude/settings.local.json',
    JSON.stringify({ env: { CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: '1', CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1' }, alwaysThinkingEnabled: true })
  )

  const result = run(['--verify', repo])
  assert.equal(statusOf(result.stdout, '.claude/settings.local.json'), 'ok', result.all)
  assert.equal(statusOf(result.stdout, '.claude/settings.json'), null, 'the shared file must not be reported once the local one exists')
})

test('--verify reports a stranger file in a directory the plugin owns whole', (t) => {
  const repo = onboardedProject()
  t.after(() => remove(repo))

  write(repo, '.claude/server/leftover.js', '// something else\n')

  const result = run(['--verify', repo])
  assert.equal(result.status, 1)
  assert.equal(lineFor(result.stdout, 'UNEXPECTED', '.claude/server/leftover.js').length, 1, result.all)
  assert.match(result.stdout, /1 unexpected/)
})

test('--verify leaves a knowledge area alone: the user writes there and the plugin does not own it', (t) => {
  const repo = onboardedProject()
  t.after(() => remove(repo))

  write(repo, KNOWLEDGE_ROOT + '/memories/a-fact.md', '---\ntype: memory\n---\n\nA fact.\n')

  const result = run(['--verify', repo])
  assert.equal(result.status, 0, result.all)
  assert.equal(result.stdout.indexOf('a-fact.md'), -1, 'a user knowledge file must never be reported')
})

test('--verify counts a project with no specialists as complete', (t) => {
  const repo = onboardedProject()
  t.after(() => remove(repo))

  const result = run(['--verify', repo])
  assert.equal(result.status, 0, result.all)
  assert.match(result.stdout, /absent\s+\.claude\/agents\/<specialist\.name>\.md.*lists no specialists/)
})

test('--verify expands one entry per configured specialist', (t) => {
  const repo = onboardedProject({
    config: { specialists: [{ name: 'typescript-pro', source: 'sub-agents.directory' }] },
  })
  t.after(() => remove(repo))

  const ok = run(['--verify', repo])
  assert.equal(statusOf(ok.stdout, '.claude/agents/typescript-pro.md'), 'ok', ok.all)
  assert.equal(ok.status, 0, ok.all)

  fs.rmSync(path.join(repo, '.claude', 'agents', 'typescript-pro.md'))
  const missing = run(['--verify', repo])
  assert.equal(statusOf(missing.stdout, '.claude/agents/typescript-pro.md'), 'MISSING', missing.all)
  assert.equal(missing.status, 1)
})

test('--verify reports a retired artifact wherever it finds one, whatever the config says', (t) => {
  const repo = onboardedProject()
  t.after(() => remove(repo))

  // The config claims the current version, so no version comparison would look here.
  write(repo, KNOWLEDGE_ROOT + '/dashboard.html', '<!doctype html>\n')

  const result = run(['--verify', repo])
  assert.equal(result.status, 1)
  assert.equal(lineFor(result.stdout, 'RETIRED', KNOWLEDGE_ROOT + '/dashboard.html').length, 1, result.all)
})

test('--verify resolves the persistence root from the target config, not from a constant', (t) => {
  const repo = onboardedProject()
  t.after(() => remove(repo))

  fs.renameSync(path.join(repo, KNOWLEDGE_ROOT), path.join(repo, '.brain'))
  const config = JSON.parse(fs.readFileSync(path.join(repo, '.claude', 'major-tom.json'), 'utf8'))
  config.persistence.root = '.brain'
  write(repo, '.claude/major-tom.json', JSON.stringify(config, null, 2))

  const result = run(['--verify', repo])
  assert.equal(result.status, 0, result.all)
  assert.equal(statusOf(result.stdout, '.brain/index.md'), 'ok', result.all)
})

// ---------------------------------------------------------------------------
// --assets
// ---------------------------------------------------------------------------

test('--assets lists what the plugin actually ships, one path per line', () => {
  const result = run(['--assets'])
  assert.equal(result.status, 0, result.all)

  const lines = result.stdout.trim().split('\n')
  assert.ok(lines.length > 0)
  for (const line of lines) {
    assert.match(line, /^[A-Za-z0-9_./-]+$/, 'a consumer splits this on newlines, so a line is a path and nothing else')
    assert.ok(fs.existsSync(path.join(PLUGIN_ROOT, line)), 'listed asset does not exist in the plugin: ' + line)
  }
})

test('--assets covers every runtime asset the onboard reaches for', () => {
  const listed = run(['--assets']).stdout.trim().split('\n')
  for (const required of [
    'config.schema.json',
    'migration.js',
    'templates/context.md.tpl',
    'templates/claude.md.tpl',
    'templates/render.js',
    'templates/launch-merge.js',
    'templates/settings-merge.js',
    'templates/gitignore-merge.js',
    'app/launcher.js',
    'app/server.js',
    'app/dashboard.html',
    'app/snapshot.js',
    'app/vendor/js-yaml.cjs.js',
  ]) {
    assert.ok(listed.indexOf(required) !== -1, 'missing from --assets: ' + required)
  }
})

// ---------------------------------------------------------------------------
// --check
// ---------------------------------------------------------------------------

test('--check passes on this repository', () => {
  const result = run(['--check'])
  assert.equal(result.status, 0, result.all)
  assert.match(result.stdout, /artifact map consistent/)
})

test('--check fails when the map names a plugin asset that is not there', (t) => {
  const root = tempDir('major-tom-map-plugin-')
  t.after(() => remove(root))
  const copy = path.join(root, 'major-tom')
  fs.cpSync(PLUGIN_ROOT, copy, { recursive: true })
  fs.rmSync(path.join(copy, 'templates', 'render.js'))

  const result = run(['--check'], { script: path.join(copy, 'migration.js') })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /required asset missing from the plugin: templates\/render\.js/)
})

test('--check fails when the map declares byte-identical evidence against a file that is gone', (t) => {
  const root = tempDir('major-tom-map-plugin-')
  t.after(() => remove(root))
  const copy = path.join(root, 'major-tom')
  fs.cpSync(PLUGIN_ROOT, copy, { recursive: true })
  fs.rmSync(path.join(copy, 'app', 'launcher.js'))

  const result = run(['--check'], { script: path.join(copy, 'migration.js') })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /byte-identical evidence names a plugin file that is not there, app\/launcher\.js/)
})

test('--check fails when a mechanism stops writing what the map declares', (t) => {
  const root = tempDir('major-tom-map-plugin-')
  t.after(() => remove(root))
  const copy = path.join(root, 'major-tom')
  fs.cpSync(PLUGIN_ROOT, copy, { recursive: true })

  const merge = path.join(copy, 'templates', 'gitignore-merge.js')
  fs.writeFileSync(merge, fs.readFileSync(merge, 'utf8').split("'.claude/session/',").join(''))

  const result = run(['--check'], { script: path.join(copy, 'migration.js') })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /gitignore-merge\.js no longer carries "\.claude\/session\/"/)
})

// ---------------------------------------------------------------------------
// --plan
// ---------------------------------------------------------------------------

// A project onboarded before every transition, carrying what each of them is about: the two
// retired artifacts, the two wrong values and the missing block.
function legacyProject() {
  const repo = onboardedProject({
    config: {
      onboard: { completedAt: '2026-08-06T10:00:00Z', pluginVersion: BEFORE_EVERYTHING },
      mcp: ['codebase-memory'],
      specialists: [{ name: 'typescript-pro', source: 'sub-agents.directory' }],
    },
    specialistTools: 'Read, Write, Edit, Bash',
    launchEntry: { program: '.claude/server/dashboard-server.js', args: ['.knowledge/dashboard.html'] },
  })
  const config = JSON.parse(fs.readFileSync(path.join(repo, '.claude', 'major-tom.json'), 'utf8'))
  delete config.snapshot
  write(repo, '.claude/major-tom.json', JSON.stringify(config, null, 2) + '\n')

  write(repo, KNOWLEDGE_ROOT + '/dashboard.html', '<!doctype html>\n<title>old</title>\n')
  write(repo, '.claude/server/dashboard-server.js', '// an aged copy of the server\n')
  return repo
}

test('--plan reports a residue transition', (t) => {
  const repo = legacyProject()
  t.after(() => remove(repo))

  const result = run(['--plan', repo])
  assert.equal(result.status, 0, result.all)
  assert.match(result.stdout, /APPLIES {2}residue {2}dashboard-artifact/)
  assert.match(result.stdout, /APPLIES {2}residue {2}server-copy/)
  assert.match(result.stdout, /found: \.knowledge\/dashboard\.html/)
  assert.match(result.stdout, /found: \.claude\/server\/dashboard-server\.js/)
})

test('--plan reports a value transition with the value it derives', (t) => {
  const repo = legacyProject()
  t.after(() => remove(repo))

  const result = run(['--plan', repo])
  assert.match(result.stdout, /APPLIES {2}value {2}mcp-server-name/)
  assert.match(result.stdout, /mcp lists codebase-memory, expected codebase-memory-mcp/)
  assert.match(result.stdout, /APPLIES {2}value {2}specialist-tools/)
  assert.match(result.stdout, /Read, Glob, Grep, mcp__codebase-memory__\*/)
  assert.match(result.stdout, /APPLIES {2}value {2}launch-entry/)
  assert.match(result.stdout, /program is "\.claude\/server\/dashboard-server\.js"/)
})

test('--plan reports a gap transition and says it needs the interview', (t) => {
  const repo = legacyProject()
  t.after(() => remove(repo))

  const result = run(['--plan', repo])
  assert.match(result.stdout, /APPLIES {2}gap {2}snapshot-block/)
  assert.match(result.stdout, /config carries no snapshot block/)
  assert.match(result.stdout, /remedy: interview;/)
})

test('--plan names the three species and never any other', (t) => {
  const repo = legacyProject()
  t.after(() => remove(repo))

  const result = run(['--plan', repo])
  const species = new Set(
    result.stdout
      .split('\n')
      .map((line) => /^(?:APPLIES|CLEAR) {2}(\S+)/.exec(line))
      .filter(Boolean)
      .map((m) => m[1])
  )
  assert.deepEqual([...species].sort(), ['gap', 'residue', 'value'])
})

test('--plan says a deletion is not performed by anything, because that is undecided', (t) => {
  const repo = legacyProject()
  t.after(() => remove(repo))

  const result = run(['--plan', repo])
  assert.match(result.stdout, /remedy: delete; undecided \(OQ-16\)/)
})

test('--plan reports nothing applicable for a current project', (t) => {
  const repo = onboardedProject()
  t.after(() => remove(repo))

  const result = run(['--plan', repo])
  assert.equal(result.status, 0, result.all)
  assert.match(result.stdout, /plan: 0 applies, 0 clear, \d+ not applicable/)
})

test('--plan separates what applies by version from what this repository actually carries', (t) => {
  // Onboarded before every transition, but carrying none of them: the version says the
  // transitions could apply and the repository says they do not, and a report that only
  // compared versions would send this user to fix five things that are not there.
  const repo = onboardedProject({
    config: { onboard: { completedAt: '2026-08-06T10:00:00Z', pluginVersion: BEFORE_EVERYTHING } },
  })
  t.after(() => remove(repo))

  const result = run(['--plan', repo])
  assert.equal(result.status, 0, result.all)
  assert.match(result.stdout, /plan: 0 applies, 6 clear, 0 not applicable/)
  assert.match(result.stdout, /CLEAR {4}residue {2}dashboard-artifact/)
})

test('--plan reports a residue even when the recorded version would not predict it', (t) => {
  // A config can be hand-edited or re-onboarded without the residue being cleared, so
  // detection is over the repository and the version only decides what to look for.
  const repo = onboardedProject()
  t.after(() => remove(repo))
  write(repo, '.claude/server/dashboard-server.js', '// left behind\n')

  const result = run(['--plan', repo])
  assert.match(result.stdout, /APPLIES {2}residue {2}server-copy/)
})

test('--plan writes nothing, moves nothing and deletes nothing', (t) => {
  const repo = legacyProject()
  t.after(() => remove(repo))

  const before = treeDigest(repo)
  const beforeListing = listTree(repo)

  const result = run(['--plan', repo])
  assert.equal(result.status, 0, result.all)

  const after = treeDigest(repo)
  assert.deepEqual(listTree(repo), beforeListing, 'the set of paths must be identical before and after')
  assert.equal(after, before, 'the whole tree must hash identically before and after')
  assert.match(result.stdout, /Nothing was written, moved or deleted/)
})

test('--plan refuses a directory that is not an onboarded project', (t) => {
  const repo = tempDir('major-tom-map-bare-')
  t.after(() => remove(repo))

  const result = run(['--plan', repo])
  assert.equal(result.status, 1)
  assert.match(result.stderr, /nothing to migrate/)
})

function listTree(root) {
  const out = []
  const walk = (dir, prefix) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const rel = prefix ? prefix + '/' + entry.name : entry.name
      out.push((entry.isDirectory() ? 'D ' : 'F ') + rel)
      if (entry.isDirectory()) walk(path.join(dir, entry.name), rel)
    }
  }
  walk(root, '')
  return out
}

// ---------------------------------------------------------------------------
// CLI surface
// ---------------------------------------------------------------------------

test('an unknown mode fails with the usage line rather than doing something', () => {
  const result = run(['--migrate', '.'])
  assert.equal(result.status, 1)
  assert.match(result.stderr, /usage: node migration\.js --verify/)
})

test('no mode at all fails the same way', () => {
  const result = run([])
  assert.equal(result.status, 1)
  assert.match(result.stderr, /usage: node migration\.js --verify/)
})
