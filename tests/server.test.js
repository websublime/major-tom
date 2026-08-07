#!/usr/bin/env node
// Scenario suite for plugins/major-tom/app/server.js (D43 PR2).
//
// Run with: node tests/server.test.js
//
// Node built-ins only: node:test and node:assert/strict, no runner to install, no
// dependencies. The suite is written against the specification (D43 points 1, 2, 5 and 8,
// as the server's own header states them), never against the implementation.
//
// The server under test is started as a real child process on a real socket, because the
// three properties it exists to hold are properties of a running process answering
// requests: that no request string ever reaches the filesystem, that nothing is cached,
// and that no request can end the process. None of that can be observed by requiring the
// file, which starts listening at load and exits on a bad argument.
//
// Every fixture is a throwaway git repository under os.tmpdir(), built by initRepo, which
// is the fixture builder of tests/snapshot.test.js reduced to what a served repository
// needs. These are standalone files with no shared module, so it is copied rather than
// imported. Nothing is ever written inside this repository.
//
// Ports are never fixed: a developer may well have a dashboard running on 4242 while the
// suite runs. Every server gets a port that was free a moment earlier, obtained by binding
// a probe socket to port 0 and closing it, and a start that loses the race to another
// process is retried rather than reported as a failure.
//
// Port 0 can now be passed to the server directly, and the ephemeral-port test below does
// exactly that. It could not before: the resolution was written as
// Number(argv[3]) || Number(PORT) || 4242, so a zero port was falsy and fell through to
// 4242, and so did an unparseable one. That fallback was a defect and it is gone; a port
// this file passes is either honoured or refused, never quietly replaced. The startup line
// is read back from the bound socket, so the tests here assert the announced port against
// what was bound rather than against what was asked for.
//
// Every child is registered before it is awaited, killed by a t.after that runs whether
// the test passed or failed, and killed again by a process-level exit handler, so no path
// through this file can leave a node process holding a port.

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { execFileSync, spawn } = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const http = require('node:http')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')

const REPO_ROOT = path.resolve(__dirname, '..')
const APP = path.join(REPO_ROOT, 'plugins', 'major-tom', 'app')
const SERVER = path.join(APP, 'server.js')
const PAGE = path.join(APP, 'dashboard.html')

// The persistence root every fixture uses; the config schema fixes it to .knowledge.
const KNOWLEDGE_ROOT = '.knowledge'
const IDENTITY_NAME = 'Fixture Author'
const IDENTITY_EMAIL = 'fixture@example.test'

// The window constants the spec names literally, asserted on the served payload.
const WINDOW_DAYS = 30
const FLOOR_EVENTS = 50
const CEILING_EVENTS = 500

// How long a start or a request may take before the test fails instead of hanging the
// suite. Generous, because it is a failure deadline and not a performance budget.
const START_TIMEOUT_MS = 20000
const REQUEST_TIMEOUT_MS = 20000

// The line server.js prints from its listen callback. Waiting for it is what makes a
// request race-free: the socket is accepting by the time the line exists.
//
// The host in this pattern is the literal 127.0.0.1 and not localhost, which is what the
// line used to say while binding 127.0.0.1. That was a defect and this pattern is the check
// on it: the announced address is the address bound, read back from the socket, because it
// is the string a user copies into a browser and localhost resolves to ::1 first on plenty
// of hosts, where nothing at all is listening.
const LISTENING_RE = /major-tom dashboard on http:\/\/127\.0\.0\.1:(\d+)/

// ---------------------------------------------------------------------------
// Child processes
// ---------------------------------------------------------------------------

// Every live child, so the exit handler below can reach one that a crashing test never
// got to clean up. Kept in sync by spawnServer and stopServer.
const liveChildren = new Set()

process.on('exit', () => {
  for (const child of liveChildren) {
    try {
      child.kill('SIGKILL')
    } catch (e) {
      // Nothing to do at exit; the process is leaving either way.
    }
  }
  liveChildren.clear()
})

function stopServer(child) {
  liveChildren.delete(child)
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise((resolve) => {
    child.once('close', resolve)
    // SIGKILL rather than SIGTERM: cleanup must not depend on the child choosing to
    // honour a signal, and there is nothing for it to flush.
    child.kill('SIGKILL')
  })
}

// PORT is removed from the child environment so a developer who exports it cannot change
// what the suite binds; every start below passes its port explicitly anyway. The overrides
// argument is how the two tests that are about the PORT variable put one back, and it is the
// only way one reaches a child: nothing here inherits the developer's.
function childEnv(overrides) {
  const env = Object.assign({}, process.env)
  delete env.PORT
  return Object.assign(env, overrides || {})
}

// server is the path to the server.js under test. It is a parameter rather than the constant
// because one test runs a copy of the server from a directory that deliberately lacks the
// built page, which cannot be arranged in place: the real dashboard.html belongs to the
// client tree and this suite never moves it.
function spawnServerAt(t, server, args, env) {
  const child = spawn(process.execPath, [server].concat(args), {
    cwd: REPO_ROOT,
    env: childEnv(env),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  // Registered before anything is awaited, so a rejection between here and the first
  // assertion still reaches the cleanup.
  liveChildren.add(child)
  t.after(() => stopServer(child))

  const out = { stdout: '', stderr: '' }
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    out.stdout += chunk
  })
  child.stderr.on('data', (chunk) => {
    out.stderr += chunk
  })
  return { child, out }
}

// The ordinary case: the real server.js beside the real built page.
function spawnServer(t, args, env) {
  return spawnServerAt(t, SERVER, args, env)
}

