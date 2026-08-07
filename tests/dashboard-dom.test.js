#!/usr/bin/env node
// Scenario suite for the built dashboard client, plugins/major-tom/app/dashboard.html
// (D43 PR2).
//
// Run with: node tests/dashboard-dom.test.js
//
// Node built-ins only: node:test, node:assert/strict and node:vm, no runner to install and
// no dependencies at all. That constraint is what shapes the whole file: there is no jsdom
// here, so the DOM the client runs against is the stub below, and it implements exactly the
// surface the client actually touches and nothing else. Every addition to that surface is a
// statement about the client, so an unimplemented call fails loudly instead of being
// silently absorbed.
//
// What is under test is the artifact, not the authoring split: the suite reads
// plugins/major-tom/app/dashboard.html from disk, extracts its single inline script, and
// runs that. Editing plugins/major-tom/app/dashboard/src/ without rebuilding therefore does
// not change what these tests exercise, and the freshness test below turns that into an
// explicit failure by running scripts/build-dashboard.js --check.
//
// How the bundle is driven. The script is one IIFE over browser globals, so it is evaluated
// with vm.runInContext in a context whose globals are the stub: document, window (the
// context object itself, as in a page), location, localStorage, history, matchMedia and
// fetch. A vm context rather than a Function wrapper on purpose: an undeclared global the
// client reaches for throws a ReferenceError here instead of quietly resolving against this
// process's own globals, which is the difference between a stub that is honest and one that
// merely appears to work.
//
// What the stub records. Element.innerHTML is a recorded property with a render counter, so
// every assertion below reads the HTML string the client produced, which is the client's one
// output. Assertions are on substrings and on structure that carries meaning: a commit
// subject, a concept path, a config value, a group heading order. Never on whole-page bytes,
// because the styling those bytes carry is not what this suite is about.
//
// How events are synthesized. The client attaches one click listener on document and
// dispatches on data-act, so a click here is described rather than constructed: the helper
// looks for a control carrying that data-act (and data-v) in the HTML currently on screen,
// refuses to click one that is not there or is rendered disabled, and dispatches an event
// whose target is a child of it, so the delegation walks up through closest exactly as it
// does in the page.
//
// Time. Fixture timestamps are expressed relative to the clock at fixture build, because the
// client's relative times are computed against Date.now(). The nearest rounding boundary in
// any assertion below sits half a minute away from the value asserted, so no test here can
// be lost to a slow machine.

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const REPO_ROOT = path.resolve(__dirname, '..')
const PAGE = path.join(REPO_ROOT, 'plugins', 'major-tom', 'app', 'dashboard.html')
const BUILD = path.join(REPO_ROOT, 'scripts', 'build-dashboard.js')

// The two routes that are the whole client-facing contract of the server.
const SNAPSHOT_ROUTE = '/api/snapshot'
const BODY_ROUTE = '/api/knowledge/body'

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

// ---------------------------------------------------------------------------
// The artifact under test
// ---------------------------------------------------------------------------

const PAGE_HTML = fs.readFileSync(PAGE, 'utf8')

// The one inline script of the built page. The build emits a single <script> holding the
// bundled IIFE and a single <style> holding the CSS, so anything else here means the artifact
// stopped being the self-contained page D32 requires and this suite is running the wrong
// thing.
const SCRIPT = (function () {
  assert.equal(PAGE_HTML.indexOf('<script'), PAGE_HTML.lastIndexOf('<script'),
    'the built page must carry exactly one script element')
  const match = PAGE_HTML.match(/<script>\n([\s\S]*?)\n<\/script>/)
  assert.ok(match, 'the built page must carry one inline script with no attributes')
  return match[1]
})()

// ---------------------------------------------------------------------------
// The DOM stub
// ---------------------------------------------------------------------------

// One element. innerHTML is recorded rather than parsed: the client writes HTML strings and
// never reads the DOM back, so the string plus a render counter is the whole truth about what
// it did. The counter is what tells a fresh render from an untouched one, and it is also what
// mints a new #git-q element per render, the way assigning innerHTML does in a page.
function createElement(id) {
  let html = ''
  const classes = new Set()
  const listeners = new Map()
  const element = {
    id,
    renders: 0,
    classes,
    listeners,
    classList: {
      toggle(name, force) {
        assert.equal(typeof name, 'string', 'classList.toggle needs a class name')
        if (force === undefined) {
          if (classes.has(name)) classes.delete(name)
          else classes.add(name)
        } else if (force) {
          classes.add(name)
        } else {
          classes.delete(name)
        }
        return classes.has(name)
      },
      contains(name) {
        return classes.has(name)
      },
    },
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, [])
      listeners.get(type).push(handler)
    },
  }
  Object.defineProperty(element, 'innerHTML', {
    get() {
      return html
    },
    set(value) {
      html = String(value)
      element.renders += 1
    },
    enumerable: true,
  })
  return element
}

// The one input the client reaches for by id, #git-q in the git view. It carries what the
// handler touches: the value it reads off the event target, and the focus and selection calls
// that put the caret back after the re-render.
function createInput(value) {
  const listeners = new Map()
  return {
    id: 'git-q',
    value,
    focused: 0,
    selection: null,
    listeners,
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, [])
      listeners.get(type).push(handler)
    },
    focus() {
      this.focused += 1
    },
    setSelectionRange(start, end) {
      this.selection = [start, end]
    },
  }
}

// The fetch stub. Nothing resolves on its own: every request stays pending until a test
// answers it, which is what makes the loading state, the failure states and the out-of-order
// case reachable at all.
function createNet() {
  const calls = []
  const pending = []

  function parseTarget(target) {
    const text = String(target)
    const mark = text.indexOf('?')
    const route = mark === -1 ? text : text.slice(0, mark)
    const params = new Map()
    if (mark !== -1) {
      for (const pair of text.slice(mark + 1).split('&')) {
        if (pair === '') continue
        const eq = pair.indexOf('=')
        const key = eq === -1 ? pair : pair.slice(0, eq)
        const raw = eq === -1 ? '' : pair.slice(eq + 1)
        params.set(decodeURIComponent(key), decodeURIComponent(raw))
      }
    }
    return { url: text, route, params }
  }

  function response(status, text) {
    return {
      status,
      ok: status >= 200 && status < 300,
      text() {
        return Promise.resolve(text)
      },
    }
  }

  function fetch(target, init) {
    const parsed = parseTarget(target)
    const request = {
      url: parsed.url,
      route: parsed.route,
      params: parsed.params,
      id: parsed.params.has('id') ? parsed.params.get('id') : null,
      init: init,
      answered: false,
    }
    request.promise = new Promise((resolve, reject) => {
      request.settle = resolve
      request.abort = reject
    })
    request.json = function (status, value) {
      this.raw(status, JSON.stringify(value))
    }
    request.raw = function (status, text) {
      assert.equal(this.answered, false, `${this.url} was already answered`)
      this.answered = true
      const at = pending.indexOf(this)
      if (at !== -1) pending.splice(at, 1)
      this.settle(response(status, text))
    }
    request.reject = function (message) {
      assert.equal(this.answered, false, `${this.url} was already answered`)
      this.answered = true
      const at = pending.indexOf(this)
      if (at !== -1) pending.splice(at, 1)
      this.abort(new Error(message))
    }
    calls.push(request)
    pending.push(request)
    return request.promise
  }

  return {
    fetch,
    calls,
    pending,
    // The oldest request still waiting for an answer on a route.
    take(route) {
      const found = pending.filter((request) => request.route === route)
      assert.ok(found.length > 0, `no request to ${route} is in flight`)
      return found[0]
    },
    countFor(route) {
      return calls.filter((request) => request.route === route).length
    },
    lastFor(route) {
      const found = calls.filter((request) => request.route === route)
      assert.ok(found.length > 0, `no request was ever issued to ${route}`)
      return found[found.length - 1]
    },
  }
}

