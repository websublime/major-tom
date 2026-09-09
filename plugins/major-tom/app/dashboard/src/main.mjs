// Bootstrap: chrome (rail + header), the load lifecycle, view dispatch, event delegation,
// router.
//
// The page boots asynchronously now (D43 point 7). It used to be able to render at module
// load, because the data was already in the document; with the data behind a fetch it renders
// the chrome and a loading state first, then the views once the snapshot is stored. Nothing
// below ever dispatches a view against an absent snapshot, and a failed fetch is a rendered
// state rather than a console message: D43 point 2 removed the degraded path, so there is no
// embedded copy behind the failure and the error state is the only thing left to show.
//
// This module is also the only one that talks to api.mjs. The views stayed pure string
// builders: they read state and never fetch, so the knowledge body request is issued here on
// their behalf and parked in S.

import { fetchKnowledgeBody, fetchSnapshot } from './api.mjs'
import { cfg, clock, commits, files, generatedAt, rel, roadmap, setData, timeline } from './data.mjs'
import { S, VIEWS, subtitles } from './state.mjs'
import { esc } from './ui.mjs'
import { vOverview } from './views/overview.mjs'
import { vRoadmap } from './views/roadmap.mjs'
import { vTimeline, timelineStream } from './views/timeline.mjs'
import { vGit } from './views/git.mjs'
import { vKnowledge } from './views/knowledge.mjs'
import { vConfig } from './views/config.mjs'

const VIEW_FN = { overview: vOverview, roadmap: vRoadmap, timeline: vTimeline, git: vGit, knowledge: vKnowledge, config: vConfig }

function renderRail() {
  const config = cfg()
  const version = config.onboard && config.onboard.pluginVersion ? 'v' + config.onboard.pluginVersion : ''
  const items = [
    ['overview', '■', ''], ['roadmap', '≡', roadmap().length || ''], ['timeline', '⧖', timelineStream().length || ''],
    ['git', '⎇', commits().length || ''], ['knowledge', '▤', files().length || ''],
    ['config', '{ }', Object.keys(config).length || '']
  ]
  document.getElementById('rail').innerHTML =
    '<div class="brand"><span class="brand-badge">MT</span>'
    + '<span class="brand-name rail-label">major tom</span>'
    + (version ? '<span class="count rail-label">' + esc(version) + '</span>' : '')
    + '</div><div class="rail-nav">'
    + items.map(function (it) {
      return '<button class="navbtn ' + (S.view === it[0] ? 'active' : '') + '" data-act="view" data-v="' + it[0] + '" title="' + it[0] + '">'
        + '<span class="glyph">' + it[1] + '</span><span class="rail-label">' + it[0] + '</span>'
        + (it[2] !== '' ? '<span class="count rail-label">' + it[2] + '</span>' : '') + '</button>'
    }).join('')
    + '</div><div class="rail-foot">'
    + '<button class="navbtn" data-act="theme" title="Theme"><span class="glyph">' + (S.theme === 'light' ? '◑' : '◐') + '</span><span class="rail-label">' + S.theme + '</span></button>'
    + '<button class="navbtn" data-act="rail" title="Collapse"><span class="glyph">' + (S.rail ? '«' : '»') + '</span><span class="rail-label">collapse</span></button>'
    + '</div>'
}

// The time of the last computation, which is what generatedAt now means: the server stamps it
// when it computes, and it moves on every refresh instead of being frozen at onboard time.
function computedTime() {
  const at = generatedAt()
  if (!at) return 'n/a'
  const hm = clock(at)
  return hm ? hm + ' (' + rel(at) + ')' : String(at)
}

function statusLabel() {
  if (S.busy) return S.hasData ? 'recomputing, last ' + computedTime() : 'computing'
  if (S.status === 'failed') return S.hasData ? 'stale, last computed ' + computedTime() : 'not computed'
  return 'computed ' + computedTime()
}

// The square states the colour and the motion separately, because they answer different
// questions. The colour is where the page stands and the pulse is whether a request is in the
// air, so a retry over a failed page pulses in the failure colour instead of hiding it.
function statusSquare() {
  const colour = S.status === 'failed' ? 'neg' : S.busy ? 'active' : 'done'
  return S.busy ? colour + ' busy' : colour
}