// The port the child announced, which is the port it bound and not the port it was asked
// for. The two differ by design when the request was 0.
function announcedPort(out) {
  const match = LISTENING_RE.exec(out.stdout)
  assert.ok(match, `the server must announce the address it bound, got ${JSON.stringify(out.stdout)}`)
  return Number(match[1])
}

// A port that was free a moment ago: bind a probe to 0, read what the kernel chose, close
// it. There is a window between the close and the child's bind, which is why startServer
// retries an EADDRINUSE rather than failing on it.
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.on('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const chosen = probe.address().port
      probe.close((err) => (err ? reject(err) : resolve(chosen)))
    })
  })
}

// Resolves once the child says it is listening, or once it exits, or once the deadline
// passes. It never rejects: the caller decides what each outcome means.
function waitForListening(child, out) {
  return new Promise((resolve) => {
    let settled = false
    const finish = (outcome) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.stdout.removeListener('data', onData)
      child.removeListener('exit', onExit)
      resolve(outcome)
    }
    const onData = () => {
      if (LISTENING_RE.test(out.stdout)) finish({ listening: true })
    }
    const onExit = (code, signal) => finish({ listening: false, reason: `exited with code ${code} signal ${signal}` })
    const timer = setTimeout(() => finish({ listening: false, reason: `did not listen within ${START_TIMEOUT_MS} ms` }), START_TIMEOUT_MS)

    child.stdout.on('data', onData)
    child.on('exit', onExit)
    // The line may already be buffered by the time the listeners are attached.
    onData()
  })
}

// Starts the real server against repoDir and returns once it is answering. Three attempts,
// because the only expected failure here is another process taking the probed port in
// between; anything else fails the test with the child's stderr, which is where server.js
// says why it left.
async function startServer(t, repoDir) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const port = await freePort()
    const { child, out } = spawnServer(t, [repoDir, String(port)])
    const outcome = await waitForListening(child, out)
    if (outcome.listening) {
      assert.match(out.stdout, LISTENING_RE)
      assert.equal(announcedPort(out), port, 'the server must listen on the port it was given')
      return { port, child, out }
    }
    await stopServer(child)
    const lost = out.stderr.includes('already in use')
    if (!lost || attempt === 3) {
      assert.fail(`server.js ${outcome.reason}: ${out.stderr.trim() || '(no stderr)'}`)
    }
  }
  throw new Error('unreachable')
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

// The request target is passed through verbatim: the point of several tests below is what
// the server does with a target it would be wrong to normalize, so nothing here may
// normalize it either. agent:false and Connection: close keep no socket alive after the
// response, so a killed child leaves nothing behind in this process.
function request(port, target, options) {
  const opts = options || {}
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        method: opts.method || 'GET',
        path: target,
        agent: false,
        headers: { Connection: 'close' },
      },
      (res) => {
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }))
        res.on('error', reject)
      }
    )
    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error(`${opts.method || 'GET'} ${target} timed out`)))
    req.on('error', reject)
    req.end()
  })
}

async function getJson(port, target) {
  const res = await request(port, target)
  assert.match(String(res.headers['content-type']), /^application\/json/, `${target} must answer JSON`)
  let value
  try {
    value = JSON.parse(res.body)
  } catch (e) {
    assert.fail(`${target} answered ${res.status} with a body that is not JSON: ${JSON.stringify(res.body.slice(0, 200))}`)
  }
  return { status: res.status, headers: res.headers, value }
}

// The one error shape, asserted the same way wherever an error can come from. Every non-2xx
// response this server produces is JSON carrying exactly {error: "<something>"}, so a client
// may parse any failure without first inspecting the status or the content type. The unknown
// route and every 405 used to answer text/plain, which is a trap for exactly the client that
// trusts an API to answer JSON; that was the defect and this helper is the check on it.
function assertErrorShape(res, label) {
  assert.match(String(res.headers['content-type']), /^application\/json/, `${label} must answer JSON`)
  let value
  try {
    value = JSON.parse(res.body)
  } catch (e) {
    assert.fail(`${label} answered ${res.status} with a body that is not JSON: ${JSON.stringify(res.body.slice(0, 200))}`)
  }
  assert.deepEqual(Object.keys(value), ['error'], `${label} must carry the error key and nothing else`)
  assert.equal(typeof value.error, 'string', `${label} must carry a string error`)
  assert.ok(value.error.length > 0, `${label} must say something in its error`)
  return value
}

// A 404 from the body route is a refusal the page has to be able to read, so it carries the
// JSON error shape and never an empty response.
async function assertBodyRouteRefuses(port, target, label) {
  const res = await getJson(port, target)
  assert.equal(res.status, 404, `${label} must be a 404`)
  assert.equal(typeof res.value.error, 'string', `${label} must answer a JSON error object`)
  assert.ok(res.value.error.length > 0, `${label} must say something in its error`)
  assert.equal('body' in res.value, false, `${label} must not carry a body`)
}

// After a fail-closed exit there must be nothing on the port at all.
function assertNotListening(port) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: '127.0.0.1', port })
    socket.setTimeout(5000)
    socket.on('connect', () => {
      socket.destroy()
      reject(new Error(`something is listening on port ${port}`))
    })
    socket.on('timeout', () => {
      socket.destroy()
      reject(new Error(`connecting to port ${port} timed out`))
    })
    socket.on('error', () => resolve())
  })
}

// ---------------------------------------------------------------------------
// Fixture helpers, the reduced form of the ones in tests/snapshot.test.js
// ---------------------------------------------------------------------------

