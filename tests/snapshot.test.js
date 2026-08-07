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

// The window constants the spec names literally.
const WINDOW_DAYS = 30
const FLOOR_EVENTS = 50
const CEILING_EVENTS = 500
const BYTE_BUDGET = 262144
const BODY_CAP = 32768
const BODY_TOTAL_CAP = 1048576
const SUMMARY_CAP = 200

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

test('knowledge: a concept carries path, type, frontmatter, body and updated', (t) => {
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
  assert.ok(alpha.body.includes('a short body'))
  assert.ok(!alpha.truncated)
  assert.equal(new Date(alpha.updated).getTime(), updated.getTime())

  // path is relative to the persistence root, with forward slashes, at any depth.
  const nested = fileByPath(snapshot, 'memories/deep/nested.md')
  assert.equal(nested.type, 'memory')
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

test('knowledge: a body over 32768 bytes is cut and flagged truncated', (t) => {
  // conceptExact so the body on disk is exactly these bytes: no blank line, no trailing
  // newline, no line break anywhere near the cut.
  const dir = initRepo(t, {
    knowledge: { 'docs/long.md': conceptExact('type: doc\ntitle: Long', 'x'.repeat(40000)) },
  })
  const snapshot = runSnapshot(t, dir)

  const long = fileByPath(snapshot, 'docs/long.md')
  assert.equal(long.truncated, true)
  assert.equal(Buffer.byteLength(long.body), BODY_CAP)
  assert.match(long.body, /^x+$/)
})

test('knowledge: a body under the per-file cap is embedded whole and not flagged', (t) => {
  const body = 'y'.repeat(1000)
  const dir = initRepo(t, {
    knowledge: { 'docs/short.md': conceptExact('type: doc\ntitle: Short', body) },
  })
  const snapshot = runSnapshot(t, dir)

  const short = fileByPath(snapshot, 'docs/short.md')
  assert.equal(short.body, body)
  assert.ok(!short.truncated)
})

test('knowledge: body embedding stops when the 1048576-byte total is reached', (t) => {
  // Forty files, each with a body of 40000 bytes, so each embedded body is the per-file cap
  // of 32768. 1048576 / 32768 is exactly 32, so the thirty-third file is the first without
  // a body: after 32 bodies the running total is no longer under the 1 MB budget.
  const knowledge = {}
  const order = []
  for (let i = 0; i < 40; i++) {
    const rel = `docs/f${String(i).padStart(2, '0')}.md`
    order.push(rel)
    knowledge[rel] = conceptExact(`type: doc\ntitle: File ${i}`, 'x'.repeat(40000))
  }
  const dir = initRepo(t, { knowledge, index: order })
  const snapshot = runSnapshot(t, dir)

  assert.deepEqual(snapshot.knowledge.files.map((f) => f.path), order)

  const hasBody = snapshot.knowledge.files.map((f) => typeof f.body === 'string')
  const firstWithout = hasBody.indexOf(false)
  assert.ok(firstWithout > 0, 'the first files must keep their bodies')
  assert.equal(hasBody.slice(firstWithout).includes(true), false, 'embedding must stop, never resume')
  assert.equal(firstWithout, BODY_TOTAL_CAP / BODY_CAP)

  for (const file of snapshot.knowledge.files.slice(0, firstWithout)) {
    assert.equal(Buffer.byteLength(file.body), BODY_CAP)
    assert.equal(file.truncated, true)
  }
  for (const file of snapshot.knowledge.files.slice(firstWithout)) {
    assert.equal('body' in file, false, `${file.path} must carry no body at all`)
  }
})

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

test('timeline: window always carries the four literal limits', (t) => {
  const dir = initRepo(t, {})
  const snapshot = runSnapshot(t, dir)
  assert.deepEqual(snapshot.timeline.window, {
    days: WINDOW_DAYS,
    floorEvents: FLOOR_EVENTS,
    ceilingEvents: CEILING_EVENTS,
    byteBudget: BYTE_BUDGET,
  })
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
  // 505 events, all inside the horizon, all small enough that the byte budget never bites.
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

test('timeline: omitted.reason is bytes when only the byte budget bites', (t) => {
  // Sixty events, all inside the horizon, so neither the horizon nor the ceiling bites and
  // the floor has nothing to extend. Each carries a very long promptId, since the summary
  // is capped at 200 characters and 500 ordinary events never reach 262144 bytes: with the
  // ceiling at 500 the budget can only be reached by wide events.
  const wideId = 'p-' + 'i'.repeat(5000)
  const lines = []
  for (let i = 1; i <= 60; i++) {
    lines.push(logLine({ at: insideHorizon(i), promptId: `${wideId}-${i}`, summary: `wide event ${i}` }))
  }
  const dir = initRepo(t, { intentsLog: lines })
  const snapshot = runSnapshot(t, dir)

  const events = snapshot.timeline.events
  assert.ok(events.length > 0, 'the budget must not empty the list')
  assert.ok(events.length < 60, 'the budget must drop something')
  assert.ok(
    Buffer.byteLength(JSON.stringify(events)) <= BYTE_BUDGET,
    `the serialized events must fit ${BYTE_BUDGET} bytes`
  )
  assert.equal(snapshot.timeline.omitted.reason, 'bytes')
  assert.equal(snapshot.timeline.omitted.count, 60 - events.length)
  // Dropping happens at the oldest end, so the newest event always survives.
  assert.equal(events[0].summary, 'wide event 1')
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

test('fail closed: a persistence root that does not exist', (t) => {
  const dir = initRepo(t, { noRoot: true })
  assert.equal(fs.existsSync(path.join(dir, KNOWLEDGE_ROOT)), false)
  assertFailedClosed(runSnapshotExpectingFailure(t, dir))
})
