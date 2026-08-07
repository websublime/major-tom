#!/usr/bin/env node
// Scenario suite for plugins/major-tom/app/snapshot.js (D43 PR1).
//
// Run with: node tests/snapshot.test.js
//
// Node built-ins only: node:test and node:assert/strict, no runner to install, no
// dependencies. The suite is written against the specification (the onboard render prose
// that the script extracts, plus the snapshot schema v2 contract in templates/README.md),
// never against the implementation.
//
// Every fixture is a throwaway git repository under os.tmpdir(), built by initRepo and
// removed by the test that built it. Nothing is ever written inside this repository.
//
// Commit dates are set explicitly, never taken from the clock, and the fixture repository
// carries its own user.name and user.email so the suite behaves the same on any machine.

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const REPO_ROOT = path.resolve(__dirname, '..')
const SCRIPT = path.join(REPO_ROOT, 'plugins', 'major-tom', 'app', 'snapshot.js')
const VENDORED_PARSER = path.join(REPO_ROOT, 'plugins', 'major-tom', 'app', 'vendor', 'js-yaml.cjs.js')

// The persistence root every fixture uses; the config schema fixes it to .knowledge.
const KNOWLEDGE_ROOT = '.knowledge'
const IDENTITY_NAME = 'Fixture Author'
const IDENTITY_EMAIL = 'fixture@example.test'
const IDENTITY = `${IDENTITY_NAME} <${IDENTITY_EMAIL}>`

// The window the fixtures are built around. It is a legibility limit and not a weight one:
// the byte caps the schema used to carry are gone (D43 point 4), the window is not.
//
// Since D45 only the floor is a constant of the script; the horizon and the ceiling are the
// default the config carries, which every fixture below writes as exactly these values through
// defaultConfig(). The tests that assert 30 and 500 are therefore asserting the configured
// default, and the parameter tests further down are the ones that move it.
const WINDOW_DAYS = 30
const FLOOR_EVENTS = 50
const CEILING_EVENTS = 500
const SUMMARY_CAP = 200

// The hard bounds the script enforces on both parameters and the schema states for the
// default, written out here rather than imported so the suite tests the specification.
const DAYS_MIN = 1
const DAYS_MAX = 365
const LIMIT_MIN = 50
const LIMIT_MAX = 500

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

// The script stamps its own generatedAt, so every window in a fixture has to be expressed
// relative to the current time rather than to a fixed date. NOW is read once, at load, and
// the two helpers below make the side of the 30-day horizon explicit at every call site.
// It is floored to a whole second because git stores commit timestamps at second
// precision, so a fixture date carrying milliseconds could never be asserted back.
const NOW = Math.floor(Date.now() / 1000) * 1000

// A date that sits safely inside the 30-day horizon.
function insideHorizon(hours) {
  assert.ok(hours * HOUR < 29 * DAY, 'fixture date must sit inside the 30-day horizon')
  return new Date(NOW - hours * HOUR)
}

// A date that sits safely outside the 30-day horizon.
function outsideHorizon(days) {
  assert.ok(days > WINDOW_DAYS + 1, 'fixture date must sit outside the 30-day horizon')
  return new Date(NOW - days * DAY)
}

const EXEC_OPTIONS = {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
  maxBuffer: 64 * 1024 * 1024,
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function tmpDir(t, prefix) {
  // realpath so the fixture path has no symlink component (on macOS /tmp is a symlink),
  // which keeps any path comparison inside the script honest.
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), prefix))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

function git(dir, args, extraEnv) {
  return execFileSync('git', args, {
    cwd: dir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: extraEnv ? Object.assign({}, process.env, extraEnv) : process.env,
  })
}

function writeFileAt(target, contents) {
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, contents)
}

function defaultConfig() {
  return {
    schemaVersion: 1,
    onboard: { completedAt: '2026-01-01T00:00:00.000Z', pluginVersion: '0.19.0' },
    project: {
      name: 'fixture-project',
      description: 'A throwaway repository built by the snapshot suite.',
      type: 'existing',
      topology: 'single',
    },
    execution: {
      workingModel: 'team',
      team: { coordinator: 'coordinator', members: ['planner', 'implementer', 'reviewer'] },
    },
    persistence: { root: KNOWLEDGE_ROOT },
    // The window's default lives in the config since D45 and the script carries none, so every
    // fixture states it. These are the values D41 and D42 fixed and the schema proposes.
    snapshot: { days: WINDOW_DAYS, limit: CEILING_EVENTS },
    stack: { languages: ['javascript'], frameworks: [], databases: [], messaging: [] },
    devops: { ci: '', containers: '', cloud: '' },
    org: { namespace: '@fixture', internalLibraries: [], preferredLibraries: [] },
    sources: { issueTracker: { provider: '', project: '' }, sites: [] },
    mcp: ['codebase-memory'],
    specialists: [],
  }
}

// An OKF concept in its ordinary shape: frontmatter, a blank line, a body, a trailing
// newline.
function concept(frontmatter, body) {
  return `---\n${frontmatter.trim()}\n---\n\n${body}\n`
}

// An OKF concept whose body is exactly the bytes given: no blank line after the closing
// fence and no trailing newline. Used wherever a test asserts an exact body or summary
// length, so the result does not depend on whether the reader trims the body.
function conceptExact(frontmatter, body) {
  return `---\n${frontmatter.trim()}\n---\n${body}`
}

// The bundle index. Reserved: it is never itself an entry, it only fixes the order the
// knowledge walk starts with. Each listed path appears verbatim in the line.
function indexDoc(entries) {
  const lines = ['---', 'okf_version: 0.2', 'title: Knowledge bundle index', '---', '', '# Knowledge bundle index', '']
  for (const rel of entries) lines.push(`- [${rel}](${rel}): bundle entry`)
  return lines.join('\n') + '\n'
}

// A post-D41 intents.log line: timestamp, tier, type, promptId, sessionId, summary.
function logLine(fields) {
  const entry = Object.assign({ tier: 'task', type: 'edit', promptId: 'p-1', sessionId: 's-1', summary: 'a summary' }, fields)
  return [entry.at.toISOString(), entry.tier, entry.type, entry.promptId, entry.sessionId, entry.summary].join('\t')
}

// A pre-D41 intents.log line: timestamp, tier, type, promptId, summary. Five fields.
function legacyLogLine(fields) {
  const entry = Object.assign({ tier: 'task', type: 'edit', promptId: 'p-1', summary: 'a summary' }, fields)
  return [entry.at.toISOString(), entry.tier, entry.type, entry.promptId, entry.summary].join('\t')
}

// Builds a fixture repository.
//
//   noConfig        do not write .claude/major-tom.json at all
//   rawConfig       write this exact string as .claude/major-tom.json
//   config          the config object to write (defaults to defaultConfig())
//   noRoot          do not create the persistence root
//   noIndex         create the persistence root without its index.md
//   index           the relative paths listed in index.md, in order
//   knowledge       map of persistence-root-relative path to file contents
//   intentsLog      array of runs/intents.log lines
//   commits         commits created one git process at a time, oldest first
//   bulkCommits     commits created through git fast-import, oldest first
function initRepo(t, options) {
  const opts = options || {}
  const dir = tmpDir(t, 'major-tom-snapshot-')

  git(dir, ['init', '--quiet'])
  git(dir, ['symbolic-ref', 'HEAD', 'refs/heads/main'])
  git(dir, ['config', 'user.name', IDENTITY_NAME])
  git(dir, ['config', 'user.email', IDENTITY_EMAIL])
  git(dir, ['config', 'commit.gpgsign', 'false'])

  if (opts.rawConfig !== undefined) {
    writeFileAt(path.join(dir, '.claude', 'major-tom.json'), opts.rawConfig)
  } else if (!opts.noConfig) {
    const config = opts.config || defaultConfig()
    writeFileAt(path.join(dir, '.claude', 'major-tom.json'), JSON.stringify(config, null, 2) + '\n')
  }

  if (!opts.noRoot) {
    for (const area of ['memories', 'docs', 'runs', 'monitors', 'logs']) {
      fs.mkdirSync(path.join(dir, KNOWLEDGE_ROOT, area), { recursive: true })
      fs.writeFileSync(path.join(dir, KNOWLEDGE_ROOT, area, '.gitkeep'), '')
    }
    if (!opts.noIndex) {
      fs.writeFileSync(path.join(dir, KNOWLEDGE_ROOT, 'index.md'), indexDoc(opts.index || []))
    }
    for (const [rel, contents] of Object.entries(opts.knowledge || {})) {
      writeFileAt(path.join(dir, KNOWLEDGE_ROOT, rel), contents)
    }
    if (opts.intentsLog) {
      fs.writeFileSync(path.join(dir, KNOWLEDGE_ROOT, 'runs', 'intents.log'), opts.intentsLog.join('\n') + '\n')
    }
  }

  for (const entry of opts.commits || []) commit(dir, entry)
  if (opts.bulkCommits) importCommits(dir, opts.bulkCommits)

  return dir
}