// The whole environment one page load runs in.
function createEnv(options) {
  const opts = options || {}
  const store = new Map(Object.entries(opts.storage || {}))
  const rail = createElement('rail')
  const main = createElement('main')
  const app = createElement('app')
  const documentElement = { dataset: {} }
  const net = createNet()
  const replaced = []
  const media = []

  // #git-q lives inside the HTML the client just wrote, so it exists only while that HTML
  // carries it, and it is a new element after every render: assigning innerHTML in a page
  // destroys the old input along with its listeners, and a stub that returned the same object
  // forever would hide a listener leak instead of catching one.
  let inputRender = -1
  let input = null
  function gitInput() {
    if (main.innerHTML.indexOf('id="git-q"') === -1) return null
    if (input === null || inputRender !== main.renders) {
      const match = main.innerHTML.match(/<input id="git-q"[^>]*\svalue="([^"]*)"/)
      input = createInput(match ? match[1] : '')
      inputRender = main.renders
    }
    return input
  }

  const documentListeners = new Map()
  const windowListeners = new Map()

  const document = {
    title: '',
    documentElement,
    getElementById(id) {
      if (id === 'rail') return rail
      if (id === 'main') return main
      if (id === 'app') return app
      if (id === 'git-q') return gitInput()
      return null
    },
    addEventListener(type, handler) {
      if (!documentListeners.has(type)) documentListeners.set(type, [])
      documentListeners.get(type).push(handler)
    },
  }

  const location = { hash: opts.hash || '' }

  const localStorage = {
    getItem(key) {
      return store.has(key) ? store.get(key) : null
    },
    setItem(key, value) {
      store.set(key, String(value))
    },
  }

  const history = {
    replaceState(state, title, url) {
      replaced.push(url)
    },
  }

  function matchMedia(query) {
    media.push(query)
    return { media: query, matches: query.indexOf('light') !== -1 ? opts.prefersLight === true : false }
  }

  // window is the context object itself, as it is in a page, so window.matchMedia and the
  // bare matchMedia the client also calls are one function, and window.addEventListener is
  // the global one. document keeps its own listener registry, which is what it has in a page.
  const sandbox = {
    document,
    location,
    localStorage,
    history,
    matchMedia,
    fetch: net.fetch,
    addEventListener(type, handler) {
      if (!windowListeners.has(type)) windowListeners.set(type, [])
      windowListeners.get(type).push(handler)
    },
  }
  sandbox.window = sandbox

  function fire(registry, type, event) {
    const handlers = registry.get(type) || []
    assert.ok(handlers.length > 0, `nothing listens for ${type}`)
    for (const handler of handlers) handler(event)
  }

  return {
    sandbox,
    net,
    rail,
    main,
    app,
    document,
    documentElement,
    location,
    history: { replaced },
    media,
    storage: store,
    gitInput,
    documentListeners,
    windowListeners,
    fireOnDocument(type, event) {
      fire(documentListeners, type, event)
    },
    fireOnWindow(type, event) {
      fire(windowListeners, type, event)
    },
  }
}

// Everything on screen: the rail and the main area, which is the whole page the client owns.
function screen(env) {
  return env.rail.innerHTML + env.main.innerHTML
}

// Every control currently rendered, as the delegation sees them: an element carrying data-act.
function controls(env, act) {
  const html = screen(env)
  const found = []
  const tags = /<([a-zA-Z][\w-]*)\b[^>]*>/g
  let match
  while ((match = tags.exec(html)) !== null) {
    const tag = match[0]
    const actMatch = tag.match(/\sdata-act="([^"]*)"/)
    if (!actMatch) continue
    if (act !== undefined && actMatch[1] !== act) continue
    const vMatch = tag.match(/\sdata-v="([^"]*)"/)
    found.push({
      tag,
      name: match[1],
      act: actMatch[1],
      v: vMatch ? vMatch[1] : null,
      disabled: /\sdisabled(?=[\s>])/.test(tag),
    })
  }
  return found
}

function attribute(tag, name) {
  const match = tag.match(new RegExp('\\s' + name + '="([^"]*)"'))
  return match ? match[1] : null
}

// A click on a control that is described rather than constructed: it has to be on screen and,
// unless the test is deliberately racing it, not rendered disabled. The event target is a
// child of the control, because in the page it usually is (the glyph span inside the button),
// so this exercises the closest walk rather than stepping over it.
function click(env, act, value, options) {
  const opts = options || {}
  const candidates = controls(env, act).filter((c) => value === undefined || c.v === value)
  const wanted = value === undefined ? `data-act="${act}"` : `data-act="${act}" data-v="${value}"`
  assert.ok(candidates.length > 0, `no control carrying ${wanted} is on screen`)
  const control = candidates[opts.index || 0]
  if (!opts.force) {
    assert.equal(control.disabled, false, `the control carrying ${wanted} is rendered disabled`)
  }
  const button = {
    getAttribute(name) {
      return attribute(control.tag, name)
    },
    closest(selector) {
      assert.equal(selector, '[data-act]')
      return button
    },
  }
  env.fireOnDocument('click', {
    target: {
      closest(selector) {
        assert.equal(selector, '[data-act]')
        return button
      },
    },
  })
  return control
}

// A click that lands on nothing the client owns.
function clickNowhere(env) {
  env.fireOnDocument('click', {
    target: {
      closest() {
        return null
      },
    },
  })
}

function typeInFilter(env, text) {
  const input = env.gitInput()
  assert.ok(input, 'the git view must render its filter input')
  const handlers = input.listeners.get('input') || []
  assert.equal(handlers.length, 1, 'the filter must carry exactly one input listener per render')
  input.value = text
  handlers[0]({ target: input })
}

// Evaluates the bundle. The first render and the first request happen inside this call, so
// what the environment holds on return is the state of the page before anything resolved.
function boot(options) {
  const env = createEnv(options)
  vm.createContext(env.sandbox)
  vm.runInContext(SCRIPT, env.sandbox, { filename: 'dashboard.html' })
  return env
}

// Drains the microtask queue the client's promise chains run on. A macrotask boundary is
// enough: every microtask queued before it, and every microtask those queue in turn, has run
// by the time this resolves. Two rounds, so a chain that crosses a boundary is still settled.
function settle() {
  return new Promise((resolve) => setImmediate(resolve)).then(
    () => new Promise((resolve) => setImmediate(resolve))
  )
}

// The ordinary starting point: a page that booted and whose first snapshot landed.
async function bootLoaded(options) {
  const opts = options || {}
  const env = boot(opts)
  env.net.take(SNAPSHOT_ROUTE).json(200, opts.snapshot || snapshotFixture())
  await settle()
  return env
}

function has(html, needle, message) {
  assert.ok(html.indexOf(needle) !== -1, `${message}\nmissing: ${JSON.stringify(needle)}`)
}

function lacks(html, needle, message) {
  assert.equal(html.indexOf(needle), -1, `${message}\nunexpected: ${JSON.stringify(needle)}`)
}

// The count the rail states beside one view button.
function railCount(env, view) {
  const html = env.rail.innerHTML
  const at = html.indexOf(`data-v="${view}"`)
  assert.notEqual(at, -1, `the rail must carry a button for ${view}`)
  const end = html.indexOf('</button>', at)
  const match = html.slice(at, end).match(/<span class="count rail-label">(\d+)<\/span>/)
  return match ? Number(match[1]) : 0
}