// The window control of D45, a header cell beside the status cell and the refresh control and
// deliberately not inside a view. The window cuts two of the six views, the timeline and
// git, so it belongs where the page's global state already lives and where a reader on any view
// can see which window is in force. Inside one of those two views it would read as that view's
// own setting, which is precisely the reading D42 and D45 point 4 exist to prevent: one window
// cuts both streams, and a control that looked like the timeline's would suggest the git side
// has another.
//
// The control is two fields and an explicit apply, and the fields do not fetch as they change.
// A reader typing a window one character at a time passes through "3", "36" and "365", and each
// of those is a different window a live field would go and fetch, so two requests nobody asked
// for would land before the one that was meant, and the first of them would come back refused.
// Debouncing would only make that wrong answer arrive later. The submit removes the whole class
// of problem instead of timing around it, and it is the same act that carries both numbers in
// one request, so days and limit cannot drift apart. Enter in either field submits too, since a
// pair of fields with a button beside them is a form and behaves like one.
//
// Nothing here validates a number. An invalid value sits in its field until it is submitted and
// is then refused by the server, which is the only holder of the bounds (D45 point 2); a copy of
// them in this file would be a second source of truth for one rule and would put a sentence
// written here in front of the reader instead of the server's own, which names the parameter,
// the value received and the accepted range.
//
// It renders only once a snapshot has landed. Before that there is no effective window to state
// and the fields would be a pair of empty boxes whose apply could produce nothing but a refusal,
// which is an invitation rather than a control.
function windowHtml() {
  if (!S.hasData) return ''
  const d = S.windowDraft
  const field = function (id, key, label) {
    return '<input id="' + id + '" class="win-in" type="text" inputmode="numeric" autocomplete="off"'
      + ' aria-label="' + label + '" title="' + label + '" placeholder="' + label + '"'
      + ' value="' + esc(d[key]) + '">'
  }
  return '<span class="cell" title="The window the timeline and the git streams are both read over">'
    + '<span class="fg-dimmer">window</span>'
    + field('win-days', 'days', 'days') + '<span class="fg-dimmer">d</span>'
    + field('win-limit', 'limit', 'limit') + '<span class="fg-dimmer">events</span>'
    + '<button class="btn" data-act="window" title="Apply this window to both streams"'
    + (S.busy ? ' disabled' : '') + '>' + (S.windowBusy ? 'applying' : 'apply') + '</button></span>'
}

// A refused window is stated in a full-width strip under the header the control sits in. This is
// a correction and it is built to read as one: it names what was refused, repeats the server's
// own sentence, and says that the page did not move, which is the fact that separates it from
// every state below. It carries no retry, because fixing the number and applying again is the
// retry. The strip spans the page so the server's sentence wraps instead of stretching the header.
//
// The window it states as still showing is read from the snapshot on screen, not from the
// fields, which are holding the value that was just refused. The two disagree at exactly this
// moment and only here, so the sentence that resolves them belongs here and nowhere else.
function windowErrorHtml() {
  if (!S.windowError) return ''
  const w = timeline().window
  const showing = w && w.days != null && w.ceilingEvents != null
    ? 'Still showing the last window that was accepted: ' + esc(String(w.days)) + ' days, '
      + esc(String(w.ceilingEvents)) + ' events.'
    : 'The window on screen did not change.'
  return '<div class="strip">'
    + '<span class="strip-label">window refused</span>'
    + '<span class="msg fg-neg">' + esc(S.windowError) + '</span>'
    + '<span class="fg-dimmer">' + showing + '</span></div>'
}