// One commit, one git process. The date is fixed on both sides of the commit, so it does
// not matter whether the script reads the author date or the committer date. Only the
// named files are staged, so the untracked config and knowledge files never show up in the
// numstat totals.
function commit(dir, entry) {
  const files = entry.files || {}
  for (const [rel, contents] of Object.entries(files)) writeFileAt(path.join(dir, rel), contents)
  const paths = Object.keys(files)
  if (paths.length > 0) git(dir, ['add', '--'].concat(paths))
  const stamp = entry.date.toISOString()
  git(dir, ['commit', '--quiet', '--allow-empty', '--no-verify', '-m', entry.message], {
    GIT_AUTHOR_DATE: stamp,
    GIT_COMMITTER_DATE: stamp,
  })
}

// The same history through git fast-import, for the fixtures that need more commits than
// the window limits (52, 57 and 505 of them). One git process per commit costs about 45 ms
// here, so the 500-commit ceiling fixture alone would cost 25 seconds. fast-import writes
// the author timestamp and the committer timestamp explicitly, which is the same date
// control the per-commit environment variables give, in one process.
// Commits are given oldest first, so the linear history follows the dates.
function importCommits(dir, commits) {
  const chunks = []
  const push = (piece) => chunks.push(Buffer.isBuffer(piece) ? piece : Buffer.from(piece, 'utf8'))
  const data = (payload) => {
    const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8')
    push(`data ${buf.length}\n`)
    push(buf)
    push('\n')
  }
  commits.forEach((entry, i) => {
    const stamp = `${Math.floor(entry.date.getTime() / 1000)} +0000`
    push('commit refs/heads/main\n')
    push(`author ${IDENTITY} ${stamp}\n`)
    push(`committer ${IDENTITY} ${stamp}\n`)
    data(entry.message)
    push('M 100644 inline history.txt\n')
    data(`revision ${i}\n`)
  })
  push('done\n')
  execFileSync('git', ['fast-import', '--quiet', '--done'], {
    cwd: dir,
    input: Buffer.concat(chunks),
    stdio: ['pipe', 'pipe', 'pipe'],
  })
}

// ---------------------------------------------------------------------------
// Running the script under test
// ---------------------------------------------------------------------------

function runSnapshot(t, repoDir) {
  const outPath = path.join(tmpDir(t, 'major-tom-out-'), 'snapshot.json')
  try {
    execFileSync(process.execPath, [SCRIPT, '--repo', repoDir, '--out', outPath], EXEC_OPTIONS)
  } catch (err) {
    assert.fail(`snapshot.js exited with ${err.status}: ${String(err.stderr || err.message).trim()}`)
  }
  return JSON.parse(fs.readFileSync(outPath, 'utf8'))
}

function runSnapshotToStdout(repoDir) {
  return execFileSync(process.execPath, [SCRIPT], Object.assign({ cwd: repoDir }, EXEC_OPTIONS))
}

function runSnapshotExpectingFailure(t, repoDir) {
  const outPath = path.join(tmpDir(t, 'major-tom-out-'), 'snapshot.json')
  let status = 0
  let stderr = ''
  try {
    execFileSync(process.execPath, [SCRIPT, '--repo', repoDir, '--out', outPath], EXEC_OPTIONS)
  } catch (err) {
    status = err.status
    stderr = String(err.stderr || '')
  }
  return { status, stderr, wroteOutput: fs.existsSync(outPath) }
}

function assertFailedClosed(result) {
  assert.notEqual(result.status, 0, 'the script must exit non-zero')
  assert.ok(result.stderr.trim().length > 0, 'the script must say why on stderr')
  assert.equal(result.wroteOutput, false, 'the script must not write an output file when it fails')
}

function fileByPath(snapshot, rel) {
  const found = snapshot.knowledge.files.find((f) => f.path === rel)
  assert.ok(found, `expected a knowledge entry for ${rel}, got ${JSON.stringify(snapshot.knowledge.files.map((f) => f.path))}`)
  return found
}

function decisionById(snapshot, id) {
  const found = snapshot.decisions.find((d) => d.id === id)
  assert.ok(found, `expected a decision with id ${id}, got ${JSON.stringify(snapshot.decisions.map((d) => d.id))}`)
  return found
}

// ---------------------------------------------------------------------------
// The vendored parser
// ---------------------------------------------------------------------------

test('vendor: the js-yaml bundle has the recorded size and SHA-256', () => {
  const bytes = fs.readFileSync(VENDORED_PARSER)
  assert.equal(bytes.length, 122488)
  assert.equal(
    crypto.createHash('sha256').update(bytes).digest('hex'),
    'f1499c20ab232a283f6f9f85aeecc99dceab175e8dd4005bd3d764848f3e5965'
  )
})

// ---------------------------------------------------------------------------
// Shape and CLI
// ---------------------------------------------------------------------------

test('shape: the snapshot carries exactly the six required keys', (t) => {
  const dir = initRepo(t, {
    knowledge: { 'docs/alpha.md': concept('type: doc\ntitle: Alpha', 'alpha body') },
    commits: [{ message: 'feat: first', date: insideHorizon(2), files: { 'a.txt': 'one\n' } }],
  })
  const snapshot = runSnapshot(t, dir)

  assert.deepEqual(
    Object.keys(snapshot).sort(),
    ['config', 'decisions', 'generatedAt', 'git', 'knowledge', 'timeline']
  )
  assert.equal('lastRun' in snapshot, false)
  assert.equal('roadmap' in snapshot, false)

  assert.equal(typeof snapshot.generatedAt, 'string')
  assert.equal(new Date(snapshot.generatedAt).toISOString(), snapshot.generatedAt)
  assert.ok(Array.isArray(snapshot.git))
  assert.ok(Array.isArray(snapshot.knowledge.files))
  assert.ok(Array.isArray(snapshot.decisions))
  assert.ok(Array.isArray(snapshot.timeline.events))
})

test('shape: config is the parsed .claude/major-tom.json verbatim', (t) => {
  const config = defaultConfig()
  config.project.name = 'a-named-fixture'
  const dir = initRepo(t, { config })
  const snapshot = runSnapshot(t, dir)
  assert.deepEqual(snapshot.config, config)
})

test('cli: --repo defaults to the working directory and --out defaults to stdout', (t) => {
  const dir = initRepo(t, {
    knowledge: { 'docs/alpha.md': concept('type: doc\ntitle: Alpha', 'alpha body') },
    commits: [{ message: 'docs: only commit', date: insideHorizon(1), files: { 'a.txt': 'one\n' } }],
  })
  const stdout = runSnapshotToStdout(dir)
  const snapshot = JSON.parse(stdout)
  assert.equal(snapshot.git.length, 1)
  assert.equal(snapshot.git[0].subject, 'docs: only commit')
  assert.equal(fileByPath(snapshot, 'docs/alpha.md').type, 'doc')
})

// ---------------------------------------------------------------------------
// git
// ---------------------------------------------------------------------------

test('git: kind covers the six conventional prefixes and other', (t) => {
  const subjects = [
    ['feat: a feature', 'feat'],
    ['fix: a bug', 'fix'],
    ['docs: a document', 'docs'],
    ['test: a test', 'test'],
    ['chore: a chore', 'chore'],
    ['refactor: a refactor', 'refactor'],
    ['a subject with no prefix at all', 'other'],
  ]
  const dir = initRepo(t, {
    commits: subjects.map(([message], i) => ({
      message,
      date: insideHorizon(subjects.length - i),
      files: { 'a.txt': `revision ${i}\n` },
    })),
  })
  const snapshot = runSnapshot(t, dir)

  const kinds = new Map(snapshot.git.map((entry) => [entry.subject, entry.kind]))
  for (const [message, kind] of subjects) {
    assert.equal(kinds.get(message), kind, `kind of "${message}"`)
  }
})

test('git: a scoped conventional prefix classifies as the prefix', (t) => {
  const dir = initRepo(t, {
    commits: [{ message: 'feat(hooks): a scoped feature', date: insideHorizon(1), files: { 'a.txt': 'one\n' } }],
  })
  const snapshot = runSnapshot(t, dir)
  assert.equal(snapshot.git[0].kind, 'feat')
})

test('git: a prefix outside the six classifies as other', (t) => {
  const dir = initRepo(t, {
    commits: [{ message: 'perf: an unlisted prefix', date: insideHorizon(1), files: { 'a.txt': 'one\n' } }],
  })
  const snapshot = runSnapshot(t, dir)
  assert.equal(snapshot.git[0].kind, 'other')
})

test('git: an entry carries hash, date, author and subject', (t) => {
  const date = insideHorizon(6)
  const dir = initRepo(t, {
    commits: [{ message: 'feat: the only commit', date, files: { 'a.txt': 'one\n' } }],
  })
  const snapshot = runSnapshot(t, dir)

  assert.equal(snapshot.git.length, 1)
  const entry = snapshot.git[0]
  assert.match(entry.hash, /^[0-9a-f]{7,40}$/)
  assert.equal(new Date(entry.date).getTime(), date.getTime())
  assert.equal(entry.author, IDENTITY_NAME)
  assert.equal(entry.subject, 'feat: the only commit')
})