function tmpDir(t, prefix) {
  // realpath so the fixture path has no symlink component (on macOS /tmp is a symlink).
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
      description: 'A throwaway repository built by the server suite.',
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
// fence and no trailing newline.
function conceptExact(frontmatter, body) {
  return `---\n${frontmatter.trim()}\n---\n${body}`
}

// The bundle index. Reserved: it is never itself an entry, it only fixes the order the
// knowledge walk starts with.
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

// Builds a fixture repository.
//
//   noConfig    do not write .claude/major-tom.json at all
//   noGit       do not initialize a git repository
//   index       the relative paths listed in index.md, in order
//   knowledge   map of persistence-root-relative path to file contents
//   intentsLog  array of runs/intents.log lines
//   commits     commits created one git process at a time, oldest first
function initRepo(t, options) {
  const opts = options || {}
  const dir = tmpDir(t, 'major-tom-server-')

  if (!opts.noGit) {
    git(dir, ['init', '--quiet'])
    git(dir, ['symbolic-ref', 'HEAD', 'refs/heads/main'])
    git(dir, ['config', 'user.name', IDENTITY_NAME])
    git(dir, ['config', 'user.email', IDENTITY_EMAIL])
    git(dir, ['config', 'commit.gpgsign', 'false'])
  }

  if (!opts.noConfig) {
    writeFileAt(path.join(dir, '.claude', 'major-tom.json'), JSON.stringify(defaultConfig(), null, 2) + '\n')
  }

  for (const area of ['memories', 'docs', 'runs', 'monitors', 'logs']) {
    fs.mkdirSync(path.join(dir, KNOWLEDGE_ROOT, area), { recursive: true })
    fs.writeFileSync(path.join(dir, KNOWLEDGE_ROOT, area, '.gitkeep'), '')
  }
  fs.writeFileSync(path.join(dir, KNOWLEDGE_ROOT, 'index.md'), indexDoc(opts.index || []))
  for (const [rel, contents] of Object.entries(opts.knowledge || {})) {
    writeFileAt(path.join(dir, KNOWLEDGE_ROOT, rel), contents)
  }
  if (opts.intentsLog) {
    fs.writeFileSync(path.join(dir, KNOWLEDGE_ROOT, 'runs', 'intents.log'), opts.intentsLog.join('\n') + '\n')
  }

  for (const entry of opts.commits || []) commit(dir, entry)

  return dir
}

// One commit, one git process, with the date pinned on both sides so nothing here is read
// from the clock.
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

// A fixture date inside the 30-day horizon, floored to a whole second because git stores
// commit timestamps at second precision.
const NOW = Math.floor(Date.now() / 1000) * 1000
function insideHorizon(hours) {
  assert.ok(hours * 3600000 < 29 * 86400000, 'fixture date must sit inside the 30-day horizon')
  return new Date(NOW - hours * 3600000)
}

// The body of a fixture file as the file itself holds it: everything after the line that
// closes the frontmatter, read here rather than reconstructed from what was written.
function bodyOnDisk(dir, rel) {
  const lines = fs.readFileSync(path.join(dir, KNOWLEDGE_ROOT, rel), 'utf8').split('\n')
  const end = lines.indexOf('---', 1)
  assert.notEqual(end, -1, `${rel} must have a closing frontmatter fence`)
  return lines.slice(end + 1).join('\n')
}

function fileByPath(snapshot, rel) {
  const found = snapshot.knowledge.files.find((f) => f.path === rel)
  assert.ok(found, `expected a knowledge entry for ${rel}, got ${JSON.stringify(snapshot.knowledge.files.map((f) => f.path))}`)
  return found
}

// The id of a persistence-root-relative path, computed the way the spec states it: a prefix
// of the hex SHA-256 of the path. The prefix length is read from an id the snapshot actually
// minted, so this helper never fixes a length the schema does not fix.
function idOfPath(rel, sampleId) {
  return crypto.createHash('sha256').update(rel, 'utf8').digest('hex').slice(0, sampleId.length)
}

// A fixture with one concept of every shape the routes below need.
function servedRepo(t) {
  return initRepo(t, {
    index: ['docs/alpha.md'],
    knowledge: {
      'docs/alpha.md': conceptExact('type: doc\ntitle: Alpha', '# Alpha\n\nthe alpha body\n'),
      'memories/deep/nested.md': conceptExact('type: memory\ntitle: Nested', 'the nested body'),
      'docs/d1.md': concept('type: decision\nid: D1\ntitle: A decision\nstatus: open', 'why'),
    },
    intentsLog: [logLine({ at: insideHorizon(2), promptId: 'p-log', summary: 'a logged intent' })],
    commits: [{ message: 'feat: first', date: insideHorizon(8), files: { 'a.txt': 'one\n' } }],
  })
}

// ---------------------------------------------------------------------------
// Routing and method
// ---------------------------------------------------------------------------

test('routing: GET / serves the built page as HTML', async (t) => {
  const dir = servedRepo(t)
  const { port } = await startServer(t, dir)

  // The page is read from disk on every request, so a rebuild landing between these two
  // reads is a legitimate outcome and not a failure: the served bytes must be one of the two
  // versions this test saw, and never anything else.
  const before = fs.readFileSync(PAGE, 'utf8')
  const res = await request(port, '/')
  const after = fs.readFileSync(PAGE, 'utf8')

  assert.equal(res.status, 200)
  assert.match(String(res.headers['content-type']), /^text\/html/)
  assert.ok(res.body.startsWith('<!doctype html>'), `the page must start with the doctype, got ${JSON.stringify(res.body.slice(0, 40))}`)
  // The page is the built file sitting beside the server and nothing else.
  assert.ok(res.body === before || res.body === after, 'the served page must be the built dashboard.html beside the server')
})

test('routing: GET /api/snapshot answers JSON', async (t) => {
  const dir = servedRepo(t)
  const { port } = await startServer(t, dir)

  const res = await request(port, '/api/snapshot')
  assert.equal(res.status, 200)
  assert.match(String(res.headers['content-type']), /^application\/json/)
  const snapshot = JSON.parse(res.body)
  // It is the snapshot of the repository that was served, not of the one the server lives in.
  assert.equal(snapshot.config.project.name, 'fixture-project')
  assert.equal(fileByPath(snapshot, 'docs/alpha.md').type, 'doc')
})

test('routing: an unknown route is a 404', async (t) => {
  const dir = servedRepo(t)
  const { port } = await startServer(t, dir)

  for (const target of ['/nope', '/api', '/api/', '/api/snapshot.json', '/index.html', '/dashboard.html', '/api/knowledge']) {
    const res = await request(port, target)
    assert.equal(res.status, 404, `${target} must be a 404`)
  }
})

test('method: anything other than GET is a 405, on a route that exists', async (t) => {
  const dir = servedRepo(t)
  const { port } = await startServer(t, dir)

  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    for (const target of ['/', '/api/snapshot', '/api/knowledge/body?id=x']) {
      const res = await request(port, target, { method })
      assert.equal(res.status, 405, `${method} ${target} must be a 405`)
    }
  }
})