// The header status cell of D43 point 5: the time of the last computation, the square that
// states what the page is doing, and the refresh control beside them. Refresh is the same
// GET /api/snapshot issued again, because the server keeps no cache and has no recompute verb.
// While a request is in flight the control says so and is disabled; loadSnapshot refuses a
// second one anyway, so two clicks can never put two requests in the air.
//
// The cells run left to right in widening scope: what the project is, how it is worked, the
// window it is read over, and the state of the reading.
function headerHtml() {
  const config = cfg()
  const p = config.project || {}
  const ex = config.execution || {}
  const teamCell = ex.workingModel === 'team' && ex.team
    ? 'team &#183; ' + ((ex.team.members || []).length) + ' + coordinator'
    : esc(ex.workingModel || '')
  return '<header class="top">'
    + '<h1 class="sans">' + esc(S.view) + '</h1>'
    + '<span class="top-sep">/</span>'
    + '<span class="top-sub">' + esc(subtitles()[S.view]) + '</span>'
    + '<div class="top-cells">'
    + (p.name ? '<span class="cell">' + esc(p.name) + (p.topology ? ' &#183; ' + esc(p.topology) : '') + '</span>' : '')
    + (teamCell ? '<span class="cell">' + teamCell + '</span>' : '')
    + windowHtml()
    + '<span class="cell"><span class="sq ' + statusSquare() + '"></span>'
    + esc(statusLabel())
    + '<button class="btn" data-act="refresh" title="Recompute the snapshot on the server"'
    + (S.busy ? ' disabled' : '') + '>' + (S.busy ? 'working' : 'refresh') + '</button></span>'
    + '</div></header>'
}

function loadingPanel() {
  return '<section class="panel"><div class="panel-head"><span class="eyebrow">loading</span>'
    + '<span class="sq active busy push"></span></div>'
    + '<div class="empty">Computing the snapshot on the server and fetching it.</div></section>'
}

// The whole main area when no snapshot has ever loaded. It names the request that failed and
// repeats the message the server sent, because that message is the only diagnosis the user
// gets: there is no island behind this page and no stale copy to show instead.
function errorPanel() {
  return '<section class="panel"><div class="panel-head"><span class="eyebrow">no data</span>'
    + '<span class="panel-meta fg-neg">' + esc(S.errorRoute || 'the request') + ' failed</span></div>'
    + '<div class="pad prose">'
    + 'The dashboard could not load its data, so there is nothing to show. This page carries no '
    + 'embedded copy to fall back on: the server computes the data on every request.</div>'
    + '<div class="pad quote sep">'
    + esc(S.error || 'the request failed and said nothing about why') + '</div>'
    + '<div class="pad tools sep">'
    + '<button class="btn" data-act="refresh"' + (S.busy ? ' disabled' : '') + '>' + (S.busy ? 'retrying' : 'retry') + '</button>'
    + '<span class="fg-dimmer small">If the server is not running, start it with /major-tom:dashboard.</span>'
    + '</div></section>'
}

// A failed refresh over a snapshot that did load is a different situation: blanking a good
// view because a later request failed would destroy information the user still has. The
// failure is stated above the view it did not manage to replace.
function errorBanner() {
  return '<section class="panel banner">'
    + '<span class="fg-neg small">' + esc(S.errorRoute || 'the request') + ' failed</span>'
    + '<span class="msg fg-dim small">' + esc(S.error) + '</span>'
    + '<span class="fg-dimmer small">Showing the last snapshot that loaded.</span>'
    + '<button class="btn" data-act="refresh"' + (S.busy ? ' disabled' : '') + '>' + (S.busy ? 'retrying' : 'retry') + '</button></section>'
}

function mainBody() {
  if (!S.hasData) return S.status === 'failed' ? errorPanel() : loadingPanel()
  if (S.view === 'knowledge') syncBody()
  return (S.status === 'failed' ? errorBanner() : '') + VIEW_FN[S.view]()
}

// Keeps the fetched body in step with the selected file. Called from renderMain rather than
// from the view, so views stay pure, and idempotent: it only issues a request when the
// selected file's id is not the one already requested. A refresh resets bodyStatus to idle,
// which is what makes the displayed body reload with the rest of the data.
function syncBody() {
  const list = files()
  const f = list[S.file] || list[0]
  const id = f && typeof f.id === 'string' && f.id !== '' ? f.id : ''
  if (!id) {
    if (S.bodyStatus === 'noid' && S.bodyId === '') return
    S.bodySeq += 1
    S.bodyId = ''
    S.bodyStatus = 'noid'
    S.bodyText = ''
    S.bodyError = ''
    return
  }
  if (id === S.bodyId && S.bodyStatus !== 'idle') return
  requestBody(id)
}