test('git: add and del are the numstat totals of the commit', (t) => {
  const dir = initRepo(t, {
    commits: [
      // 3 lines added, nothing deleted.
      { message: 'feat: three lines', date: insideHorizon(3), files: { 'a.txt': 'one\ntwo\nthree\n' } },
      // a.txt: one line replaced (1 added, 1 deleted); b.txt: 2 lines added.
      {
        message: 'fix: one line and a new file',
        date: insideHorizon(2),
        files: { 'a.txt': 'one\nTWO\nthree\n', 'b.txt': 'alpha\nbeta\n' },
      },
    ],
  })
  const snapshot = runSnapshot(t, dir)

  const bySubject = new Map(snapshot.git.map((entry) => [entry.subject, entry]))
  assert.equal(bySubject.get('feat: three lines').add, 3)
  assert.equal(bySubject.get('feat: three lines').del, 0)
  assert.equal(bySubject.get('fix: one line and a new file').add, 3)
  assert.equal(bySubject.get('fix: one line and a new file').del, 1)
})

test('git: a binary file whose numstat columns are dashes counts as zero', (t) => {
  const binary = Buffer.from([0x00, 0x01, 0x02, 0x00, 0xff, 0x07, 0x00, 0x00, 0x03, 0x00])
  const dir = initRepo(t, {
    commits: [{ message: 'chore: add a binary file', date: insideHorizon(1), files: { 'bin.dat': binary } }],
  })
  const snapshot = runSnapshot(t, dir)

  assert.equal(snapshot.git.length, 1)
  assert.equal(snapshot.git[0].add, 0)
  assert.equal(snapshot.git[0].del, 0)
})

test('git: entries are ordered newest first', (t) => {
  const dir = initRepo(t, {
    commits: [
      { message: 'feat: oldest', date: insideHorizon(72), files: { 'a.txt': 'one\n' } },
      { message: 'feat: middle', date: insideHorizon(48), files: { 'a.txt': 'two\n' } },
      { message: 'feat: newest', date: insideHorizon(24), files: { 'a.txt': 'three\n' } },
    ],
  })
  const snapshot = runSnapshot(t, dir)
  assert.deepEqual(snapshot.git.map((entry) => entry.subject), ['feat: newest', 'feat: middle', 'feat: oldest'])
})

test('git: the 30-day horizon drops the older commits when it holds at least 50', (t) => {
  // 52 commits inside the horizon, so the 50-commit floor cannot extend past it, plus
  // three commits outside it that must not survive.
  const bulkCommits = []
  for (const days of [45, 40, 35]) {
    bulkCommits.push({ message: `chore: outside the horizon at ${days} days`, date: outsideHorizon(days) })
  }
  for (let i = 52; i >= 1; i--) {
    bulkCommits.push({ message: `chore: inside the horizon at ${i} hours`, date: insideHorizon(i) })
  }
  const dir = initRepo(t, { bulkCommits })
  const snapshot = runSnapshot(t, dir)

  assert.equal(snapshot.git.length, 52)
  for (const entry of snapshot.git) {
    assert.ok(entry.subject.startsWith('chore: inside'), `unexpected entry ${entry.subject}`)
    assert.ok(NOW - new Date(entry.date).getTime() < WINDOW_DAYS * DAY)
  }
})

test('git: the 50-commit floor keeps commits older than the horizon', (t) => {
  // Three commits inside the horizon and five outside it: eight in total, fewer than the
  // floor, so all eight survive.
  const commits = []
  for (const days of [90, 75, 60, 45, 35]) {
    commits.push({ message: `chore: outside at ${days} days`, date: outsideHorizon(days), files: { 'a.txt': `d${days}\n` } })
  }
  for (const hours of [72, 48, 24]) {
    commits.push({ message: `chore: inside at ${hours} hours`, date: insideHorizon(hours), files: { 'a.txt': `h${hours}\n` } })
  }
  const dir = initRepo(t, { commits })
  const snapshot = runSnapshot(t, dir)

  assert.equal(snapshot.git.length, 8)
  assert.equal(snapshot.git[0].subject, 'chore: inside at 24 hours')
  assert.equal(snapshot.git[7].subject, 'chore: outside at 90 days')
})

test('git: the floor stops at the 50 most recent commits', (t) => {
  // Two commits inside the horizon and 55 outside it. The horizon holds fewer than 50, so
  // the window extends to the 50 most recent overall and no further.
  const bulkCommits = []
  for (let i = 55; i >= 1; i--) {
    bulkCommits.push({ message: `chore: outside number ${i}`, date: outsideHorizon(WINDOW_DAYS + 1 + i) })
  }
  bulkCommits.push({ message: 'chore: inside number 2', date: insideHorizon(48) })
  bulkCommits.push({ message: 'chore: inside number 1', date: insideHorizon(24) })
  const dir = initRepo(t, { bulkCommits })
  const snapshot = runSnapshot(t, dir)

  assert.equal(snapshot.git.length, FLOOR_EVENTS)
  assert.equal(snapshot.git[0].subject, 'chore: inside number 1')
  assert.equal(snapshot.git[1].subject, 'chore: inside number 2')
  assert.equal(snapshot.git[2].subject, 'chore: outside number 1')
})

test('git: the ceiling keeps at most 500 commits', (t) => {
  // 505 commits, all inside the horizon: only the 500 most recent survive.
  const bulkCommits = []
  for (let i = 505; i >= 1; i--) {
    bulkCommits.push({ message: `chore: commit ${i} minutes back`, date: new Date(NOW - i * MINUTE) })
  }
  const dir = initRepo(t, { bulkCommits })
  const snapshot = runSnapshot(t, dir)

  assert.equal(snapshot.git.length, CEILING_EVENTS)
  assert.equal(snapshot.git[0].subject, 'chore: commit 1 minutes back')
  assert.equal(snapshot.git[CEILING_EVENTS - 1].subject, 'chore: commit 500 minutes back')
})

test('git: a repository with no commits yields an empty array', (t) => {
  const dir = initRepo(t, {})
  const snapshot = runSnapshot(t, dir)
  assert.deepEqual(snapshot.git, [])
})

// ---------------------------------------------------------------------------
// knowledge
// ---------------------------------------------------------------------------

test('knowledge: a concept carries id, path, type, frontmatter and updated', (t) => {
  const dir = initRepo(t, {
    knowledge: {
      'docs/alpha.md': concept('type: doc\ntitle: Alpha', 'a short body'),
      'memories/deep/nested.md': concept('type: memory\ntitle: Nested', 'a nested body'),
    },
  })
  // The mtime is what updated reports, so it is fixed rather than left to the clock.
  const updated = insideHorizon(3)
  fs.utimesSync(path.join(dir, KNOWLEDGE_ROOT, 'docs', 'alpha.md'), updated, updated)

  const snapshot = runSnapshot(t, dir)
  const alpha = fileByPath(snapshot, 'docs/alpha.md')
  assert.equal(alpha.type, 'doc')
  assert.deepEqual(alpha.frontmatter, { type: 'doc', title: 'Alpha' })
  assert.equal(new Date(alpha.updated).getTime(), updated.getTime())
  assert.deepEqual(Object.keys(alpha).sort(), ['frontmatter', 'id', 'path', 'size', 'type', 'updated'])

  // path is relative to the persistence root, with forward slashes, at any depth.
  const nested = fileByPath(snapshot, 'memories/deep/nested.md')
  assert.equal(nested.type, 'memory')
})

test('knowledge: no entry carries a body or a truncated flag', (t) => {
  // Bodies leave the listing entirely (D43 point 4) and are fetched one at a time instead,
  // so neither a short body nor a very long one is ever embedded, and nothing is ever cut,
  // so nothing is ever flagged as cut either.
  const dir = initRepo(t, {
    knowledge: {
      'docs/short.md': conceptExact('type: doc\ntitle: Short', 'y'.repeat(10)),
      'docs/long.md': conceptExact('type: doc\ntitle: Long', 'x'.repeat(2000000)),
    },
  })
  const snapshot = runSnapshot(t, dir)

  assert.equal(snapshot.knowledge.files.length, 2)
  for (const file of snapshot.knowledge.files) {
    assert.equal('body' in file, false, `${file.path} must carry no body at all`)
    assert.equal('truncated' in file, false, `${file.path} must carry no truncated key at all`)
  }
})

test('knowledge: size is the byte size of the file on disk', (t) => {
  const contents = concept('type: doc\ntitle: Sized', 'a body of a known length')
  const dir = initRepo(t, { knowledge: { 'docs/sized.md': contents } })
  const snapshot = runSnapshot(t, dir)
  assert.equal(fileByPath(snapshot, 'docs/sized.md').size, Buffer.byteLength(contents))
})