// HEAD is a 405 like any other non-GET method. That is a deviation from the HTTP norm, under
// which a server that answers GET on a target answers HEAD on it too, and it is recorded here
// and in the server's header comment so that it is a documented choice rather than an
// accident: nothing in the client issues a HEAD, and answering one would mean a second
// response path whose only work is to build a body and throw it away. This test is not a
// request to change the behaviour; it is what would notice the behaviour changing.
test('method: HEAD is a 405 too, which is a documented deviation from the HTTP norm', async (t) => {
  const dir = servedRepo(t)
  const { port } = await startServer(t, dir)

  for (const target of ['/', '/api/snapshot', '/api/knowledge/body?id=x']) {
    const res = await request(port, target, { method: 'HEAD' })
    assert.equal(res.status, 405, `HEAD ${target} must be a 405`)
    // The status line and the headers are the whole answer: a HEAD response never carries a
    // body, so the JSON error shape is declared by the content type and written by nobody.
    assert.match(String(res.headers['content-type']), /^application\/json/, `HEAD ${target} must declare JSON`)
    assert.equal(res.body, '', `HEAD ${target} must carry no body`)
  }
})

// One shape for every failure. The two 500s aside, all of these are answers the server chooses
// rather than errors it suffers, and a client reads them all the same way.
test('errors: every error answer is JSON carrying exactly {error}', async (t) => {
  const dir = servedRepo(t)
  const { port } = await startServer(t, dir)

  // 404, unknown route: this one used to be text/plain.
  for (const target of ['/nope', '/api', '/api/snapshot.json', '/dashboard.html', '//evil/api/snapshot']) {
    const res = await request(port, target)
    assert.equal(res.status, 404, `${target} must be a 404`)
    assertErrorShape(res, `404 for ${target}`)
  }

  // 405, every method on every route: these used to be text/plain as well.
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
    for (const target of ['/', '/api/snapshot', '/api/knowledge/body?id=x', '/nope']) {
      const res = await request(port, target, { method })
      assert.equal(res.status, 405, `${method} ${target} must be a 405`)
      assertErrorShape(res, `405 for ${method} ${target}`)
    }
  }

  // 404, the body route: already JSON, and it must stay the same shape as the rest.
  assertErrorShape(await request(port, '/api/knowledge/body?id=nothing-carries-this'), 'the body route 404')

  // 500, a repository the server cannot read: the same shape again, carrying the message that
  // names what is wrong.
  const brokenDir = initRepo(t, { noConfig: true })
  const broken = await startServer(t, brokenDir)
  for (const target of ['/api/snapshot', '/api/knowledge/body?id=x', '/api/knowledge/body']) {
    const res = await request(broken.port, target)
    assert.equal(res.status, 500, `${target} must be a 500 on a repository with no config`)
    const value = assertErrorShape(res, `500 for ${target}`)
    assert.match(value.error, /major-tom\.json/)
  }
})

// These two targets are the reason server.js routes by literal string comparison instead of
// parsing the request target with the WHATWG URL constructor. URL needs a base, and parsing
// against one rewrites the target before any comparison happens: "//evil/api/snapshot" reads
// as protocol-relative and yields the pathname "/api/snapshot", and "/api/snapshot/../../etc"
// has its ".." segments collapsed to "/etc". Both would then be routed as targets this server
// never declared. Do not "improve" the routing into a URL parse: it would reintroduce exactly
// this, and this test is what would catch it.
test('routing: a target that only a URL parse would rewrite is a 404', async (t) => {
  const dir = servedRepo(t)
  const { port } = await startServer(t, dir)

  for (const target of [
    '//evil/api/snapshot',
    '/api/snapshot/../../etc',
    '//evil/',
    '/api/knowledge/body/../body?id=x',
    '/../api/snapshot',
  ]) {
    const res = await request(port, target)
    assert.equal(res.status, 404, `${target} must be a 404`)
  }
})

// ---------------------------------------------------------------------------
// The snapshot payload
// ---------------------------------------------------------------------------

test('payload: the served snapshot carries the six keys and neither lastRun nor roadmap', async (t) => {
  const dir = servedRepo(t)
  const { port } = await startServer(t, dir)

  const res = await getJson(port, '/api/snapshot')
  assert.equal(res.status, 200)
  assert.deepEqual(Object.keys(res.value).sort(), ['config', 'decisions', 'generatedAt', 'git', 'knowledge', 'timeline'])
  assert.equal('lastRun' in res.value, false)
  assert.equal('roadmap' in res.value, false)
  assert.equal(new Date(res.value.generatedAt).toISOString(), res.value.generatedAt)
})