function countOf(html, needle) {
  let total = 0
  let at = html.indexOf(needle)
  while (at !== -1) {
    total += 1
    at = html.indexOf(needle, at + needle.length)
  }
  return total
}

// ---------------------------------------------------------------------------
// The fixture snapshot
// ---------------------------------------------------------------------------

function ago(ms) {
  return new Date(Date.now() - ms).toISOString()
}

// A snapshot in the shape the server serves, plus the two keys the client also reads. The
// server's payload carries exactly config, decisions, generatedAt, git, knowledge and
// timeline; roadmap and lastRun are keys the views consume and no producer writes yet, so
// they are here to exercise those views, and the test named for the served shape drops them
// again and asserts the empty states instead.
//
// Built fresh on every call, so no test can leave a mutation behind for the next one.
function snapshotFixture() {
  return {
    generatedAt: ago(5 * MINUTE),
    config: {
      schemaVersion: 1,
      onboard: { completedAt: ago(9 * DAY), pluginVersion: '0.19.0' },
      project: {
        name: 'fixture-project',
        description: 'A throwaway repository built by the client suite.',
        type: 'existing',
        topology: 'single',
      },
      execution: {
        workingModel: 'team',
        team: { coordinator: 'coordinator', members: ['planner', 'implementer', 'reviewer'] },
      },
      persistence: { root: '.knowledge' },
      stack: { languages: ['javascript'], frameworks: [] },
    },
    git: [
      {
        hash: '1a2b3c4d5e6f7890',
        date: ago(20 * MINUTE),
        author: 'Fixture Author',
        subject: 'feat(dashboard): fetch the snapshot over http',
        add: 120,
        del: 8,
      },
      {
        hash: 'b1c2d3e4f5a60011',
        date: ago(3 * HOUR),
        author: 'Fixture Author',
        subject: 'fix(server): refuse a path-shaped id',
        add: 12,
        del: 30,
      },
      {
        hash: 'c1d2e3f4a5b60022',
        date: ago(26 * HOUR),
        author: 'Other Author',
        subject: 'docs(prd): D43 drops the degraded path',
        add: 40,
        del: 2,
      },
      {
        hash: 'd1e2f3a4b5c60033',
        date: ago(2 * DAY),
        author: 'Fixture Author',
        subject: 'chore(release): manifests at 0.19.0',
        add: 4,
        del: 4,
      },
      {
        hash: 'e1f2a3b4c5d60044',
        date: ago(3 * DAY),
        author: 'Fixture Author',
        subject: 'test(client): cover a <script> subject',
        add: 60,
        del: 0,
      },
    ],
    knowledge: {
      // Deliberately not in group order, so the tree's ordering cannot pass by accident, and
      // deliberately holding a concept in a directory outside the five canonical areas plus
      // one at the bundle root, which are the two entries a fixed area list used to drop.
      files: [
        {
          id: 'aa01',
          path: 'docs/alpha.md',
          type: 'doc',
          size: 320,
          updated: ago(2 * HOUR),
          frontmatter: { type: 'doc', title: 'Alpha', okf_version: '0.2' },
        },
        {
          id: 'bb02',
          path: 'toplevel.md',
          type: 'doc',
          size: 96,
          updated: ago(5 * HOUR),
          frontmatter: { type: 'doc', title: 'At the bundle root' },
        },
        {
          id: 'cc03',
          path: 'memories/deep/nested.md',
          type: 'memory',
          size: 210,
          updated: ago(30 * HOUR),
          frontmatter: { type: 'memory', title: 'Nested' },
        },
        {
          id: 'dd04',
          path: 'notes/outside.md',
          type: 'note',
          size: 140,
          updated: ago(31 * HOUR),
          frontmatter: { type: 'note', title: 'Outside the five areas' },
        },
        {
          id: 'ee05',
          path: 'runs/r-2026-08-07.md',
          type: 'run',
          size: 512,
          updated: ago(90 * MINUTE),
          frontmatter: { type: 'run', title: 'Feature run' },
        },
        {
          id: 'ff06',
          path: 'docs/decisions/d43.md',
          type: 'decision',
          size: 480,
          updated: ago(4 * DAY),
          frontmatter: { type: 'decision', id: 'D43', title: 'Live data', status: 'closed' },
        },
        {
          id: '0a07',
          path: 'monitors/drift.md',
          type: 'monitor',
          size: 130,
          updated: ago(6 * DAY),
          frontmatter: { type: 'monitor', title: 'Drift' },
        },
        {
          id: '1b08',
          path: 'logs/session.md',
          type: 'log',
          size: 700,
          updated: ago(7 * DAY),
          frontmatter: { type: 'log', title: 'Session log' },
        },
      ],
    },
    decisions: [
      { id: 'D43', text: 'The dashboard reads a live snapshot over HTTP', date: '2026-08-05', status: 'closed' },
      { id: 'D46', text: 'The session start reports an out-of-date plugin', date: '2026-08-06', status: 'closed' },
      { id: 'OQ-7', text: 'The bundle layout stays open', date: '', status: 'open' },
    ],
    timeline: {
      events: [
        {
          kind: 'intent',
          tier: 'substantive',
          type: 'feature',
          summary: 'Serve the snapshot from the dashboard server',
          at: ago(10 * MINUTE),
          sessionId: 'abcdef1234567890',
          promptId: 'p-0001',
          path: 'docs/PRD.md',
          summaryTruncated: false,
        },
        {
          kind: 'run',
          summary: 'feature workflow completed',
          at: ago(90 * MINUTE),
          sessionId: 'abcdef1234567890',
          path: 'runs/r-2026-08-07.md',
        },
        {
          kind: 'intent',
          tier: 'task',
          type: 'chore',
          summary: 'Bump the manifests to 0.19.0',
          at: ago(4 * HOUR),
          sessionId: '0f0f0f0f11112222',
          promptId: 'p-0002',
          path: '',
          summaryTruncated: true,
        },
      ],
      window: { days: 30, floorEvents: 50, ceilingEvents: 500 },
      omitted: { count: 2, oldestKept: ago(29 * DAY), reason: 'days' },
    },
    roadmap: {
      milestones: [
        {
          title: 'Live data',
          version: '0.19.0',
          status: 'active',
          tasks: [
            { ref: 'T1', title: 'Serve the snapshot', status: 'done', owner: 'implementer' },
            { ref: 'T2', title: 'Fetch it in the client', status: 'active', owner: 'implementer' },
          ],
        },
        {
          title: 'Knowledge bodies',
          version: '0.20.0',
          status: 'planned',
          tasks: [{ ref: 'T3', title: 'Fetch bodies on demand', status: 'todo', owner: 'planner' }],
        },
      ],
    },
    lastRun: {
      id: 'run-2026-08-07-01',
      workflow: 'feature',
      duration: '12m',
      mode: 'team',
      phases: [
        { name: 'understand', artifact: 'docs/PRD.md', status: 'done', elapsed: '2m' },
        { name: 'decide', artifact: 'docs/PRD.md', status: 'done', elapsed: '3m' },
        { name: 'implement', artifact: 'plugins/major-tom/app', status: 'active', elapsed: '6m' },
      ],
    },
  }
}

// The payload the server actually serves today: the six keys and nothing else.
function servedShape() {
  const snapshot = snapshotFixture()
  delete snapshot.roadmap
  delete snapshot.lastRun
  return snapshot
}

function fileByPath(snapshot, target) {
  const found = snapshot.knowledge.files.filter((file) => file.path === target)
  assert.equal(found.length, 1, `the fixture must carry exactly one ${target}`)
  return found[0]
}