test('knowledge: index.md, dashboard.html, intents.log and a file without frontmatter are excluded', (t) => {
  const dir = initRepo(t, {
    index: ['docs/alpha.md'],
    knowledge: {
      'docs/alpha.md': concept('type: doc\ntitle: Alpha', 'alpha body'),
      // A markdown file with no frontmatter is not a concept.
      'docs/plain.md': '# Just a heading\n\nNo frontmatter here.\n',
      // The generated dashboard lives inside the persistence root and is never collected.
      'dashboard.html': '<html><body>previous dashboard</body></html>\n',
    },
    intentsLog: [logLine({ at: insideHorizon(1), summary: 'a logged intent' })],
  })
  const snapshot = runSnapshot(t, dir)

  const paths = snapshot.knowledge.files.map((f) => f.path)
  assert.deepEqual(paths, ['docs/alpha.md'])
  assert.equal(paths.includes('index.md'), false)
  assert.equal(paths.includes('dashboard.html'), false)
  assert.equal(paths.includes('runs/intents.log'), false)
  assert.equal(paths.includes('docs/plain.md'), false)
})

test('knowledge: every entry carries an opaque hex id, unique across the bundle', (t) => {
  const knowledge = {}
  const order = []
  for (let i = 0; i < 40; i++) {
    const rel = `docs/f${String(i).padStart(2, '0')}.md`
    order.push(rel)
    knowledge[rel] = concept(`type: doc\ntitle: File ${i}`, `body ${i}`)
  }
  // Two files with identical contents, so an id derived from the body rather than from the
  // path would collide here.
  knowledge['memories/twin-a.md'] = concept('type: memory\ntitle: Twin', 'the same body')
  knowledge['memories/twin-b.md'] = concept('type: memory\ntitle: Twin', 'the same body')
  const dir = initRepo(t, { knowledge, index: order })
  const snapshot = runSnapshot(t, dir)

  const ids = snapshot.knowledge.files.map((f) => f.id)
  assert.equal(ids.length, 42)
  for (const file of snapshot.knowledge.files) {
    assert.equal(typeof file.id, 'string')
    assert.match(file.id, /^[0-9a-f]+$/, `${file.path} must carry a hex id`)
    assert.ok(file.id.length >= 8, `${file.path} id must be long enough to be unique in practice`)
    // Opaque: the id says nothing about the path it addresses.
    assert.equal(file.id.includes('/'), false)
    assert.equal(file.id.includes('.md'), false)
  }
  assert.equal(new Set(ids).size, ids.length, 'ids must be unique across the bundle')
})

test('knowledge: the id of a path is the same on two separate runs and in two repositories', (t) => {
  const knowledge = { 'docs/alpha.md': concept('type: doc\ntitle: Alpha', 'alpha body') }
  const first = initRepo(t, { knowledge })

  const one = runSnapshot(t, first)
  const two = runSnapshot(t, first)
  assert.equal(fileByPath(two, 'docs/alpha.md').id, fileByPath(one, 'docs/alpha.md').id)

  // The id derives from the path relative to the persistence root and from nothing else, so
  // a different checkout in a different directory, and a body edited in between, address the
  // same concept by the same id.
  const second = initRepo(t, { knowledge: { 'docs/alpha.md': concept('type: doc\ntitle: Alpha', 'a rewritten body') } })
  assert.notEqual(second, first)
  const other = runSnapshot(t, second)
  assert.equal(fileByPath(other, 'docs/alpha.md').id, fileByPath(one, 'docs/alpha.md').id)
})

// The ordering survives the removal of the byte caps that first motivated it: index.md is
// the OKF bundle's progressive-disclosure mechanism (D28), so the order it imposes is the
// order its author wants the bundle read, and the listing now presents rather than truncates.
test('knowledge: the files listed in index.md come first, in index order', (t) => {
  const dir = initRepo(t, {
    // The index lists beta before alpha and never mentions gamma.
    index: ['docs/beta.md', 'docs/alpha.md'],
    knowledge: {
      'docs/alpha.md': concept('type: doc\ntitle: Alpha', 'alpha body'),
      'docs/beta.md': concept('type: doc\ntitle: Beta', 'beta body'),
      'docs/gamma.md': concept('type: doc\ntitle: Gamma', 'gamma body'),
    },
  })
  const snapshot = runSnapshot(t, dir)
  assert.deepEqual(
    snapshot.knowledge.files.map((f) => f.path),
    ['docs/beta.md', 'docs/alpha.md', 'docs/gamma.md']
  )
})

// ---------------------------------------------------------------------------
// decisions
// ---------------------------------------------------------------------------

test('decisions: only concepts with type decision produce entries', (t) => {
  const dir = initRepo(t, {
    knowledge: {
      'docs/d1.md': concept('type: decision\nid: D1\ntitle: The first decision\ndate: "2026-01-15"\nstatus: open', 'why'),
      'docs/note.md': concept('type: doc\ntitle: Not a decision', 'a note'),
      'memories/m1.md': concept('type: memory\ntitle: Also not a decision', 'a memory'),
    },
  })
  const snapshot = runSnapshot(t, dir)

  assert.equal(snapshot.decisions.length, 1)
  const decision = decisionById(snapshot, 'D1')
  assert.equal(decision.text, 'The first decision')
  assert.equal(decision.status, 'open')
  assert.ok(String(decision.date).startsWith('2026-01-15'), `unexpected date ${decision.date}`)
})

test('decisions: id and text fall back to the path', (t) => {
  const dir = initRepo(t, {
    knowledge: { 'docs/d2.md': concept('type: decision', 'a decision with no id and no title') },
  })
  const snapshot = runSnapshot(t, dir)

  assert.equal(snapshot.decisions.length, 1)
  assert.equal(snapshot.decisions[0].id, 'docs/d2.md')
  assert.equal(snapshot.decisions[0].text, 'docs/d2.md')
})

test('decisions: status is open only when the frontmatter says so', (t) => {
  const dir = initRepo(t, {
    knowledge: {
      'docs/open.md': concept('type: decision\nid: D-open\ntitle: Open\nstatus: open', 'body'),
      'docs/closed.md': concept('type: decision\nid: D-closed\ntitle: Closed\nstatus: closed', 'body'),
      'docs/silent.md': concept('type: decision\nid: D-silent\ntitle: Silent', 'body'),
    },
  })
  const snapshot = runSnapshot(t, dir)

  assert.equal(snapshot.decisions.length, 3)
  assert.equal(decisionById(snapshot, 'D-open').status, 'open')
  assert.equal(decisionById(snapshot, 'D-closed').status, 'closed')
  assert.equal(decisionById(snapshot, 'D-silent').status, 'closed')
})

// ---------------------------------------------------------------------------
// timeline
// ---------------------------------------------------------------------------

test('timeline: the three sources merge into one newest-first list', (t) => {
  const logAt = insideHorizon(2)
  const intentAt = insideHorizon(1)
  const runAt = insideHorizon(3)
  const dir = initRepo(t, {
    intentsLog: [
      logLine({ at: logAt, tier: 'trivial', type: 'question', promptId: 'p-log', sessionId: 's-log', summary: 'a logged intent' }),
    ],
    knowledge: {
      'runs/intents/i-1.md': conceptExact(
        [
          'type: intent',
          'title: A substantive intent',
          `recorded_at: "${intentAt.toISOString()}"`,
          'tier: substantive',
          'request_type: feature',
          'prompt_id: p-md',
          'session_id: s-md',
        ].join('\n'),
        'a substantive intent'
      ),
      'runs/onboard-2026.md': conceptExact(
        [
          'type: run',
          'title: An onboard run',
          'generated:',
          '  by: major-tom-onboard',
          `  at: "${runAt.toISOString()}"`,
        ].join('\n'),
        'the run body'
      ),
    },
  })
  const snapshot = runSnapshot(t, dir)
  const events = snapshot.timeline.events

  assert.equal(events.length, 3)
  assert.deepEqual(events.map((e) => new Date(e.at).getTime()), [intentAt.getTime(), logAt.getTime(), runAt.getTime()])

  assert.deepEqual(events[0], {
    at: events[0].at,
    kind: 'intent',
    tier: 'substantive',
    type: 'feature',
    promptId: 'p-md',
    sessionId: 's-md',
    summary: 'a substantive intent',
    summaryTruncated: false,
    path: 'runs/intents/i-1.md',
  })

  assert.equal(events[1].kind, 'intent')
  assert.equal(events[1].tier, 'trivial')
  assert.equal(events[1].type, 'question')
  assert.equal(events[1].promptId, 'p-log')
  assert.equal(events[1].sessionId, 's-log')
  assert.equal(events[1].summary, 'a logged intent')
  assert.equal(events[1].path, null)

  assert.equal(events[2].kind, 'run')
  assert.equal(events[2].tier, null)
  assert.equal(events[2].type, null)
  assert.equal(events[2].summary, 'An onboard run')
  assert.equal(events[2].path, 'runs/onboard-2026.md')
})

test('timeline: a run record without a generated timestamp falls back to the file mtime', (t) => {
  const dir = initRepo(t, {
    knowledge: {
      'runs/undated.md': conceptExact('type: run\ntitle: An undated run', 'the run body'),
    },
  })
  const mtime = insideHorizon(5)
  fs.utimesSync(path.join(dir, KNOWLEDGE_ROOT, 'runs', 'undated.md'), mtime, mtime)

  const snapshot = runSnapshot(t, dir)
  assert.equal(snapshot.timeline.events.length, 1)
  assert.equal(new Date(snapshot.timeline.events[0].at).getTime(), mtime.getTime())
})