test('payload: every knowledge entry carries an id and no body', async (t) => {
  const dir = initRepo(t, {
    knowledge: {
      'docs/short.md': conceptExact('type: doc\ntitle: Short', 'y'.repeat(10)),
      'docs/long.md': conceptExact('type: doc\ntitle: Long', 'x'.repeat(200000)),
    },
  })
  const { port } = await startServer(t, dir)

  const res = await getJson(port, '/api/snapshot')
  assert.equal(res.status, 200)
  assert.equal(res.value.knowledge.files.length, 2)
  const ids = []
  for (const file of res.value.knowledge.files) {
    assert.equal(typeof file.id, 'string', `${file.path} must carry an id`)
    assert.match(file.id, /^[0-9a-f]+$/, `${file.path} must carry a hex id`)
    // Bodies left the listing with the caps (D43 point 4), and nothing is cut, so nothing is
    // flagged as cut either.
    assert.equal('body' in file, false, `${file.path} must carry no body at all`)
    assert.equal('truncated' in file, false, `${file.path} must carry no truncated key at all`)
    ids.push(file.id)
  }
  assert.equal(new Set(ids).size, ids.length, 'ids must be unique across the bundle')
})

test('payload: timeline.window carries the three limits and no byte budget', async (t) => {
  const dir = servedRepo(t)
  const { port } = await startServer(t, dir)

  const res = await getJson(port, '/api/snapshot')
  // deepEqual on the whole object, so a fourth member fails here: the byte budget left the
  // schema with D43 point 4 and nothing replaced it.
  assert.deepEqual(res.value.timeline.window, {
    days: WINDOW_DAYS,
    floorEvents: FLOOR_EVENTS,
    ceilingEvents: CEILING_EVENTS,
  })
  assert.equal('byteBudget' in res.value.timeline.window, false)
})

// ---------------------------------------------------------------------------
// The body endpoint
// ---------------------------------------------------------------------------

test('body: a minted id returns that file body, byte for byte', async (t) => {
  const dir = servedRepo(t)
  const { port } = await startServer(t, dir)

  const snapshot = (await getJson(port, '/api/snapshot')).value
  for (const rel of ['docs/alpha.md', 'memories/deep/nested.md', 'docs/d1.md']) {
    const id = fileByPath(snapshot, rel).id
    const res = await getJson(port, `/api/knowledge/body?id=${id}`)
    assert.equal(res.status, 200, `the body of ${rel} must be served`)
    assert.deepEqual(Object.keys(res.value).sort(), ['body', 'id'])
    assert.equal(res.value.id, id)
    assert.equal(res.value.body, bodyOnDisk(dir, rel), `the body of ${rel} must match the file on disk`)
  }

  // Each id addresses its own file and not another one.
  assert.equal((await getJson(port, `/api/knowledge/body?id=${fileByPath(snapshot, 'docs/alpha.md').id}`)).value.body, '# Alpha\n\nthe alpha body\n')
  assert.equal((await getJson(port, `/api/knowledge/body?id=${fileByPath(snapshot, 'memories/deep/nested.md').id}`)).value.body, 'the nested body')
})

test('body: an absent, empty or unknown id is a 404 carrying the JSON error shape', async (t) => {
  const dir = servedRepo(t)
  const { port } = await startServer(t, dir)

  const snapshot = (await getJson(port, '/api/snapshot')).value
  const sampleId = fileByPath(snapshot, 'docs/alpha.md').id

  await assertBodyRouteRefuses(port, '/api/knowledge/body', 'no query string at all')
  await assertBodyRouteRefuses(port, '/api/knowledge/body?', 'an empty query string')
  await assertBodyRouteRefuses(port, '/api/knowledge/body?other=1', 'an absent id parameter')
  await assertBodyRouteRefuses(port, '/api/knowledge/body?id=', 'an empty id')
  await assertBodyRouteRefuses(port, `/api/knowledge/body?id=${'f'.repeat(sampleId.length)}`, 'an id of the right shape that was never minted')
  await assertBodyRouteRefuses(port, `/api/knowledge/body?id=${idOfPath('docs/never-written.md', sampleId)}`, 'the id of a path that does not exist')
  await assertBodyRouteRefuses(port, '/api/knowledge/body?id=not-an-id-at-all', 'an id of no known shape')
})

// The security surface, stated as a test rather than trusted to the module boundary: an id
// that looks like a path is just an id that matches no concept, because the server never
// joins anything from a request to a filesystem path (D43 point 8).
test('body: a path-shaped id is a 404, raw, encoded, absolute or real', async (t) => {
  const dir = servedRepo(t)
  const { port } = await startServer(t, dir)

  const snapshot = (await getJson(port, '/api/snapshot')).value
  const sampleId = fileByPath(snapshot, 'docs/alpha.md').id

  await assertBodyRouteRefuses(port, '/api/knowledge/body?id=../../../../etc/passwd', 'a raw traversal')
  await assertBodyRouteRefuses(port, '/api/knowledge/body?id=%2E%2E%2F%2E%2E%2F%2E%2E%2F%2E%2E%2Fetc%2Fpasswd', 'a percent-encoded traversal')
  await assertBodyRouteRefuses(port, '/api/knowledge/body?id=%2e%2e%2f%2e%2e%2fetc%2fpasswd', 'a lowercase percent-encoded traversal')
  await assertBodyRouteRefuses(port, '/api/knowledge/body?id=/etc/passwd', 'an absolute path')
  await assertBodyRouteRefuses(port, `/api/knowledge/body?id=${encodeURIComponent(path.join(dir, KNOWLEDGE_ROOT, 'docs', 'alpha.md'))}`, 'the absolute path of a real concept')
  // A real concept path, which the listing does carry: it is still not an id, so it still
  // addresses nothing. The addressing is the minted digest and only the minted digest.
  await assertBodyRouteRefuses(port, '/api/knowledge/body?id=docs/alpha.md', 'a real relative concept path')
  await assertBodyRouteRefuses(port, '/api/knowledge/body?id=docs%2Falpha.md', 'a percent-encoded real concept path')

  // index.md is reserved and is never a concept, so it is never minted an id and its digest
  // resolves to nothing: the bundle index is not fetchable through this endpoint.
  const indexId = idOfPath('index.md', sampleId)
  assert.equal(snapshot.knowledge.files.some((f) => f.id === indexId), false, 'index.md must never be listed')
  await assertBodyRouteRefuses(port, `/api/knowledge/body?id=${indexId}`, 'the digest of index.md')
})