function requestBody(id) {
  S.bodySeq += 1
  S.bodyId = id
  S.bodyStatus = 'loading'
  S.bodyText = ''
  S.bodyError = ''
  const seq = S.bodySeq
  fetchKnowledgeBody(id).then(function (r) {
    // Only the request issued last may write here. Clicking through files faster than the
    // server answers leaves earlier requests in flight, and one of them landing afterwards
    // would put one file's body under another file's name. Comparing sequence numbers rather
    // than ids also covers re-selecting the same file, where the ids would match and a stale
    // failure could still overwrite a fresh success.
    if (seq !== S.bodySeq) return
    if (!r.ok) {
      S.bodyStatus = 'failed'
      S.bodyError = r.error
    } else if (r.data === null || typeof r.data !== 'object' || typeof r.data.body !== 'string') {
      S.bodyStatus = 'failed'
      S.bodyError = 'the server answered ' + r.status + ' without a body for this file'
    } else if (typeof r.data.id === 'string' && r.data.id !== id) {
      S.bodyStatus = 'failed'
      S.bodyError = 'the server answered with the body of a different file'
    } else {
      S.bodyStatus = 'ready'
      S.bodyText = r.data.body
    }
    renderMain()
  })
}

// The two window fields, bound after every render because assigning innerHTML destroyed the
// previous pair along with their listeners.
//
// Typing stores the draft and renders nothing. That is the deliberate half: the git filter
// beside it re-renders on every keystroke because it filters data the page already holds, while
// a keystroke here changes nothing that is on screen until the window is applied, so re-rendering
// would only cost the caret its place and force the focus dance that filter needs. It also means
// a reader typing "365" issues no request at all until they submit.
function bindWindowFields() {
  const bind = function (id, key) {
    const el = document.getElementById(id)
    if (!el) return
    el.addEventListener('input', function (e) { S.windowDraft[key] = e.target.value })
    el.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return
      S.windowDraft[key] = e.target.value
      applyWindow()
    })
  }
  bind('win-days', 'days')
  bind('win-limit', 'limit')
}

// The main area is a fixed header, the refusal strip when there is one, and the scrolling body
// the view is rendered into.
function renderMain() {
  document.getElementById('main').innerHTML =
    headerHtml() + windowErrorHtml() + '<div class="view">' + mainBody() + '</div>'
  bindWindowFields()
  const q = document.getElementById('git-q')
  if (q) {
    q.addEventListener('input', function (e) {
      S.query = e.target.value
      renderMain()
      const q2 = document.getElementById('git-q')
      q2.focus()
      q2.setSelectionRange(q2.value.length, q2.value.length)
    })
  }
}

function render() {
  document.title = 'Major Tom: ' + ((cfg().project || {}).name || 'dashboard')
  document.getElementById('app').classList.toggle('collapsed', !S.rail)
  renderRail()
  renderMain()
}

// The fields follow the snapshot, never a constant: the window a landed snapshot reports is the
// effective one the server applied (D45), so reading the control tells the reader what is on
// screen. A snapshot from a producer older than the timeline key states no window at all, and
// the fields then say so by being empty rather than by inventing a number this page does not
// know.
function syncWindowDraft() {
  const w = timeline().window
  S.windowDraft = {
    days: w && w.days != null ? String(w.days) : '',
    limit: w && w.ceilingEvents != null ? String(w.ceilingEvents) : ''
  }
}