test('timeline: a six-field log line keeps a summary that contains a tab', (t) => {
  const at = insideHorizon(1)
  const summary = 'first chunk\tsecond chunk'
  const dir = initRepo(t, {
    intentsLog: [
      logLine({ at, tier: 'task', type: 'edit', promptId: 'p-tabbed', sessionId: 'sess-1234abcd', summary }),
    ],
  })
  const snapshot = runSnapshot(t, dir)

  assert.equal(snapshot.timeline.events.length, 1)
  const event = snapshot.timeline.events[0]
  // Seven fields on the wire: the session id is still field five and the summary is field
  // six onward rejoined with tabs.
  assert.equal(event.sessionId, 'sess-1234abcd')
  assert.equal(event.summary, summary)
  assert.equal(event.promptId, 'p-tabbed')
  assert.equal(event.tier, 'task')
  assert.equal(event.type, 'edit')
  assert.equal(event.kind, 'intent')
  assert.equal(event.path, null)
})

test('timeline: a five-field legacy line has a null session id', (t) => {
  const at = insideHorizon(1)
  const dir = initRepo(t, {
    intentsLog: [
      legacyLogLine({ at, tier: 'trivial', type: 'question', promptId: 'p-legacy', summary: 'a legacy summary' }),
    ],
  })
  const snapshot = runSnapshot(t, dir)

  assert.equal(snapshot.timeline.events.length, 1)
  const event = snapshot.timeline.events[0]
  assert.equal(event.sessionId, null)
  assert.equal(event.summary, 'a legacy summary')
  assert.equal(event.promptId, 'p-legacy')
  assert.equal(event.kind, 'intent')
})

test('timeline: window always carries the three literal limits and no byte budget', (t) => {
  const dir = initRepo(t, {})
  const snapshot = runSnapshot(t, dir)
  // deepEqual on the whole object, so a fourth member would fail here: the byte budget left
  // the schema with D43 point 4 and nothing replaced it.
  assert.deepEqual(snapshot.timeline.window, {
    days: WINDOW_DAYS,
    floorEvents: FLOOR_EVENTS,
    ceilingEvents: CEILING_EVENTS,
  })
  assert.equal('byteBudget' in snapshot.timeline.window, false)
})

test('timeline: a summary over 200 characters is cut and flagged', (t) => {
  const dir = initRepo(t, {
    knowledge: {
      'runs/intents/long.md': conceptExact(
        `type: intent\ntitle: Long\nrecorded_at: "${insideHorizon(1).toISOString()}"\ntier: substantive\nrequest_type: feature\nprompt_id: p-long\nsession_id: s-long`,
        'w'.repeat(250)
      ),
    },
  })
  const snapshot = runSnapshot(t, dir)

  const event = snapshot.timeline.events[0]
  assert.equal(event.summary.length, SUMMARY_CAP)
  assert.match(event.summary, /^w+$/)
  assert.equal(event.summaryTruncated, true)
})

test('timeline: a summary of exactly 200 characters is not flagged', (t) => {
  const dir = initRepo(t, {
    knowledge: {
      'runs/intents/exact.md': conceptExact(
        `type: intent\ntitle: Exact\nrecorded_at: "${insideHorizon(1).toISOString()}"\ntier: substantive\nrequest_type: feature\nprompt_id: p-exact\nsession_id: s-exact`,
        'v'.repeat(SUMMARY_CAP)
      ),
    },
  })
  const snapshot = runSnapshot(t, dir)

  const event = snapshot.timeline.events[0]
  assert.equal(event.summary.length, SUMMARY_CAP)
  assert.notEqual(event.summaryTruncated, true)
})

test('timeline: omitted.reason is days when only the horizon bites', (t) => {
  // 55 events inside the horizon, which is more than the floor, so nothing extends the
  // window, and four events outside it that the horizon drops.
  const lines = []
  for (let i = 1; i <= 55; i++) {
    lines.push(logLine({ at: insideHorizon(i), promptId: `p-${i}`, summary: `inside ${i}` }))
  }
  for (const days of [40, 41, 42, 43]) {
    lines.push(logLine({ at: outsideHorizon(days), promptId: `p-old-${days}`, summary: `outside ${days}` }))
  }
  const dir = initRepo(t, { intentsLog: lines })
  const snapshot = runSnapshot(t, dir)

  assert.equal(snapshot.timeline.events.length, 55)
  assert.equal(snapshot.timeline.omitted.count, 4)
  assert.equal(snapshot.timeline.omitted.reason, 'days')
  assert.equal(new Date(snapshot.timeline.omitted.oldestKept).getTime(), insideHorizon(55).getTime())
})

test('timeline: omitted.reason is ceiling when only the 500 limit bites', (t) => {
  // 505 events, all inside the horizon, so the ceiling is the only limit that can bite.
  const lines = []
  for (let i = 1; i <= 505; i++) {
    lines.push(logLine({ at: new Date(NOW - i * MINUTE), promptId: `p-${i}`, summary: `event ${i}` }))
  }
  const dir = initRepo(t, { intentsLog: lines })
  const snapshot = runSnapshot(t, dir)

  assert.equal(snapshot.timeline.events.length, CEILING_EVENTS)
  assert.equal(snapshot.timeline.omitted.count, 5)
  assert.equal(snapshot.timeline.omitted.reason, 'ceiling')
  assert.equal(snapshot.timeline.events[0].summary, 'event 1')
  assert.equal(snapshot.timeline.events[CEILING_EVENTS - 1].summary, 'event 500')
})

test('timeline: a large volume of events is never cut by weight', (t) => {
  // Sixty events, all inside the horizon, so neither the horizon nor the ceiling bites and
  // the floor has nothing to extend. Each carries a very wide promptId, so the serialized
  // events run to hundreds of kilobytes: under the old 262144-byte budget this fixture lost
  // events and reported reason "bytes". No byte limit exists any more (D43 point 4), so all
  // sixty survive and nothing is omitted.
  const wideId = 'p-' + 'i'.repeat(5000)
  const lines = []
  for (let i = 1; i <= 60; i++) {
    lines.push(logLine({ at: insideHorizon(i), promptId: `${wideId}-${i}`, summary: `wide event ${i}` }))
  }
  const dir = initRepo(t, { intentsLog: lines })
  const snapshot = runSnapshot(t, dir)

  const events = snapshot.timeline.events
  assert.equal(events.length, 60)
  assert.ok(Buffer.byteLength(JSON.stringify(events)) > 262144, 'the fixture must exceed the budget that used to exist')
  assert.equal(snapshot.timeline.omitted.count, 0)
  assert.equal(snapshot.timeline.omitted.reason, null)
  assert.equal(events[0].summary, 'wide event 1')
  assert.equal(events[59].summary, 'wide event 60')
})

test('timeline: omitted.reason is null when nothing is omitted', (t) => {
  const dir = initRepo(t, {
    intentsLog: [
      logLine({ at: insideHorizon(3), promptId: 'p-3', summary: 'third' }),
      logLine({ at: insideHorizon(2), promptId: 'p-2', summary: 'second' }),
      logLine({ at: insideHorizon(1), promptId: 'p-1', summary: 'first' }),
    ],
  })
  const snapshot = runSnapshot(t, dir)

  assert.equal(snapshot.timeline.events.length, 3)
  assert.equal(snapshot.timeline.omitted.count, 0)
  assert.equal(snapshot.timeline.omitted.reason, null)
})

test('timeline: oldestKept is the at of the oldest surviving event', (t) => {
  const oldest = insideHorizon(9)
  const dir = initRepo(t, {
    intentsLog: [
      logLine({ at: oldest, promptId: 'p-9', summary: 'oldest' }),
      logLine({ at: insideHorizon(5), promptId: 'p-5', summary: 'middle' }),
      logLine({ at: insideHorizon(1), promptId: 'p-1', summary: 'newest' }),
    ],
  })
  const snapshot = runSnapshot(t, dir)

  assert.equal(new Date(snapshot.timeline.omitted.oldestKept).getTime(), oldest.getTime())
  assert.equal(
    new Date(snapshot.timeline.omitted.oldestKept).getTime(),
    new Date(snapshot.timeline.events[snapshot.timeline.events.length - 1].at).getTime()
  )
})

test('timeline: no intents and no run records yield an empty timeline', (t) => {
  const dir = initRepo(t, {
    knowledge: { 'docs/alpha.md': concept('type: doc\ntitle: Alpha', 'alpha body') },
  })
  const snapshot = runSnapshot(t, dir)

  assert.deepEqual(snapshot.timeline.events, [])
  assert.equal(snapshot.timeline.omitted.count, 0)
  assert.equal(snapshot.timeline.omitted.oldestKept, null)
  assert.equal(snapshot.timeline.omitted.reason, null)
})

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