// ---------------------------------------------------------------------------
// No cache
// ---------------------------------------------------------------------------

// The property that makes the refresh control meaningful: every GET recomputes from disk, so
// a change made while the server runs is visible without a restart (D43 point 5).
test('no cache: a concept written while the server runs appears in the next snapshot', async (t) => {
  const dir = servedRepo(t)
  const { port } = await startServer(t, dir)

  const before = (await getJson(port, '/api/snapshot')).value
  assert.equal(before.knowledge.files.some((f) => f.path === 'docs/added.md'), false)

  writeFileAt(path.join(dir, KNOWLEDGE_ROOT, 'docs', 'added.md'), conceptExact('type: doc\ntitle: Added', 'the added body'))

  const after = (await getJson(port, '/api/snapshot')).value
  const added = fileByPath(after, 'docs/added.md')
  assert.equal(added.type, 'doc')
  // And its body is fetchable straight away, so the concept list behind the body route is
  // recomputed on every request too.
  const body = await getJson(port, `/api/knowledge/body?id=${added.id}`)
  assert.equal(body.status, 200)
  assert.equal(body.value.body, 'the added body')

  // An edit to an existing file is visible on the next read as well, and generatedAt moves.
  fs.writeFileSync(path.join(dir, KNOWLEDGE_ROOT, 'docs', 'alpha.md'), conceptExact('type: doc\ntitle: Alpha', 'a rewritten body'))
  const alpha = fileByPath(after, 'docs/alpha.md')
  const rewritten = await getJson(port, `/api/knowledge/body?id=${alpha.id}`)
  assert.equal(rewritten.value.body, 'a rewritten body')
  assert.notEqual((await getJson(port, '/api/snapshot')).value.generatedAt, before.generatedAt)

  // Nothing was cached, and nothing was written into the served repository either: the two
  // reads above changed only what the test changed.
  assert.equal(fs.existsSync(path.join(dir, KNOWLEDGE_ROOT, 'dashboard.html')), false)
})

// ---------------------------------------------------------------------------
// A broken repository
// ---------------------------------------------------------------------------

// A bad repository is a response, not a crash: a server that died here would be a real
// defect, and this is the test that would catch it.
test('broken repository: the data routes answer 500 and the process keeps serving', async (t) => {
  const dir = initRepo(t, { noConfig: true })
  assert.equal(fs.existsSync(path.join(dir, '.claude', 'major-tom.json')), false)
  const { port, child, out } = await startServer(t, dir)

  const snapshot = await getJson(port, '/api/snapshot')
  assert.equal(snapshot.status, 500)
  assert.equal(typeof snapshot.value.error, 'string')
  // The message is the useful part: it has to name what is wrong so the page can say it.
  assert.match(snapshot.value.error, /major-tom\.json/)

  const body = await getJson(port, '/api/knowledge/body?id=x')
  assert.equal(body.status, 500)
  assert.match(body.value.error, /major-tom\.json/)

  // The page has nothing to do with the repository, so it still serves.
  const page = await request(port, '/')
  assert.equal(page.status, 200)
  assert.ok(page.body.startsWith('<!doctype html>'))

  // Still alive, and still answering, which is the whole point.
  assert.equal(child.exitCode, null, 'the server must not exit because a request named a broken repository')
  assert.equal(child.signalCode, null)
  assert.equal((await getJson(port, '/api/snapshot')).status, 500)
  assert.equal((await request(port, '/nope')).status, 404)

  // A refused input is not a defect, so no stack trace was written to the log.
  assert.equal(out.stderr.includes('unhandled error'), false, `unexpected stderr: ${out.stderr}`)
})