function indexByPath(snapshot, target) {
  const at = snapshot.knowledge.files.findIndex((file) => file.path === target)
  assert.notEqual(at, -1, `the fixture must carry ${target}`)
  return String(at)
}

// ---------------------------------------------------------------------------
// The artifact
// ---------------------------------------------------------------------------

test('artifact: the page under test is the one the authoring split builds', () => {
  // This suite reads the built file, so a change to plugins/major-tom/app/dashboard/src/ that
  // was never built reaches none of the tests below. That is the reason this check is here and
  // not only in the commit checklist: a stale artifact is a failure of this suite too.
  try {
    execFileSync(process.execPath, [BUILD, '--check'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    assert.fail(
      'plugins/major-tom/app/dashboard.html is stale against plugins/major-tom/app/dashboard/. '
      + `Run: node scripts/build-dashboard.js\n${error.stderr || error.message}`
    )
  }
})

test('artifact: the page is self-contained, with no external script or stylesheet', () => {
  lacks(PAGE_HTML, '<script src', 'the bundle must be inline (D32)')
  lacks(PAGE_HTML, '<script type="module"', 'the built page must not carry the authoring entry')
  lacks(PAGE_HTML, '<link rel="stylesheet"', 'the CSS must be inline (D32)')
  has(PAGE_HTML, '<style>', 'the built page must carry its CSS inline')
})

// ---------------------------------------------------------------------------
// The load lifecycle
// ---------------------------------------------------------------------------

test('load: the boot issues exactly one GET /api/snapshot', () => {
  const env = boot()
  assert.equal(env.net.calls.length, 1)
  const request = env.net.calls[0]
  assert.equal(request.url, SNAPSHOT_ROUTE)
  assert.equal(request.init.method, 'GET')
  // No cache on the client either: the server recomputes on every call and a cached answer
  // would put a stale computation behind a pill that claims to state the last one.
  assert.equal(request.init.cache, 'no-store')
  assert.equal(request.init.headers.Accept, 'application/json')
})

test('load: the loading state renders before the fetch resolves, with the rail already there', () => {
  const env = boot()

  has(env.main.innerHTML, 'Computing the snapshot on the server and fetching it.',
    'the loading panel must be on screen while the request is in flight')
  has(env.main.innerHTML, '>computing<', 'the pill must say the snapshot is being computed')

  // The chrome does not wait for the data: the rail is rendered from the empty derivation, so
  // it carries its buttons and honest zeros rather than nothing at all.
  has(env.rail.innerHTML, 'data-act="view" data-v="overview"', 'the rail must be on screen already')
  for (const view of ['overview', 'roadmap', 'timeline', 'git', 'knowledge', 'config']) {
    has(env.rail.innerHTML, `data-v="${view}"`, `the rail must carry the ${view} button`)
  }
  assert.equal(railCount(env, 'knowledge'), 0, 'an unloaded page must count nothing')
  assert.equal(env.rail.renders, 1)
  assert.equal(env.main.renders, 1)
})

test('load: a resolved fetch replaces the loading state with the view', async () => {
  const env = boot()
  const snapshot = snapshotFixture()
  env.net.take(SNAPSHOT_ROUTE).json(200, snapshot)
  await settle()

  lacks(env.main.innerHTML, 'Computing the snapshot on the server',
    'the loading panel must be gone once the snapshot landed')
  has(env.main.innerHTML, 'feat(dashboard): fetch the snapshot over http',
    'the overview must show the data that arrived')
  has(env.main.innerHTML, 'computed ', 'the pill must state the time of the computation')
  has(env.main.innerHTML, '(5 min ago)', 'the pill must state generatedAt as a relative time')
  assert.equal(env.document.title, 'Major Tom: fixture-project')
  assert.equal(railCount(env, 'knowledge'), snapshot.knowledge.files.length)
})

test('load: a 500 carrying {error} renders the error state with the server message and a retry', async () => {
  const env = boot()
  env.net.take(SNAPSHOT_ROUTE).json(500, { error: '.claude/major-tom.json is missing: run /major-tom:onboard' })
  await settle()

  const html = env.main.innerHTML
  // D43 point 2 dropped the degraded path, so this state is the whole page: it names the
  // request, repeats the server's own message, and offers the one action that can fix it.
  has(html, '>no data<', 'the error panel must be the main area')
  has(html, 'GET /api/snapshot failed', 'the error state must name the request that failed')
  has(html, '.claude/major-tom.json is missing: run /major-tom:onboard',
    'the error state must repeat the message the server sent')
  has(html, 'This page carries no embedded copy to fall back on',
    'the error state must say there is no fallback')
  has(html, 'data-act="refresh"', 'the error state must offer a retry')
  has(html, '>retry<', 'the retry must be labelled as one')
  has(html, 'start it with /major-tom:dashboard', 'the error state must say how to start the server')
  lacks(html, 'Computing the snapshot on the server', 'the loading panel must be gone')
  // The rail survives the failure, so the page is still navigable.
  has(env.rail.innerHTML, 'data-act="theme"', 'the rail must survive a failed load')
})

test('load: a rejected fetch renders the error state naming the route', async () => {
  const env = boot()
  env.net.take(SNAPSHOT_ROUTE).reject('connect ECONNREFUSED 127.0.0.1:4242')
  await settle()

  const html = env.main.innerHTML
  has(html, '>no data<', 'a request that never completed is the same rendered state')
  has(html, 'GET /api/snapshot failed', 'the error state must name the request')
  has(html, 'the request to /api/snapshot did not complete', 'the error state must say the request never landed')
  has(html, 'connect ECONNREFUSED 127.0.0.1:4242', 'the underlying reason must survive to the screen')
  has(html, 'data-act="refresh"', 'the error state must offer a retry')
})

test('load: a body that is not JSON renders the error state rather than a blank page', async () => {
  const env = boot()
  env.net.take(SNAPSHOT_ROUTE).raw(200, '<!doctype html><title>a proxy said no</title>')
  await settle()

  has(env.main.innerHTML, '>no data<', 'an unparseable success is still a failure to show')
  has(env.main.innerHTML, 'with a body that is not JSON', 'the error must say what was wrong with the body')
})

test('load: an HTTP failure with no JSON error repeats the first line of the body', async () => {
  const env = boot()
  env.net.take(SNAPSHOT_ROUTE).raw(405, 'method not allowed\nsecond line')
  await settle()

  has(env.main.innerHTML, 'the server answered HTTP 405: method not allowed',
    'a plain-text refusal must be repeated verbatim')
  lacks(env.main.innerHTML, 'second line', 'only the first line of a non-JSON body is repeated')
})

test('load: retry after a failure recovers and renders the view', async () => {
  const env = boot()
  env.net.take(SNAPSHOT_ROUTE).json(500, { error: 'the repository is broken' })
  await settle()
  has(env.main.innerHTML, '>no data<', 'the failure must be on screen before the retry')

  click(env, 'refresh')
  assert.equal(env.net.countFor(SNAPSHOT_ROUTE), 2, 'the retry must issue the same request again')
  has(env.main.innerHTML, '>retrying<', 'the retry must state that it is in flight')

  env.net.take(SNAPSHOT_ROUTE).json(200, snapshotFixture())
  await settle()

  lacks(env.main.innerHTML, '>no data<', 'the error state must be gone once the retry landed')
  lacks(env.main.innerHTML, 'the repository is broken', 'the old message must not survive the recovery')
  has(env.main.innerHTML, 'feat(dashboard): fetch the snapshot over http', 'the view must render the recovered data')
})

// ---------------------------------------------------------------------------
// The six views
// ---------------------------------------------------------------------------

test('views: overview renders the lifecycle, the roadmap, the counts, the activity and the commits', async () => {
  const env = await bootLoaded()
  const html = env.main.innerHTML

  has(html, '<h1 class="sans">overview</h1>', 'the header must name the view')
  has(html, 'run-2026-08-07-01', 'the lifecycle must name the run it renders')
  has(html, 'understand', 'the lifecycle must render the phases of that run')
  has(html, 'implement', 'the lifecycle must render every phase')
  has(html, 'Live data', 'the roadmap brief must render the milestones')
  has(html, '>concepts</span>', 'the knowledge panel must render its total tile')
  has(html, 'Serve the snapshot from the dashboard server', 'the activity strip must render the merged stream')
  has(html, 'feat(dashboard): fetch the snapshot over http', 'the git panel must render the commit window')
  has(html, 'The dashboard reads a live snapshot over HTTP', 'the decisions panel must render the decisions')
  has(html, '2 closed &#183; 1 open', 'the decisions panel must count what it was given')
})

test('views: overview switches between the grid and the console layout', async () => {
  const env = await bootLoaded()
  has(env.main.innerHTML, '2/3 done', 'the grid layout states how many phases are done')

  click(env, 'layout', 'B')
  const html = env.main.innerHTML
  // The console layout states two things the grid never renders: the elapsed time of each
  // phase and its status in full.
  has(html, '>6m</span>', 'the console layout states the elapsed time of each phase')
  has(html, ';letter-spacing:.08em;text-transform:uppercase">active</span>',
    'the console layout states the status of each phase')
  lacks(html, '2/3 done', 'the grid header must be gone in the console layout')
})

test('views: roadmap renders every milestone with its tasks and its progress', async () => {
  const env = await bootLoaded()
  click(env, 'view', 'roadmap')
  const html = env.main.innerHTML

  has(html, '<h1 class="sans">roadmap</h1>', 'the header must name the view')
  has(html, 'Live data', 'the first milestone must be on screen')
  has(html, '0.19.0', 'a milestone must state its version')
  has(html, 'Knowledge bodies', 'the second milestone must be on screen')
  has(html, 'Serve the snapshot', 'a milestone must render its tasks')
  has(html, 'Fetch it in the client', 'a milestone must render every task')
  has(html, 'Fetch bodies on demand', 'the second milestone must render its task too')
  has(html, '1/2 tasks', 'a milestone must state how many of its tasks are done')
  has(html, '1 active', 'the head must count the active milestones')
})

test('views: timeline renders the merged stream, the window and the omission record', async () => {
  const env = await bootLoaded()
  click(env, 'view', 'timeline')
  const html = env.main.innerHTML

  has(html, '3 recorded events &#183; 5 commits', 'the bar must state both streams')
  has(html, '8 in the merged stream', 'the bar must state the merged length')
  has(html, 'Window: last 30 days, floor 50 events, ceiling 500 events.',
    'the window this view stands on must be stated in full')
  has(html, '2 events omitted', 'an omission must never be silent (D41)')
  has(html, 'limit that bit: days (the day horizon).', 'the omission must name the limit that bit')
  has(html, 'Serve the snapshot from the dashboard server', 'an intent event must be on screen')
  has(html, 'feature workflow completed', 'a run event must be on screen')
  has(html, '>truncated<', 'a summary cut at the cap must be flagged')
  has(html, 'session abcdef12', 'events must be grouped under their session')
  has(html, 'fix(server): refuse a path-shaped id', 'the commits must be merged into the same stream')
})

test('views: git renders the commit window with its authors and its diff stats', async () => {
  const env = await bootLoaded()
  click(env, 'view', 'git')
  const html = env.main.innerHTML

  has(html, '<h1 class="sans">git</h1>', 'the header must name the view')
  has(html, '5 of 5 commits', 'the bar must state how much of the window is visible')
  has(html, '1a2b3c4', 'a commit must be identified by its short sha')
  has(html, 'fix(server): refuse a path-shaped id', 'every commit subject must be on screen')
  has(html, 'Other Author', 'the author column must come from the data')
  has(html, '+120', 'the diff stats must come from the data')
  has(html, 'id="git-q"', 'the filter input must be rendered')
})

test('views: git escapes a commit subject that carries markup', async () => {
  const env = await bootLoaded()
  click(env, 'view', 'git')

  has(env.main.innerHTML, 'test(client): cover a &lt;script&gt; subject',
    'a subject is data from the repository and must be escaped')
  lacks(env.main.innerHTML, '<script>', 'no snapshot string may reach the page as markup')
})

test('views: git filters by kind and by the query the user types', async () => {
  const env = await bootLoaded()
  click(env, 'view', 'git')

  click(env, 'filter', 'fix')
  has(env.main.innerHTML, '1 of 5 commits', 'the kind segment must narrow the window')
  has(env.main.innerHTML, 'fix(server): refuse a path-shaped id', 'the surviving commit must be the fix')
  lacks(env.main.innerHTML, 'feat(dashboard): fetch the snapshot over http', 'the other kinds must be gone')

  click(env, 'filter', 'all')
  typeInFilter(env, 'Other Author')
  has(env.main.innerHTML, '1 of 5 commits', 'the query must narrow the window')
  has(env.main.innerHTML, 'docs(prd): D43 drops the degraded path', 'the query must match the author too')
  assert.equal(env.gitInput().value, 'Other Author', 'the query must survive the re-render')
  assert.equal(env.gitInput().focused, 1, 'the caret must be put back after the re-render')
})

test('views: knowledge renders the tree, the frontmatter and the selected file', async () => {
  const env = await bootLoaded()
  click(env, 'view', 'knowledge')
  const html = env.main.innerHTML

  has(html, '<h1 class="sans">knowledge</h1>', 'the header must name the view')
  has(html, '.knowledge as an OKF 0.2 bundle', 'the subtitle must state the bundle root from the config')
  has(html, '>docs/alpha.md<', 'the first entry must be the selected file')
  has(html, 'okf_version', 'the frontmatter of the selected file must be on screen')
  has(html, 'alpha.md', 'the tree must render the basename of every entry')
  has(html, 'nested.md', 'the tree must reach a nested concept')
  has(html, 'Loading the body of docs/alpha.md.', 'the body of the selected file must be requested at once')
})

test('views: config renders the served configuration as a table and as raw json', async () => {
  const env = await bootLoaded()
  click(env, 'view', 'config')
  const table = env.main.innerHTML

  has(table, '.claude/major-tom.json &#183; schemaVersion 1', 'the bar must state the schema version it was given')
  has(table, '>project<', 'every top-level config key must become a section')
  has(table, 'fixture-project', 'a config value must be on screen')
  has(table, 'single', 'every value of a section must be rendered')
  has(table, 'planner, implementer, reviewer', 'a list value must be rendered as a list')
  assert.equal(railCount(env, 'config'), Object.keys(snapshotFixture().config).length,
    'the rail must count the config keys it was given')

  click(env, 'cfgmode', 'raw')
  const raw = env.main.innerHTML
  has(raw, '&quot;name&quot;: &quot;fixture-project&quot;', 'the raw mode must render the config as JSON')
  lacks(raw, '>project<', 'the table sections must be gone in raw mode')
})

test('views: the rail marks the selected view and counts what the data holds', async () => {
  const env = await bootLoaded()
  const snapshot = snapshotFixture()

  assert.equal(railCount(env, 'roadmap'), snapshot.roadmap.milestones.length)
  assert.equal(railCount(env, 'timeline'), snapshot.timeline.events.length + snapshot.git.length)
  assert.equal(railCount(env, 'git'), snapshot.git.length)
  assert.equal(railCount(env, 'knowledge'), snapshot.knowledge.files.length)
  has(env.rail.innerHTML, 'v0.19.0', 'the rail must state the plugin version from the config')

  has(env.rail.innerHTML, '<button class="navbtn active" data-act="view" data-v="overview"',
    'the rail must mark the view that is on screen')
  click(env, 'view', 'git')
  has(env.rail.innerHTML, '<button class="navbtn active" data-act="view" data-v="git"',
    'the mark must move with the selection')
  assert.deepEqual(env.history.replaced, ['#/git'], 'selecting a view must record it in the URL')
})

test('views: the payload the server serves renders both keys it does not carry as empty states', async () => {
  // config, decisions, generatedAt, git, knowledge and timeline: the six keys, and neither
  // roadmap nor lastRun. Both views have to state that honestly rather than break.
  const env = await bootLoaded({ snapshot: servedShape() })

  has(env.main.innerHTML, 'No runs recorded yet.', 'the lifecycle must state that it has no run to show')
  assert.equal(railCount(env, 'roadmap'), 0, 'the rail must count no milestones')
  click(env, 'view', 'roadmap')
  has(env.main.innerHTML, 'No roadmap data yet.', 'the roadmap view must state that it has nothing to show')
  click(env, 'view', 'git')
  has(env.main.innerHTML, '5 of 5 commits', 'the keys that are served must still render')
})

// ---------------------------------------------------------------------------
// Refresh
// ---------------------------------------------------------------------------

test('refresh: the control re-issues GET /api/snapshot', async () => {
  const env = await bootLoaded()
  assert.equal(env.net.countFor(SNAPSHOT_ROUTE), 1)

  click(env, 'refresh')
  assert.equal(env.net.countFor(SNAPSHOT_ROUTE), 2, 'refresh is the same request issued again (D43 point 5)')
  assert.equal(env.net.lastFor(SNAPSHOT_ROUTE).init.method, 'GET')
})

test('refresh: a request in flight cannot be turned into two overlapping ones', async () => {
  const env = await bootLoaded()
  click(env, 'refresh')

  // The visible half: the control says what it is doing and is disabled while it does it.
  const inFlight = controls(env, 'refresh')
  assert.ok(inFlight.length > 0, 'the refresh control must stay on screen while it works')
  for (const control of inFlight) {
    assert.equal(control.disabled, true, 'a refresh in flight must render its control disabled')
  }
  has(env.main.innerHTML, '>working<', 'the control must state that it is working')
  has(env.main.innerHTML, 'recomputing, last ', 'the pill must state that it is recomputing over data it has')

  // The half that actually holds: a click that reaches the handler anyway is refused.
  click(env, 'refresh', undefined, { force: true })
  assert.equal(env.net.countFor(SNAPSHOT_ROUTE), 2, 'a second click must not put a second request in the air')

  env.net.take(SNAPSHOT_ROUTE).json(200, snapshotFixture())
  await settle()
  for (const control of controls(env, 'refresh')) {
    assert.equal(control.disabled, false, 'the control must be usable again once the request landed')
  }
})

test('refresh: the pill states the new computation and the new data is on screen', async () => {
  const env = await bootLoaded()
  has(env.main.innerHTML, '(5 min ago)', 'the pill must state the computation the page loaded with')

  const next = snapshotFixture()
  next.generatedAt = ago(1 * MINUTE)
  next.git.unshift({
    hash: 'aaaabbbbccccdddd',
    date: ago(2 * MINUTE),
    author: 'Fixture Author',
    subject: 'feat(client): a commit that landed after the page loaded',
    add: 9,
    del: 1,
  })

  click(env, 'refresh')
  env.net.take(SNAPSHOT_ROUTE).json(200, next)
  await settle()

  has(env.main.innerHTML, '(1 min ago)', 'the pill must state the time of the new computation')
  lacks(env.main.innerHTML, '(5 min ago)', 'the pill must not still state the old one')
  has(env.main.innerHTML, 'feat(client): a commit that landed after the page loaded',
    'the recomputed data must be on screen')
  assert.equal(railCount(env, 'git'), next.git.length, 'the rail must count the recomputed data')
})

test('refresh: a failure over a loaded page states itself above the view it could not replace', async () => {
  const env = await bootLoaded()
  click(env, 'refresh')
  env.net.take(SNAPSHOT_ROUTE).json(500, { error: 'the repository moved under the server' })
  await settle()

  const html = env.main.innerHTML
  has(html, 'GET /api/snapshot failed', 'the banner must name the request that failed')
  has(html, 'the repository moved under the server', 'the banner must repeat the message the server sent')
  has(html, 'Showing the last snapshot that loaded.', 'the banner must say what is on screen')
  has(html, 'stale, last computed ', 'the pill must state that what is on screen is stale')
  // Blanking a good view because a later request failed would destroy what the user still has.
  has(html, 'feat(dashboard): fetch the snapshot over http', 'the loaded view must survive the failed refresh')
  lacks(html, '>no data<', 'the full error state belongs to a page that never loaded')

  click(env, 'refresh')
  env.net.take(SNAPSHOT_ROUTE).json(200, snapshotFixture())
  await settle()
  lacks(env.main.innerHTML, 'the repository moved under the server', 'a recovery must clear the banner')
})

// ---------------------------------------------------------------------------
// The knowledge body
// ---------------------------------------------------------------------------

test('body: selecting a file requests the id that the listing carries', async () => {
  const env = await bootLoaded()
  const snapshot = snapshotFixture()
  click(env, 'view', 'knowledge')

  // The default selection is the first entry, requested as soon as the view renders.
  const first = env.net.lastFor(BODY_ROUTE)
  assert.equal(first.route, BODY_ROUTE)
  assert.equal(first.id, fileByPath(snapshot, 'docs/alpha.md').id)
  first.json(200, { id: first.id, body: '# Alpha\n\nthe alpha body\n' })
  await settle()

  click(env, 'file', indexByPath(snapshot, 'memories/deep/nested.md'))
  const second = env.net.lastFor(BODY_ROUTE)
  assert.equal(second.id, fileByPath(snapshot, 'memories/deep/nested.md').id)
  assert.equal(env.net.countFor(BODY_ROUTE), 2, 'one selection is one request')
  // The id is opaque and carried, never built: no knowledge path may appear in the URL.
  lacks(second.url, 'memories', 'the client must address a body by its id and not by its path')
})

test('body: the fetched body renders in the file pane', async () => {
  const env = await bootLoaded()
  click(env, 'view', 'knowledge')
  has(env.main.innerHTML, 'Loading the body of docs/alpha.md.', 'the pane must state that it is loading')

  const request = env.net.lastFor(BODY_ROUTE)
  request.json(200, { id: request.id, body: '# Alpha\n\nthe alpha body\n' })
  await settle()

  has(env.main.innerHTML, '<pre class="body"># Alpha\n\nthe alpha body\n</pre>',
    'the body must render verbatim in the pane')
  lacks(env.main.innerHTML, 'Loading the body of', 'the loading state must be gone')
})

test('body: a body of nothing states that the file is frontmatter only', async () => {
  const env = await bootLoaded()
  click(env, 'view', 'knowledge')
  const request = env.net.lastFor(BODY_ROUTE)
  request.json(200, { id: request.id, body: '' })
  await settle()

  has(env.main.innerHTML, 'This file has no body: frontmatter only.',
    'an empty body is a statement, not an error')
})

test('body: a 404 renders the failure in the pane rather than leaving it blank', async () => {
  const env = await bootLoaded()
  click(env, 'view', 'knowledge')
  env.net.lastFor(BODY_ROUTE).json(404, { error: 'no knowledge file carries that id' })
  await settle()

  const html = env.main.innerHTML
  has(html, '>body unavailable<', 'the pane must state that the body is not there')
  has(html, 'no knowledge file carries that id', 'the pane must repeat the message the server sent')
  has(html, 'data-act="bodyretry"', 'the pane must offer a retry of its own')
  // The rest of the view is untouched: the tree and the frontmatter are not the body.
  has(html, 'alpha.md', 'the tree must survive a failed body')
  has(html, 'okf_version', 'the frontmatter must survive a failed body')

  click(env, 'bodyretry')
  assert.equal(env.net.countFor(BODY_ROUTE), 2, 'the retry must ask again')
  const retry = env.net.lastFor(BODY_ROUTE)
  retry.json(200, { id: retry.id, body: 'the body arrived on the second attempt' })
  await settle()
  has(env.main.innerHTML, 'the body arrived on the second attempt', 'the retry must be able to recover')
})

test('body: a response carrying another file body is refused', async () => {
  const env = await bootLoaded()
  click(env, 'view', 'knowledge')
  env.net.lastFor(BODY_ROUTE).json(200, { id: 'some-other-id', body: 'the wrong file' })
  await settle()

  has(env.main.innerHTML, 'the server answered with the body of a different file',
    'a body under the wrong id must never be shown')
  lacks(env.main.innerHTML, 'the wrong file', 'the refused body must not reach the screen')
})

test('body: a late response from an earlier selection never overwrites the later one', async () => {
  // The sequence number in the client is what this test exists to protect: clicking through
  // files faster than the server answers leaves earlier requests in flight, and one of them
  // landing afterwards would put one file's body under another file's name.
  const env = await bootLoaded()
  const snapshot = snapshotFixture()
  click(env, 'view', 'knowledge')

  const alpha = env.net.lastFor(BODY_ROUTE)
  assert.equal(alpha.id, fileByPath(snapshot, 'docs/alpha.md').id)

  click(env, 'file', indexByPath(snapshot, 'logs/session.md'))
  const session = env.net.lastFor(BODY_ROUTE)
  assert.equal(session.id, fileByPath(snapshot, 'logs/session.md').id)
  assert.equal(env.net.pending.filter((r) => r.route === BODY_ROUTE).length, 2,
    'both requests must be in the air for this test to mean anything')

  session.json(200, { id: session.id, body: 'the session body' })
  await settle()
  has(env.main.innerHTML, 'the session body', 'the latest selection must render when it lands')

  alpha.json(200, { id: alpha.id, body: 'the alpha body, answered last' })
  await settle()

  has(env.main.innerHTML, 'the session body', 'the later selection must still be what is on screen')
  lacks(env.main.innerHTML, 'the alpha body, answered last',
    'a response older than the selection must be dropped')
  has(env.main.innerHTML, '>logs/session.md<', 'the pane must still be titled with the selected file')
})

test('body: a late failure from an earlier selection never replaces a landed body', async () => {
  const env = await bootLoaded()
  const snapshot = snapshotFixture()
  click(env, 'view', 'knowledge')
  const alpha = env.net.lastFor(BODY_ROUTE)

  click(env, 'file', indexByPath(snapshot, 'toplevel.md'))
  const top = env.net.lastFor(BODY_ROUTE)
  top.json(200, { id: top.id, body: 'the toplevel body' })
  await settle()

  alpha.json(404, { error: 'no knowledge file carries that id' })
  await settle()

  has(env.main.innerHTML, 'the toplevel body', 'a stale failure must not blank a fresh success')
  lacks(env.main.innerHTML, '>body unavailable<', 'a stale failure must not be rendered at all')
})

test('body: an entry with no id states that its body cannot be fetched', async () => {
  // What a producer older than the body endpoint wrote: an entry with no id to ask with.
  const snapshot = snapshotFixture()
  delete snapshot.knowledge.files[1].id
  const env = await bootLoaded({ snapshot })
  click(env, 'view', 'knowledge')
  env.net.lastFor(BODY_ROUTE).json(200, { id: 'aa01', body: 'the alpha body' })
  await settle()

  const before = env.net.countFor(BODY_ROUTE)
  click(env, 'file', '1')

  assert.equal(env.net.countFor(BODY_ROUTE), before, 'an entry with no id must not be requested')
  has(env.main.innerHTML, 'This entry carries no id, so its body cannot be fetched.',
    'the pane must say why there is nothing to show')
  has(env.main.innerHTML, '>toplevel.md<', 'the entry is still selectable and still named')
})

test('body: a refresh re-fetches the body of the selected file', async () => {
  const env = await bootLoaded()
  click(env, 'view', 'knowledge')
  const first = env.net.lastFor(BODY_ROUTE)
  first.json(200, { id: first.id, body: 'the body as it was' })
  await settle()
  has(env.main.innerHTML, 'the body as it was', 'the first body must be on screen')

  click(env, 'refresh')
  env.net.take(SNAPSHOT_ROUTE).json(200, snapshotFixture())
  await settle()

  assert.equal(env.net.countFor(BODY_ROUTE), 2, 'the bodies may have moved with the rest of the data')
  const second = env.net.lastFor(BODY_ROUTE)
  assert.equal(second.id, first.id, 'the same file must be re-fetched')
  second.json(200, { id: second.id, body: 'the body as it is now' })
  await settle()
  has(env.main.innerHTML, 'the body as it is now', 'the re-fetched body must replace the old one')
})

test('body: re-rendering the knowledge view does not re-request the body it already has', async () => {
  const env = await bootLoaded()
  click(env, 'view', 'knowledge')
  const request = env.net.lastFor(BODY_ROUTE)
  request.json(200, { id: request.id, body: 'the alpha body' })
  await settle()

  click(env, 'view', 'git')
  click(env, 'view', 'knowledge')
  click(env, 'file', '0')

  assert.equal(env.net.countFor(BODY_ROUTE), 1, 'the request is issued for a change of file, not for a render')
  has(env.main.innerHTML, 'the alpha body', 'the body already fetched must still be on screen')
})

// ---------------------------------------------------------------------------
// The knowledge tree
// ---------------------------------------------------------------------------

// The group headings the tree rendered, in the order it rendered them.
function treeHeadings(env) {
  const out = []
  const re = /&#9656;<\/span><span>([^<]+)<\/span>/g
  let match
  while ((match = re.exec(env.main.innerHTML)) !== null) out.push(match[1])
  return out
}

test('tree: every entry gets exactly one button, including one outside the areas and one at the root', async () => {
  const env = await bootLoaded()
  const snapshot = snapshotFixture()
  click(env, 'view', 'knowledge')

  const buttons = controls(env, 'file')
  assert.equal(buttons.length, snapshot.knowledge.files.length,
    'the tree must hold one button per entry of knowledge.files[], never more and never fewer')

  // Every index appears exactly once, so no entry is dropped and none is rendered twice.
  const indexes = buttons.map((button) => button.v).sort()
  assert.deepEqual(indexes, snapshot.knowledge.files.map((file, i) => String(i)).sort())

  // The two entries a fixed area list used to drop: a directory nobody declared and the
  // bundle root itself.
  has(env.main.innerHTML, 'outside.md', 'a concept outside the five canonical areas must be reachable')
  has(env.main.innerHTML, 'toplevel.md', 'a concept at the bundle root must be reachable')

  // And they are reachable, not merely drawn.
  click(env, 'file', indexByPath(snapshot, 'notes/outside.md'))
  has(env.main.innerHTML, '>notes/outside.md<', 'the entry outside the areas must be selectable')
  click(env, 'file', indexByPath(snapshot, 'toplevel.md'))
  has(env.main.innerHTML, '>toplevel.md<', 'the entry at the bundle root must be selectable')
})

test('tree: the rail count equals the number of buttons the tree renders', async () => {
  const env = await bootLoaded()
  click(env, 'view', 'knowledge')

  assert.equal(railCount(env, 'knowledge'), controls(env, 'file').length,
    'the rail and the tree must state the same number by construction')
})

test('tree: the group headings appear in the documented order', async () => {
  const env = await bootLoaded()
  click(env, 'view', 'knowledge')

  // The canonical areas of section 11 first, in the order that section declares them and only
  // when they hold something, then every other directory in code-unit order, then the bundle
  // root last.
  assert.deepEqual(treeHeadings(env), [
    'memories/',
    'docs/',
    'runs/',
    'monitors/',
    'logs/',
    'notes/',
    '/ (bundle root)',
  ])
})

test('tree: an empty canonical area produces no heading, and a second unexpected directory sorts', async () => {
  const snapshot = snapshotFixture()
  snapshot.knowledge.files = [
    { id: 'x1', path: 'zeta/one.md', type: 'doc', size: 10, updated: ago(HOUR), frontmatter: { type: 'doc' } },
    { id: 'x2', path: 'logs/two.md', type: 'log', size: 10, updated: ago(HOUR), frontmatter: { type: 'log' } },
    { id: 'x3', path: 'alpha/three.md', type: 'doc', size: 10, updated: ago(HOUR), frontmatter: { type: 'doc' } },
    { id: 'x4', path: 'docs/four.md', type: 'doc', size: 10, updated: ago(HOUR), frontmatter: { type: 'doc' } },
  ]
  const env = await bootLoaded({ snapshot })
  click(env, 'view', 'knowledge')

  assert.deepEqual(treeHeadings(env), ['docs/', 'logs/', 'alpha/', 'zeta/'])
  assert.equal(controls(env, 'file').length, 4, 'the partition must still be one button per entry')
})

test('tree: the overview counts are the same partition, so the areas add up to the total', async () => {
  const env = await bootLoaded()
  const snapshot = snapshotFixture()
  const html = env.main.innerHTML

  const tiles = []
  const re = /<span class="sans" style="font-size:24px;font-weight:600;letter-spacing:-\.02em">(\d+)<\/span><span style="color:var\(--dim\);font-size:11px">([^<]*)<\/span>/g
  let match
  while ((match = re.exec(html)) !== null) tiles.push({ n: Number(match[1]), label: match[2] })

  const labels = tiles.map((tile) => tile.label)
  assert.deepEqual(labels, ['memories', 'docs', 'runs', 'monitors', 'logs', 'notes', '/ (bundle root)', 'concepts'],
    'the five canonical tiles are always present, then whatever else the bundle holds, then the total')

  const total = tiles[tiles.length - 1]
  assert.equal(total.label, 'concepts')
  assert.equal(total.n, snapshot.knowledge.files.length)
  const sum = tiles.slice(0, -1).reduce((acc, tile) => acc + tile.n, 0)
  assert.equal(sum, total.n, 'a file counted twice or dropped is exactly what this sum catches')
})

test('tree: an empty bundle states that it is empty', async () => {
  const snapshot = snapshotFixture()
  snapshot.knowledge.files = []
  const env = await bootLoaded({ snapshot })
  click(env, 'view', 'knowledge')

  has(env.main.innerHTML, 'The knowledge bundle is empty.', 'an empty bundle is a state, not a blank pane')
  assert.equal(env.net.countFor(BODY_ROUTE), 0, 'there is no file to request a body for')
})

// ---------------------------------------------------------------------------
// The chrome: theme, rail and the router
// ---------------------------------------------------------------------------

test('theme: the stored theme is what the page starts in', async () => {
  const env = await bootLoaded({ storage: { 'mt-theme': 'light' } })

  assert.equal(env.documentElement.dataset.theme, 'light', 'the stored theme must be stamped on the document')
  has(env.rail.innerHTML, '>light</span>', 'the rail must state the theme it is in')
  assert.deepEqual(env.media, [], 'a stored theme makes the media query unnecessary')
})

test('theme: with nothing stored the page follows the system preference', async () => {
  const light = await bootLoaded({ prefersLight: true })
  assert.equal(light.documentElement.dataset.theme, 'light')
  assert.deepEqual(light.media, ['(prefers-color-scheme: light)'])

  const dark = await bootLoaded({ prefersLight: false })
  assert.equal(dark.documentElement.dataset.theme, 'dark', 'dark is what the page falls back to')
})

test('theme: the toggle flips it, stores it and stamps the document element', async () => {
  const env = await bootLoaded({ storage: { 'mt-theme': 'dark' } })

  click(env, 'theme')
  assert.equal(env.documentElement.dataset.theme, 'light')
  assert.equal(env.storage.get('mt-theme'), 'light', 'the choice must survive a reload')
  has(env.rail.innerHTML, '>light</span>', 'the rail must state the new theme')

  click(env, 'theme')
  assert.equal(env.documentElement.dataset.theme, 'dark')
  assert.equal(env.storage.get('mt-theme'), 'dark')
})

test('rail: the collapse toggle stores the state and moves the collapsed class', async () => {
  const env = await bootLoaded()
  assert.equal(env.app.classList.contains('collapsed'), false, 'the rail starts open')

  click(env, 'rail')
  assert.equal(env.app.classList.contains('collapsed'), true, 'collapsing must reach the app element')
  assert.equal(env.storage.get('mt-rail'), '0', 'the choice must survive a reload')

  click(env, 'rail')
  assert.equal(env.app.classList.contains('collapsed'), false)
  assert.equal(env.storage.get('mt-rail'), '1')

  const collapsed = await bootLoaded({ storage: { 'mt-rail': '0' } })
  assert.equal(collapsed.app.classList.contains('collapsed'), true, 'a stored collapse must be honoured at boot')
})

test('router: the initial hash selects the view before any data arrives', async () => {
  const env = boot({ hash: '#/config' })
  has(env.main.innerHTML, '<h1 class="sans">config</h1>', 'the hash must pick the view even while loading')

  env.net.take(SNAPSHOT_ROUTE).json(200, snapshotFixture())
  await settle()
  has(env.main.innerHTML, 'fixture-project', 'the view the hash asked for must be the one that renders')
})

test('router: a hashchange switches the view, and an unknown hash changes nothing', async () => {
  const env = await bootLoaded()

  env.location.hash = '#/timeline'
  env.fireOnWindow('hashchange', {})
  has(env.main.innerHTML, '<h1 class="sans">timeline</h1>', 'a hashchange must switch the view')

  env.location.hash = '#/nowhere'
  env.fireOnWindow('hashchange', {})
  has(env.main.innerHTML, '<h1 class="sans">timeline</h1>', 'a hash naming no view must leave the page alone')
})

test('delegation: a click that lands on no control changes nothing', async () => {
  const env = await bootLoaded()
  const railRenders = env.rail.renders
  const mainRenders = env.main.renders

  clickNowhere(env)

  assert.equal(env.rail.renders, railRenders, 'a click on nothing must not re-render the rail')
  assert.equal(env.main.renders, mainRenders, 'a click on nothing must not re-render the main area')
  assert.equal(env.net.calls.length, 1, 'a click on nothing must not talk to the server')
})