test('determinism: two runs over an unchanged repository differ only in generatedAt', (t) => {
  const dir = initRepo(t, {
    index: ['docs/beta.md', 'docs/alpha.md'],
    knowledge: {
      'docs/alpha.md': concept('type: decision\nid: D1\ntitle: A decision\nstatus: open', 'why'),
      'docs/beta.md': concept('type: doc\ntitle: Beta', 'beta body'),
      'runs/intents/i-1.md': conceptExact(
        `type: intent\ntitle: An intent\nrecorded_at: "${insideHorizon(1).toISOString()}"\ntier: substantive\nrequest_type: feature\nprompt_id: p-md\nsession_id: s-md`,
        'a substantive intent'
      ),
      'runs/onboard-2026.md': conceptExact(
        `type: run\ntitle: An onboard run\ngenerated:\n  by: major-tom-onboard\n  at: "${insideHorizon(4).toISOString()}"`,
        'the run body'
      ),
    },
    intentsLog: [
      logLine({ at: insideHorizon(2), promptId: 'p-log', summary: 'a logged intent' }),
      legacyLogLine({ at: insideHorizon(6), promptId: 'p-legacy', summary: 'a legacy intent' }),
    ],
    commits: [
      { message: 'feat: first', date: insideHorizon(8), files: { 'a.txt': 'one\n' } },
      { message: 'fix: second', date: insideHorizon(7), files: { 'a.txt': 'two\n' } },
    ],
  })

  const first = runSnapshot(t, dir)
  const second = runSnapshot(t, dir)

  assert.equal(new Date(first.generatedAt).toISOString(), first.generatedAt)
  assert.equal(new Date(second.generatedAt).toISOString(), second.generatedAt)

  delete first.generatedAt
  delete second.generatedAt
  // Comparing the re-serialized objects also compares key order, so a reordered walk is a
  // failure here even though the values match.
  assert.equal(JSON.stringify(second), JSON.stringify(first))
})

// ---------------------------------------------------------------------------
// The library entry point
// ---------------------------------------------------------------------------

// The server imports the computation instead of spawning it, so the module export and the
// CLI have to be the same computation and have to fail on the same conditions. They differ
// in one thing only: the CLI exits, the library throws.

test('library: buildSnapshot returns exactly what the CLI writes', (t) => {
  const dir = initRepo(t, {
    index: ['docs/beta.md', 'docs/alpha.md'],
    knowledge: {
      'docs/alpha.md': concept('type: decision\nid: D1\ntitle: A decision\nstatus: open', 'why'),
      'docs/beta.md': concept('type: doc\ntitle: Beta', 'beta body'),
    },
    intentsLog: [logLine({ at: insideHorizon(2), promptId: 'p-log', summary: 'a logged intent' })],
    commits: [{ message: 'feat: first', date: insideHorizon(8), files: { 'a.txt': 'one\n' } }],
  })

  const fromCli = runSnapshot(t, dir)
  const fromLibrary = require(SCRIPT).buildSnapshot({ repoRoot: dir })

  assert.equal(new Date(fromLibrary.generatedAt).toISOString(), fromLibrary.generatedAt)
  delete fromCli.generatedAt
  delete fromLibrary.generatedAt
  // Re-serialized, so key order is compared too.
  assert.equal(JSON.stringify(fromLibrary), JSON.stringify(fromCli))
})

test('library: a fail-closed condition throws and the caller survives it', (t) => {
  const { buildSnapshot } = require(SCRIPT)
  const broken = initRepo(t, { noConfig: true })
  const sound = initRepo(t, { knowledge: { 'docs/alpha.md': concept('type: doc\ntitle: Alpha', 'alpha body') } })

  let caught = null
  try {
    buildSnapshot({ repoRoot: broken })
  } catch (err) {
    caught = err
  }
  assert.ok(caught instanceof Error, 'the library path must throw')
  assert.match(caught.message, /major-tom\.json/)

  // The throw left the process usable, which is the whole point: a server must answer the
  // next request rather than exit because this one named a repository that is not onboarded.
  const snapshot = buildSnapshot({ repoRoot: sound })
  assert.equal(fileByPath(snapshot, 'docs/alpha.md').type, 'doc')
})

// ---------------------------------------------------------------------------
// The body reader
// ---------------------------------------------------------------------------

// readConceptBody({repoRoot, id}) is the whole implementation of the body endpoint, and it
// lives beside the concept walk so that no caller ever holds a knowledge path: the server
// hands over an opaque id and gets a body or nothing back. The tests below are therefore about
// two things, that an id the listing minted resolves to exactly the body the listing described,
// and that everything else resolves to nothing at all.

// The id of a persistence-root-relative path, computed the way the spec states it: a prefix of
// the hex SHA-256 of the path. The prefix length is read from an id the snapshot actually
// minted, so this helper never fixes a length the schema does not fix.
function idOfPath(rel, sampleId) {
  return crypto.createHash('sha256').update(rel, 'utf8').digest('hex').slice(0, sampleId.length)
}

// The body of a fixture file as the file itself holds it: everything after the line that
// closes the frontmatter, read here rather than reconstructed from what was written.
function bodyOnDisk(dir, rel) {
  const lines = fs.readFileSync(path.join(dir, KNOWLEDGE_ROOT, rel), 'utf8').split('\n')
  const end = lines.indexOf('---', 1)
  assert.notEqual(end, -1, `${rel} must have a closing frontmatter fence`)
  return lines.slice(end + 1).join('\n')
}

test('body: a minted id returns exactly that file body', (t) => {
  const dir = initRepo(t, {
    index: ['docs/alpha.md'],
    knowledge: {
      'docs/alpha.md': conceptExact('type: doc\ntitle: Alpha', '# Alpha\n\nthe alpha body\n'),
      'memories/deep/nested.md': conceptExact('type: memory\ntitle: Nested', 'the nested body'),
    },
  })
  const { readConceptBody } = require(SCRIPT)
  const snapshot = runSnapshot(t, dir)

  for (const rel of ['docs/alpha.md', 'memories/deep/nested.md']) {
    const id = fileByPath(snapshot, rel).id
    assert.equal(readConceptBody({ repoRoot: dir, id }), bodyOnDisk(dir, rel), `body of ${rel}`)
  }

  // Byte for byte, and each id addresses its own file and not the other one.
  assert.equal(
    readConceptBody({ repoRoot: dir, id: fileByPath(snapshot, 'docs/alpha.md').id }),
    '# Alpha\n\nthe alpha body\n'
  )
  assert.equal(
    readConceptBody({ repoRoot: dir, id: fileByPath(snapshot, 'memories/deep/nested.md').id }),
    'the nested body'
  )
})

test('body: the split is the one the concept walk uses', (t) => {
  // A body carrying a line that looks like a frontmatter fence, and a leading blank line from
  // the ordinary concept shape: the reader must return everything after the first closing
  // fence and must not cut at the second one.
  const dir = initRepo(t, {
    knowledge: { 'docs/fenced.md': concept('type: doc\ntitle: Fenced', 'before\n---\nafter') },
  })
  const { readConceptBody } = require(SCRIPT)
  const snapshot = runSnapshot(t, dir)
  const id = fileByPath(snapshot, 'docs/fenced.md').id

  assert.equal(readConceptBody({ repoRoot: dir, id }), '\nbefore\n---\nafter\n')
  assert.equal(readConceptBody({ repoRoot: dir, id }), bodyOnDisk(dir, 'docs/fenced.md'))
})

test('body: an id no file carries returns null, index.md included', (t) => {
  const dir = initRepo(t, {
    index: ['docs/alpha.md'],
    knowledge: { 'docs/alpha.md': concept('type: doc\ntitle: Alpha', 'alpha body') },
  })
  const { readConceptBody } = require(SCRIPT)
  const snapshot = runSnapshot(t, dir)
  const sampleId = fileByPath(snapshot, 'docs/alpha.md').id

  // An id that was never minted: the same shape, addressing a path that does not exist.
  assert.equal(readConceptBody({ repoRoot: dir, id: idOfPath('docs/never-written.md', sampleId) }), null)
  assert.equal(readConceptBody({ repoRoot: dir, id: 'f'.repeat(sampleId.length) }), null)

  // index.md is reserved and is never a concept, so it never gets an id and its id can never
  // be resolved: the bundle index is not fetchable through the body endpoint.
  const indexId = idOfPath('index.md', sampleId)
  assert.equal(snapshot.knowledge.files.some((f) => f.id === indexId), false, 'index.md must never be listed')
  assert.equal(readConceptBody({ repoRoot: dir, id: indexId }), null)
})