// One broken repository has one diagnosis. It used to have two: readConceptBody judged the id
// before it read the config, so /api/knowledge/body on an un-onboarded repository was a 404
// saying no file carries that id, while /api/knowledge/body?id=x on the same repository was a
// 500 naming the missing config. Same repository, same fault, two answers, and which one a
// caller got depended on how malformed its own request was. The config is read first now, so
// the repository is diagnosed before the request is.
test('broken repository: the body route says the same thing with and without an id', async (t) => {
  const dir = initRepo(t, { noConfig: true })
  const { port, child, out } = await startServer(t, dir)

  const answers = []
  for (const target of [
    '/api/knowledge/body',
    '/api/knowledge/body?',
    '/api/knowledge/body?other=1',
    '/api/knowledge/body?id=',
    '/api/knowledge/body?id=x',
    '/api/knowledge/body?id=docs/alpha.md',
    '/api/snapshot',
  ]) {
    const res = await getJson(port, target)
    assert.equal(res.status, 500, `${target} must diagnose the repository, not the query string`)
    assert.match(res.value.error, /major-tom\.json/, `${target} must name what is actually wrong`)
    answers.push(res.value.error)
  }
  // Not merely all 500: the body route tells every caller the same thing, whatever the query
  // string was, and the snapshot route agrees with it.
  assert.equal(new Set(answers).size, 1, `one repository must have one diagnosis, got ${JSON.stringify(answers)}`)

  // And a malformed request against a repository that is sound is still a 404 and still not a
  // fault: the fix moved the diagnosis, it did not turn a bad id into a server error.
  const sound = await startServer(t, servedRepo(t))
  await assertBodyRouteRefuses(sound.port, '/api/knowledge/body', 'no id against a sound repository')
  await assertBodyRouteRefuses(sound.port, '/api/knowledge/body?id=', 'an empty id against a sound repository')
  await assertBodyRouteRefuses(sound.port, '/api/knowledge/body?id=docs/alpha.md', 'a path-shaped id against a sound repository')

  // Neither server treated any of it as a defect, and both are still serving.
  assert.equal(child.exitCode, null)
  assert.equal(out.stderr.includes('unhandled error'), false, `unexpected stderr: ${out.stderr}`)
  assert.equal((await request(port, '/')).status, 200)
})

// ---------------------------------------------------------------------------
// Fail closed at startup
// ---------------------------------------------------------------------------

// A missing or unusable repo root, a port that is not a port and a missing built page are all
// conditions no request can fix, so each is an exit before anything is bound rather than a 500
// on every request afterwards, or worse, a quiet start on some other port.
//
// started is what spawnServer or spawnServerAt returned, so the same assertions cover the real
// server and the copy that runs without a built page beside it.
async function assertExitsWithoutListening(t, started, port) {
  const { child, out } = started
  const outcome = await waitForListening(child, out)
  assert.equal(outcome.listening, false, `server.js must not listen: ${out.stdout}`)
  const exit = await new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve({ code: child.exitCode, signal: child.signalCode })
      return
    }
    child.once('exit', (code, signal) => resolve({ code, signal }))
  })
  assert.notEqual(exit.code, 0, 'server.js must exit non-zero')
  assert.ok(out.stderr.trim().length > 0, 'server.js must say why on stderr')
  assert.doesNotMatch(out.stdout, LISTENING_RE, 'server.js must never announce a port it did not bind')
  if (port !== undefined) await assertNotListening(port)
  return out
}

function assertFailsToStart(t, args, port, env) {
  return assertExitsWithoutListening(t, spawnServer(t, args, env), port)
}

test('startup: no repo root argument exits non-zero without listening', async (t) => {
  const out = await assertFailsToStart(t, [])
  assert.match(out.stderr, /usage: node server\.js/)
})

test('startup: a repo root that does not exist exits non-zero without listening', async (t) => {
  const dir = tmpDir(t, 'major-tom-server-absent-')
  const missing = path.join(dir, 'no-such-repository')
  const port = await freePort()
  const out = await assertFailsToStart(t, [missing, String(port)], port)
  assert.match(out.stderr, /does not exist/)
})

test('startup: a repo root that is a file exits non-zero without listening', async (t) => {
  const dir = tmpDir(t, 'major-tom-server-file-')
  const file = path.join(dir, 'not-a-directory.txt')
  fs.writeFileSync(file, 'this is a file, not a repository\n')
  const port = await freePort()
  const out = await assertFailsToStart(t, [file, String(port)], port)
  assert.match(out.stderr, /is not a directory/)
})

// ---------------------------------------------------------------------------
// The port
// ---------------------------------------------------------------------------

// A port the caller supplied and this server cannot honour is a refusal, never a quiet start
// somewhere else. The old resolution coerced the argument with Number and dropped anything
// falsy, so "banana" became NaN and started the server on 4242: a caller who asked for one
// port got another one, silently, and only found out by not finding the dashboard where they
// looked for it.
//
// Nothing below probes 4242 to prove the server did not land there, deliberately: 4242 is the
// default port and a developer running this suite may well have a real dashboard on it, so a
// probe would report their own server as this one's failure. The check that the fallback is
// gone is stronger than a probe anyway, because the server exits: it never binds at all, it
// says why on stderr, and it never prints a listening line.
test('startup: a port argument that is not a port number exits non-zero without listening', async (t) => {
  const dir = servedRepo(t)

  const rejected = [
    'banana',
    '', // an argument that was typed cannot mean "use the default"
    ' ', // nor can whitespace, which Number would have read as 0
    ' 4242 ', // Number(' 4242 ') is 4242; a port with whitespace in it is not a port
    '-1',
    '+80',
    '65536', // one past the last port there is
    '99999999',
    '4242.5',
    '0x1092', // Number() would have read this as 4242
    '1e4', // and this as 10000
    'Infinity',
    'NaN',
    '80/tcp',
  ]
  for (const value of rejected) {
    const out = await assertFailsToStart(t, [dir, value])
    assert.match(out.stderr, /is not a port number/, `the port argument ${JSON.stringify(value)} must be refused with a message`)
    assert.match(out.stderr, /port argument/, `the message for ${JSON.stringify(value)} must name which port source was wrong`)
  }
})

// The PORT variable is validated exactly like the argument. It had the identical flaw, and it
// is the path the launcher uses when Claude Desktop's autoPort mechanism exports a port rather
// than passing one (D32), so a garbage value here has to be as loud as a garbage argument.
test('startup: a PORT environment variable that is not a port number exits non-zero without listening', async (t) => {
  const dir = servedRepo(t)

  for (const value of ['banana', '-1', '65536', '4242.5', ' 4242 ']) {
    const out = await assertFailsToStart(t, [dir], undefined, { PORT: value })
    assert.match(out.stderr, /is not a port number/, `PORT=${JSON.stringify(value)} must be refused with a message`)
    assert.match(out.stderr, /PORT environment variable/, `the message for PORT=${JSON.stringify(value)} must name the environment variable`)
  }
})