// The load, the refresh, the retry and a window change are one function, because on the server
// they are one request: GET /api/snapshot recomputes every time and there is no separate
// recompute verb (D43 point 5). The busy flag is what stops overlapping requests, for the window
// control exactly as for the refresh one; the disabled controls are only the visible half of it.
//
// `requested` tells the four apart where they differ. Undefined means carry the window already
// in force, which is the boot (none), a refresh and a retry; an object means the reader submitted
// that window. The distinction is what decides how a refusal is read, below.
function loadSnapshot(requested) {
  if (S.busy) return
  const win = requested === undefined ? S.window : requested
  S.busy = true
  S.windowBusy = requested !== undefined
  // The previous refusal is about a value that is no longer the one being asked for.
  S.windowError = ''
  render()
  fetchSnapshot(win).then(function (r) {
    S.busy = false
    S.windowBusy = false
    if (r.ok) {
      try {
        setData(r.data)
        S.hasData = true
        S.status = 'ready'
        S.error = ''
        S.errorRoute = ''
        // Only an accepted window becomes the one in force, so a refused one never quietly
        // rides along on the next refresh. It stays null until the reader chooses, which is
        // what keeps a reload on the configured default.
        S.window = win
        syncWindowDraft()
        // The bodies on the server may have moved with the rest of the data, so whatever is
        // on screen is re-fetched rather than kept.
        S.bodyStatus = 'idle'
      } catch (e) {
        S.status = 'failed'
        S.errorRoute = 'GET ' + r.route
        S.error = 'the response could not be read as a snapshot (' + (e && e.message ? e.message : String(e)) + ')'
      }
    } else if (win !== null && r.status === 400) {
      // The line between a correction and a failure of the page, which is the one judgement in
      // this control. A 400 answering a request that carried a window is the server refusing an
      // input the reader typed: the repository is fine, the server is fine, the snapshot on
      // screen is exactly as valid as it was a second ago, and the single thing that has to
      // change is a number in a field a few pixels away. Blanking the page into the D48 error
      // state would destroy a good view to report a typo, and would offer a retry of the very
      // request that was refused. So this touches none of the page's error state: not `status`,
      // not `error`, not `hasData`, and not the draft, which keeps the refused value so it can
      // be corrected in place. The message renders at the control.
      //
      // Routed on the request rather than on the status alone, deliberately. What makes a
      // refusal correctable is that the reader supplied the input that was refused, and the
      // window is the only input this page ever sends with a snapshot request. A 400 answering
      // a request that carried no window says something is wrong with a request the reader did
      // not compose, which is not correctable at this control and belongs in the states below.
      S.windowError = r.error
    } else {
      S.status = 'failed'
      S.errorRoute = 'GET ' + r.route
      S.error = r.error
    }
    render()
  })
}

// The submit of the window control: both numbers, one request, always. Reading them out of the
// draft here rather than off the two elements is what makes that true of every path into it,
// the button and the Enter key alike.
function applyWindow() {
  loadSnapshot({ days: S.windowDraft.days, limit: S.windowDraft.limit })
}

document.addEventListener('click', function (e) {
  const btn = e.target.closest('[data-act]')
  if (!btn) return
  const act = btn.getAttribute('data-act')
  const v = btn.getAttribute('data-v')
  if (act === 'view') { S.view = v; history.replaceState(null, '', '#/' + v); render() }
  else if (act === 'filter') { S.filter = v; renderMain() }
  else if (act === 'file') { S.file = Number(v); renderMain() }
  else if (act === 'cfgmode') { S.configMode = v; renderMain() }
  else if (act === 'refresh') { loadSnapshot() }
  else if (act === 'window') { applyWindow() }
  else if (act === 'bodyretry') { S.bodyStatus = 'idle'; renderMain() }
  else if (act === 'theme') {
    S.theme = S.theme === 'light' ? 'dark' : 'light'
    localStorage.setItem('mt-theme', S.theme)
    document.documentElement.dataset.theme = S.theme
    render()
  } else if (act === 'rail') {
    S.rail = !S.rail
    localStorage.setItem('mt-rail', S.rail ? '1' : '0')
    render()
  }
})

window.addEventListener('hashchange', function () {
  const h = (location.hash || '').replace(/^#\/?/, '')
  if (VIEWS.indexOf(h) !== -1) { S.view = h; render() }
})

document.documentElement.dataset.theme = S.theme
// The first render happens inside this call, before the fetch is issued, so the loading state
// is on screen while the request is in flight.
loadSnapshot()