test('body: a malformed id returns null instead of throwing', (t) => {
  const dir = initRepo(t, {
    knowledge: {
      'docs/alpha.md': concept('type: doc\ntitle: Alpha', 'alpha body'),
      'docs/d1.md': concept('type: decision\nid: D1\ntitle: A decision', 'why'),
    },
  })
  const { readConceptBody, SnapshotError } = require(SCRIPT)

  // A malformed query string is a 404 and not a server fault, so every one of these returns
  // null; any throw here fails the test by itself.
  const malformed = [
    '',
    undefined,
    null,
    42,
    {},
    ['docs/alpha.md'],
    // Path-shaped values, which are exactly what the id addressing exists to make unusable:
    // the reader compares them against minted ids and never joins them to anything.
    '../../../../etc/passwd',
    '/etc/passwd',
    'docs/alpha.md',
    'docs/d1.md',
  ]
  for (const id of malformed) {
    assert.equal(readConceptBody({ repoRoot: dir, id }), null, `id ${JSON.stringify(id)} must resolve to nothing`)
  }
  assert.equal(readConceptBody({ repoRoot: dir }), null, 'an absent id must resolve to nothing')

  // This case used to read `readConceptBody({})` and assert null, on the reading that an
  // absent id resolves to nothing "before anything is read". That reading was the defect: it
  // was the id test standing in front of the config read, which made one broken repository
  // report two different things through the one endpoint, a 404 for a request without an id
  // and a 500 naming the missing config for a request with one. The config is now read first,
  // so the repository is diagnosed before the request is, and the corrected contract is the
  // pair below: a sound repository answers null whatever the id was (asserted above), and a
  // broken one throws whatever the id was, absent id included.
  //
  // The repository is named explicitly here, which the old assertion could not do: with the
  // config read first, `readConceptBody({})` reads whatever repository the process happens to
  // be running in, and this file must not assert an answer that depends on that.
  const broken = initRepo(t, { noConfig: true })
  for (const call of [{ repoRoot: broken }, { repoRoot: broken, id: '' }, { repoRoot: broken, id: 'docs/alpha.md' }]) {
    assert.throws(
      () => readConceptBody(call),
      (err) => err instanceof SnapshotError && /major-tom\.json/.test(err.message),
      `a broken repository must be diagnosed the same way for ${JSON.stringify(call.id)}`
    )
  }
})

test('body: a fail-closed condition throws and the caller survives it', (t) => {
  const { readConceptBody, SnapshotError } = require(SCRIPT)
  const broken = initRepo(t, { noConfig: true })
  const sound = initRepo(t, { knowledge: { 'docs/alpha.md': concept('type: doc\ntitle: Alpha', 'alpha body') } })
  const snapshot = runSnapshot(t, sound)
  const id = fileByPath(snapshot, 'docs/alpha.md').id

  // An un-onboarded repository is reported the same way through both entry points, so the
  // page can name what is wrong instead of showing an empty body.
  let caught = null
  try {
    readConceptBody({ repoRoot: broken, id })
  } catch (err) {
    caught = err
  }
  assert.ok(caught instanceof SnapshotError, 'a fail-closed condition must throw a SnapshotError')
  assert.match(caught.message, /major-tom\.json/)

  // And the throw left the process usable, which is what lets a server answer the next request.
  assert.equal(readConceptBody({ repoRoot: sound, id }), '\nalpha body\n')
})

test('body: the list is recomputed on every call, so nothing goes stale', (t) => {
  const dir = initRepo(t, {
    knowledge: { 'docs/alpha.md': concept('type: doc\ntitle: Alpha', 'the first body') },
  })
  const { readConceptBody } = require(SCRIPT)
  const snapshot = runSnapshot(t, dir)
  const id = fileByPath(snapshot, 'docs/alpha.md').id
  assert.equal(readConceptBody({ repoRoot: dir, id }), '\nthe first body\n')

  // The id derives from the path, so it survives an edit to the file; the body it resolves to
  // is read from disk on this call and is the edited one.
  fs.writeFileSync(
    path.join(dir, KNOWLEDGE_ROOT, 'docs', 'alpha.md'),
    concept('type: doc\ntitle: Alpha', 'the second body')
  )
  assert.equal(readConceptBody({ repoRoot: dir, id }), '\nthe second body\n')

  // And a file that stops being a concept stops resolving at all.
  fs.writeFileSync(path.join(dir, KNOWLEDGE_ROOT, 'docs', 'alpha.md'), '# No frontmatter here\n')
  assert.equal(readConceptBody({ repoRoot: dir, id }), null)
})

// ---------------------------------------------------------------------------
// The window parameter (D45)
// ---------------------------------------------------------------------------

// The window is a configured default that a request may move inside hard bounds: days from 1
// to 365, limit from 50 to 500, the floor of 50 staying server behavior and never a parameter.
// The overrides only exist on the library entry point, the CLI always running at the
// configured window, so every test below drives buildSnapshot directly.

// A config whose snapshot block is exactly this window.
function configWithWindow(window) {
  const config = defaultConfig()
  config.snapshot = window
  return config
}

function buildWith(dir, overrides) {
  return require(SCRIPT).buildSnapshot(Object.assign({ repoRoot: dir }, overrides || {}))
}

// Refused, and refused by throwing: the call must not come back with a snapshot computed at
// some repaired window, which is what "refused, never clamped" means in practice.
function assertRefused(dir, overrides, pattern, label) {
  const { SnapshotError } = require(SCRIPT)
  assert.throws(
    () => buildWith(dir, overrides),
    (err) => {
      assert.ok(err instanceof SnapshotError, `${label} must throw a SnapshotError, got ${err && err.name}`)
      assert.match(err.message, pattern, `${label} message`)
      return true
    },
    `${label} must be refused rather than clamped`
  )
}

test('window: the configured default is read from the config, for both parameters', (t) => {
  const dir = initRepo(t, { config: configWithWindow({ days: 7, limit: 123 }) })
  const snapshot = buildWith(dir)
  assert.deepEqual(snapshot.timeline.window, { days: 7, floorEvents: FLOOR_EVENTS, ceilingEvents: 123 })

  // An explicitly absent override is an absent override: the configured value stands.
  const undefinedOverrides = buildWith(dir, { days: undefined, limit: undefined })
  assert.deepEqual(undefinedOverrides.timeline.window, { days: 7, floorEvents: FLOOR_EVENTS, ceilingEvents: 123 })
  const nullOverrides = buildWith(dir, { days: null, limit: null })
  assert.deepEqual(nullOverrides.timeline.window, { days: 7, floorEvents: FLOOR_EVENTS, ceilingEvents: 123 })
})

test('window: an explicit override wins over the configured value, for both parameters', (t) => {
  const dir = initRepo(t, { config: configWithWindow({ days: 7, limit: 123 }) })

  assert.equal(buildWith(dir, { days: 90 }).timeline.window.days, 90)
  assert.equal(buildWith(dir, { limit: 456 }).timeline.window.ceilingEvents, 456)

  // Either one alone leaves the other at the configured value: the two are independent.
  assert.equal(buildWith(dir, { days: 90 }).timeline.window.ceilingEvents, 123)
  assert.equal(buildWith(dir, { limit: 456 }).timeline.window.days, 7)

  const both = buildWith(dir, { days: 90, limit: 456 })
  assert.deepEqual(both.timeline.window, { days: 90, floorEvents: FLOOR_EVENTS, ceilingEvents: 456 })
})

test('window: an override outside the bounds is refused at both ends, never clamped', (t) => {
  const dir = initRepo(t, {})

  // The message names the parameter, the value received and the accepted range, because that
  // message is what the page ends up showing the user.
  assertRefused(dir, { days: DAYS_MIN - 1 }, /days.*integer.*between 1 and 365.*received 0/, 'days 0')
  assertRefused(dir, { days: DAYS_MAX + 1 }, /days.*integer.*between 1 and 365.*received 366/, 'days 366')
  assertRefused(dir, { limit: LIMIT_MIN - 1 }, /limit.*integer.*between 50 and 500.*received 49/, 'limit 49')
  assertRefused(dir, { limit: LIMIT_MAX + 1 }, /limit.*integer.*between 50 and 500.*received 501/, 'limit 501')

  // Negative and very large values are the same refusal and not a special case.
  assertRefused(dir, { days: -30 }, /days/, 'days -30')
  assertRefused(dir, { limit: 100000 }, /limit/, 'limit 100000')

  // And the refusal left the process usable, so a server answers the next request.
  assert.equal(buildWith(dir).timeline.window.days, WINDOW_DAYS)
})

test('window: the boundary values themselves are accepted', (t) => {
  const dir = initRepo(t, {})
  assert.equal(buildWith(dir, { days: DAYS_MIN }).timeline.window.days, DAYS_MIN)
  assert.equal(buildWith(dir, { days: DAYS_MAX }).timeline.window.days, DAYS_MAX)
  assert.equal(buildWith(dir, { limit: LIMIT_MIN }).timeline.window.ceilingEvents, LIMIT_MIN)
  assert.equal(buildWith(dir, { limit: LIMIT_MAX }).timeline.window.ceilingEvents, LIMIT_MAX)

  // The floor is never a parameter: it stays 50 whatever the ceiling is set to, including at
  // the ceiling's own minimum, where the two meet.
  assert.equal(buildWith(dir, { limit: LIMIT_MIN }).timeline.window.floorEvents, FLOOR_EVENTS)
})

test('window: a non-integer override is refused rather than coerced', (t) => {
  const dir = initRepo(t, {})
  const bad = [30.5, '30', ' 30 ', '1e2', 'banana', NaN, Infinity, -Infinity, true, {}, []]
  for (const value of bad) {
    assertRefused(dir, { days: value }, /days must be an integer between 1 and 365/, `days ${String(value)}`)
    assertRefused(dir, { limit: value }, /limit must be an integer between 50 and 500/, `limit ${String(value)}`)
  }
})