// The other half of that contract: a PORT that is a port is honoured, and the argument still
// wins over it. This is the launcher's path (D32), so it is asserted rather than assumed.
test('port: a valid PORT is honoured, and the argument overrides it', async (t) => {
  const dir = servedRepo(t)

  const envPort = await freePort()
  const fromEnv = spawnServer(t, [dir], { PORT: String(envPort) })
  const envOutcome = await waitForListening(fromEnv.child, fromEnv.out)
  assert.equal(envOutcome.listening, true, `the server must start with PORT set: ${fromEnv.out.stderr}`)
  assert.equal(announcedPort(fromEnv.out), envPort, 'PORT must be the port bound when no argument is given')
  assert.equal((await request(envPort, '/api/snapshot')).status, 200)

  const argPort = await freePort()
  const fromArg = spawnServer(t, [dir, String(argPort)], { PORT: String(await freePort()) })
  const argOutcome = await waitForListening(fromArg.child, fromArg.out)
  assert.equal(argOutcome.listening, true, `the server must start with both sources set: ${fromArg.out.stderr}`)
  assert.equal(announcedPort(fromArg.out), argPort, 'the explicit argument must win over PORT')
})

// Port 0 is honoured rather than refused, and it means what it means to bind(2): let the
// kernel choose a free port. Both readings were defensible and this is the one the callers
// need, because the launcher forwards whatever autoPort supplies straight into this argument
// and "any free port" is what that mechanism exists to say. It is only usable at all because
// the startup line reports the port that was bound rather than the port that was asked for,
// which is the same fix that stopped the line claiming localhost.
test('port: 0 asks the kernel for a free port, and the server announces the one it got', async (t) => {
  const dir = servedRepo(t)
  const { child, out } = spawnServer(t, [dir, '0'])
  const outcome = await waitForListening(child, out)
  assert.equal(outcome.listening, true, `the server must start on port 0: ${out.stderr}`)

  const bound = announcedPort(out)
  assert.notEqual(bound, 0, 'the announced port must be the one the kernel chose, never the 0 that was asked for')
  assert.ok(bound > 0 && bound <= 65535, `the announced port must be a real port, got ${bound}`)
  // 4242 is not what "0" means, and the old fallback is what would have produced it here. It
  // could in principle be the port the kernel chose, so this is not asserted; what is asserted
  // is that the announced port is the port that is actually answering.
  const res = await getJson(bound, '/api/snapshot')
  assert.equal(res.status, 200, 'the announced port must be the port that is serving')
  assert.equal(res.value.config.project.name, 'fixture-project')
})

// The address in the startup line is the address that is listening. It used to say localhost
// while binding 127.0.0.1, and on a host where localhost resolves to ::1 first that is a URL
// a user copies into a browser and reaches nothing. LISTENING_RE carries the check, so this
// test is about the whole line being usable rather than about the pattern matching.
test('port: the announced address is the address that is bound', async (t) => {
  const dir = servedRepo(t)
  const { port, out } = await startServer(t, dir)

  assert.match(out.stdout, new RegExp(`major-tom dashboard on http://127\\.0\\.0\\.1:${port} \\(reading `), `the line must name the bound address: ${JSON.stringify(out.stdout)}`)
  assert.equal(out.stdout.includes('localhost'), false, 'the line must not name a host it did not bind')
  // The announced address is reachable exactly as printed.
  assert.equal((await request(port, '/api/snapshot')).status, 200)
})

// A server with no dashboard.html beside it cannot serve its own page, which is a condition a
// request cannot fix, so it exits at startup rather than 500ing on every GET /.
//
// Triggering it means a server.js whose directory has no built page, and the real one always
// does: the built page is the client's, this suite never moves it, and moving it would race
// any other process reading it. So the server is copied into a temp directory instead, with
// the two files it actually requires, snapshot.js and the vendored YAML parser, and without
// the page. The copy is the same bytes as the file under test, so what fails here is the file
// under test.
test('startup: a server with no dashboard.html beside it exits non-zero without listening', async (t) => {
  const appDir = tmpDir(t, 'major-tom-server-nopage-')
  fs.copyFileSync(SERVER, path.join(appDir, 'server.js'))
  fs.copyFileSync(path.join(APP, 'snapshot.js'), path.join(appDir, 'snapshot.js'))
  fs.cpSync(path.join(APP, 'vendor'), path.join(appDir, 'vendor'), { recursive: true })
  assert.equal(fs.existsSync(path.join(appDir, 'dashboard.html')), false, 'the copy must not have a built page')
  assert.equal(fs.readFileSync(path.join(appDir, 'server.js'), 'utf8'), fs.readFileSync(SERVER, 'utf8'), 'the copy must be the server under test')

  const dir = servedRepo(t)
  const port = await freePort()
  const out = await assertExitsWithoutListening(t, spawnServerAt(t, path.join(appDir, 'server.js'), [dir, String(port)]), port)

  assert.match(out.stderr, /dashboard\.html is missing/)
  // The message has to say what to do about it, because the repair is a build and not a retry.
  assert.match(out.stderr, /build-dashboard\.js/)
  // The repository it was given is sound, so nothing but the missing page can be the reason.
  assert.equal(fs.existsSync(path.join(dir, '.claude', 'major-tom.json')), true)
})