test('window: a configured default outside the bounds is refused', (t) => {
  const cases = [
    { window: { days: 0, limit: CEILING_EVENTS }, pattern: /snapshot\.days.*0.*between 1 and 365/ },
    { window: { days: 366, limit: CEILING_EVENTS }, pattern: /snapshot\.days.*366.*between 1 and 365/ },
    { window: { days: WINDOW_DAYS, limit: 49 }, pattern: /snapshot\.limit.*49.*between 50 and 500/ },
    { window: { days: WINDOW_DAYS, limit: 501 }, pattern: /snapshot\.limit.*501.*between 50 and 500/ },
    { window: { days: 30.5, limit: CEILING_EVENTS }, pattern: /snapshot\.days.*30\.5/ },
    { window: { days: '30', limit: CEILING_EVENTS }, pattern: /snapshot\.days.*"30"/ },
    { window: { days: WINDOW_DAYS }, pattern: /snapshot\.limit.*undefined/ },
  ]
  for (const entry of cases) {
    const dir = initRepo(t, { config: configWithWindow(entry.window) })
    // The remedy the message names is the onboard, since the value it complains about is the
    // config's and not the caller's.
    assertRefused(dir, {}, entry.pattern, `configured ${JSON.stringify(entry.window)}`)
    assertRefused(dir, {}, /[Rr]e-run the major-tom onboard/, `configured ${JSON.stringify(entry.window)} remedy`)
  }

  // The CLI, which passes no override at all, fails on the same condition and exits non-zero.
  const dir = initRepo(t, { config: configWithWindow({ days: 0, limit: CEILING_EVENTS }) })
  const result = runSnapshotExpectingFailure(t, dir)
  assertFailedClosed(result)
  assert.match(result.stderr, /snapshot\.days/)
})

test('window: an override moves git and timeline together, both for days and for limit', (t) => {
  // Both streams carry the same distribution: 60 entries in the last hour and 20 more spread
  // from 3 to 22 days back, so 80 in total and all of them inside the configured 30-day
  // default. 60 is above the floor of 50, which is what lets a narrower horizon actually bite:
  // below the floor the window would extend back to the 50 newest and hide the effect.
  const RECENT = 60
  const OLDER = 20
  const recentAt = (i) => new Date(NOW - i * MINUTE)
  const olderAt = (j) => new Date(NOW - (2 + j) * DAY)

  const bulkCommits = []
  for (let j = OLDER; j >= 1; j--) bulkCommits.push({ message: `chore: older ${j}`, date: olderAt(j) })
  for (let i = RECENT; i >= 1; i--) bulkCommits.push({ message: `chore: recent ${i}`, date: recentAt(i) })

  const intentsLog = []
  for (let j = 1; j <= OLDER; j++) {
    intentsLog.push(logLine({ at: olderAt(j), promptId: `p-older-${j}`, summary: `older ${j}` }))
  }
  for (let i = 1; i <= RECENT; i++) {
    intentsLog.push(logLine({ at: recentAt(i), promptId: `p-recent-${i}`, summary: `recent ${i}` }))
  }

  const dir = initRepo(t, { bulkCommits, intentsLog })

  // At the configured default both streams carry everything.
  const wide = buildWith(dir)
  assert.equal(wide.git.length, RECENT + OLDER)
  assert.equal(wide.timeline.events.length, RECENT + OLDER)

  // A narrower horizon drops the same 20 entries from both, and drops them in step: neither
  // stream keeps anything the other lost, which is the ragged reading D42 exists to prevent.
  const narrowDays = buildWith(dir, { days: 2 })
  assert.equal(narrowDays.git.length, RECENT, 'the git stream must follow the days parameter')
  assert.equal(narrowDays.timeline.events.length, RECENT, 'the timeline must follow the days parameter')
  assert.equal(narrowDays.git[0].subject, 'chore: recent 1')
  assert.equal(narrowDays.git[RECENT - 1].subject, `chore: recent ${RECENT}`)
  assert.equal(narrowDays.timeline.events[0].summary, 'recent 1')
  assert.equal(narrowDays.timeline.events[RECENT - 1].summary, `recent ${RECENT}`)
  const cutoff = NOW - 2 * DAY
  for (const entry of narrowDays.git) assert.ok(new Date(entry.date).getTime() >= cutoff, entry.subject)
  for (const event of narrowDays.timeline.events) assert.ok(new Date(event.at).getTime() >= cutoff, event.summary)
  assert.equal(narrowDays.timeline.omitted.count, OLDER)
  assert.equal(narrowDays.timeline.omitted.reason, 'days')

  // A narrower ceiling cuts both streams to the same length, at the same point in time.
  const narrowLimit = buildWith(dir, { limit: 50 })
  assert.equal(narrowLimit.git.length, 50, 'the git stream must follow the limit parameter')
  assert.equal(narrowLimit.timeline.events.length, 50, 'the timeline must follow the limit parameter')
  assert.equal(narrowLimit.git[49].subject, 'chore: recent 50')
  assert.equal(narrowLimit.timeline.events[49].summary, 'recent 50')
  assert.equal(narrowLimit.timeline.omitted.count, RECENT + OLDER - 50)
  assert.equal(narrowLimit.timeline.omitted.reason, 'ceiling')

  // The same holds when the default is the narrow one and no override is passed at all: the
  // parameter and the configured default are one window, not two mechanisms.
  const configured = initRepo(t, { bulkCommits, intentsLog, config: configWithWindow({ days: 2, limit: 500 }) })
  const fromConfig = buildWith(configured)
  assert.equal(fromConfig.git.length, RECENT)
  assert.equal(fromConfig.timeline.events.length, RECENT)
})

test('window: timeline.window reports the effective values, not the configured ones', (t) => {
  const dir = initRepo(t, { config: configWithWindow({ days: 30, limit: 500 }) })
  const snapshot = buildWith(dir, { days: 3, limit: 77 })
  // The page states the window it is actually showing, so the override has to be what is
  // reported; deepEqual on the whole object, so a fourth member would fail here too.
  assert.deepEqual(snapshot.timeline.window, { days: 3, floorEvents: FLOOR_EVENTS, ceilingEvents: 77 })
  assert.deepEqual(snapshot.config.snapshot, { days: 30, limit: 500 }, 'the config travels unchanged')
})

// ---------------------------------------------------------------------------
// Fail closed
// ---------------------------------------------------------------------------

test('fail closed: a missing .claude/major-tom.json', (t) => {
  const dir = initRepo(t, { noConfig: true })
  assertFailedClosed(runSnapshotExpectingFailure(t, dir))
})

test('fail closed: a config that does not parse', (t) => {
  const dir = initRepo(t, { rawConfig: '{ "schemaVersion": 1, this is not json }\n' })
  assertFailedClosed(runSnapshotExpectingFailure(t, dir))
})

test('fail closed: a config with no snapshot block', (t) => {
  // Owner-decided (D45 point 3): the default lives in the config so the script carries none,
  // and a project onboarded before the block existed is refused rather than served at some
  // improvised window. The message says what is missing and that the onboard writes it.
  const config = defaultConfig()
  delete config.snapshot
  const dir = initRepo(t, { config })

  const result = runSnapshotExpectingFailure(t, dir)
  assertFailedClosed(result)
  assert.match(result.stderr, /snapshot block/)
  assert.match(result.stderr, /[Rr]e-run the major-tom onboard/)

  const { buildSnapshot, SnapshotError } = require(SCRIPT)
  assert.throws(
    () => buildSnapshot({ repoRoot: dir }),
    (err) => err instanceof SnapshotError && /snapshot block/.test(err.message)
  )
  // An override does not stand in for the missing block either: the config is what has to
  // carry the default, and a request that happens to name both values is still refused.
  assert.throws(
    () => buildSnapshot({ repoRoot: dir, days: 7, limit: 100 }),
    (err) => err instanceof SnapshotError && /snapshot block/.test(err.message)
  )

  // A block of the wrong shape is the same condition and not a different one.
  for (const value of [null, 'thirty', 30, []]) {
    const wrong = defaultConfig()
    wrong.snapshot = value
    const wrongDir = initRepo(t, { config: wrong })
    assert.throws(
      () => buildSnapshot({ repoRoot: wrongDir }),
      (err) => err instanceof SnapshotError && /snapshot block/.test(err.message),
      `snapshot: ${JSON.stringify(value)} must be refused`
    )
  }

  // The body reader takes no window and reads none, so it still answers here: a body is a
  // body, and only the windowed listing depends on the block.
  const sound = initRepo(t, { knowledge: { 'docs/alpha.md': concept('type: doc\ntitle: Alpha', 'alpha body') } })
  const id = fileByPath(runSnapshot(t, sound), 'docs/alpha.md').id
  const { readConceptBody } = require(SCRIPT)
  fs.writeFileSync(
    path.join(dir, KNOWLEDGE_ROOT, 'docs', 'alpha.md'),
    concept('type: doc\ntitle: Alpha', 'alpha body')
  )
  assert.equal(readConceptBody({ repoRoot: dir, id }), '\nalpha body\n')
})

test('fail closed: a persistence root that does not exist', (t) => {
  const dir = initRepo(t, { noRoot: true })
  assert.equal(fs.existsSync(path.join(dir, KNOWLEDGE_ROOT)), false)
  assertFailedClosed(runSnapshotExpectingFailure(t, dir))
})
