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
import { cfg, clock, commits, files, generatedAt, rel, roadmap, setData } from './data.mjs'
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
  const items = [
    ['overview', '◈', ''], ['roadmap', '⌗', roadmap().length || ''], ['timeline', '⧖', timelineStream().length || ''],
    ['git', '⎇', commits().length || ''], ['knowledge', '▤', files().length || ''],
    ['config', '{ }', Object.keys(config).length || '']
  ]
  document.getElementById('rail').innerHTML =
    '<div class="brand"><div class="brand-badge">MT</div>'
    + '<div class="rail-label" style="display:flex;flex-direction:column">'
    + '<span class="sans" style="font-size:14px;font-weight:600;letter-spacing:-.01em">Major Tom</span>'
    + '<span style="font-size:10.5px;color:var(--dimmer)">' + esc(config.onboard && config.onboard.pluginVersion ? 'v' + config.onboard.pluginVersion : '') + '</span></div></div>'
    + items.map(function (it) {
      return '<button class="navbtn ' + (S.view === it[0] ? 'active' : '') + '" data-act="view" data-v="' + it[0] + '" title="' + it[0] + '">'
        + '<span class="glyph">' + it[1] + '</span><span class="rail-label">' + it[0] + '</span>'
        + (it[2] !== '' ? '<span class="count rail-label">' + it[2] + '</span>' : '') + '</button>'
    }).join('')
    + '<div style="margin-top:auto;display:flex;flex-direction:column;gap:6px">'
    + '<button class="navbtn" data-act="theme" title="Theme"><span style="flex:0 0 22px;text-align:center">' + (S.theme === 'light' ? '◑' : '◐') + '</span><span class="rail-label">' + S.theme + '</span></button>'
    + '<button class="navbtn" data-act="rail" title="Collapse"><span style="flex:0 0 22px;text-align:center">' + (S.rail ? '«' : '»') + '</span><span class="rail-label">collapse</span></button>'
    + '</div>'
}

// The time of the last computation, which is what generatedAt now means: the server stamps it
// when it computes, and it moves on every refresh instead of being frozen at onboard time.
function pillTime() {
  const at = generatedAt()
  if (!at) return 'n/a'
  const hm = clock(at)
  return hm ? hm + ' (' + rel(at) + ')' : String(at)
}

function pillLabel() {
  if (S.busy) return S.hasData ? 'recomputing, last ' + pillTime() : 'computing'
  if (S.status === 'failed') return S.hasData ? 'stale, last computed ' + pillTime() : 'not computed'
  return 'computed ' + pillTime()
}

// The header pill of D43 point 5: the time of the last computation with the refresh control
// beside it, in the pill that used to read "snapshot <generatedAt>". Refresh is the same
// GET /api/snapshot issued again, because the server keeps no cache and has no recompute verb.
// While a request is in flight the control says so and is disabled; loadSnapshot refuses a
// second one anyway, so two clicks can never put two requests in the air.
function headerHtml() {
  const config = cfg()
  const p = config.project || {}
  const ex = config.execution || {}
  const teamPill = ex.workingModel === 'team' && ex.team
    ? 'team &#183; ' + ((ex.team.members || []).length) + ' + coordinator'
    : esc(ex.workingModel || '')
  return '<header class="top"><div style="display:flex;flex-direction:column;gap:2px;min-width:0">'
    + '<h1 class="sans">' + esc(S.view) + '</h1>'
    + '<span style="color:var(--dim);font-size:12px">' + esc(subtitles()[S.view]) + '</span></div>'
    + '<div style="display:flex;align-items:center;gap:8px;margin-left:auto;flex-wrap:wrap">'
    + '<span class="pill"><span class="dot' + (S.busy ? ' pulse' : '') + '"' + (S.status === 'failed' ? ' style="background:var(--stop)"' : '') + '></span>'
    + esc(pillLabel())
    + '<button class="pill-btn" data-act="refresh" title="Recompute the snapshot on the server"'
    + (S.busy ? ' disabled' : '') + '>' + (S.busy ? 'working' : 'refresh') + '</button></span>'
    + (p.name ? '<span class="pill">' + esc(p.name) + (p.topology ? ' &#183; ' + esc(p.topology) : '') + '</span>' : '')
    + (teamPill ? '<span class="pill accent">' + teamPill + '</span>' : '')
    + '</div></header>'
}

function loadingPanel() {
  return '<section class="panel"><div class="panel-head"><span class="eyebrow">loading</span>'
    + '<span class="dot pulse" style="margin-left:auto"></span></div>'
    + '<div class="empty">Computing the snapshot on the server and fetching it.</div></section>'
}

// The whole main area when no snapshot has ever loaded. It names the request that failed and
// repeats the message the server sent, because that message is the only diagnosis the user
// gets: there is no island behind this page and no stale copy to show instead.
function errorPanel() {
  return '<section class="panel"><div class="panel-head"><span class="eyebrow">no data</span>'
    + '<span class="chip" style="color:var(--stop)">' + esc(S.errorRoute || 'the request') + ' failed</span></div>'
    + '<div style="padding:2px 2px 12px 2px;font-size:13px;line-height:1.7">'
    + 'The dashboard could not load its data, so there is nothing to show. This page carries no '
    + 'embedded copy to fall back on: the server computes the data on every request.</div>'
    + '<div class="tile" style="padding:14px 16px;color:var(--stop);font-size:12.5px;line-height:1.7;word-break:break-word">'
    + esc(S.error || 'the request failed and said nothing about why') + '</div>'
    + '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding-top:14px">'
    + '<button class="btn" data-act="refresh"' + (S.busy ? ' disabled' : '') + '>' + (S.busy ? 'retrying' : 'retry') + '</button>'
    + '<span style="color:var(--dimmer);font-size:11.5px">If the server is not running, start it with /major-tom:dashboard.</span>'
    + '</div></section>'
}

// A failed refresh over a snapshot that did load is a different situation: blanking a good
// view because a later request failed would destroy information the user still has. The
// failure is stated above the view it did not manage to replace.
function errorBanner() {
  return '<section class="panel" style="border-color:var(--accent-line);padding:12px 16px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">'
    + '<span class="chip" style="color:var(--stop)">' + esc(S.errorRoute || 'the request') + ' failed</span>'
    + '<span style="flex:1 1 220px;min-width:0;color:var(--dim);font-size:12px;word-break:break-word">' + esc(S.error) + '</span>'
    + '<span style="color:var(--dimmer);font-size:11.5px">Showing the last snapshot that loaded.</span>'
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

function renderMain() {
  document.getElementById('main').innerHTML = headerHtml() + mainBody()
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

// The load, the refresh and the retry are one function, because on the server they are one
// request: GET /api/snapshot recomputes every time and there is no separate recompute verb
// (D43 point 5). The busy flag is what stops overlapping requests; the disabled control is
// only the visible half of it.
function loadSnapshot() {
  if (S.busy) return
  S.busy = true
  render()
  fetchSnapshot().then(function (r) {
    S.busy = false
    if (r.ok) {
      try {
        setData(r.data)
        S.hasData = true
        S.status = 'ready'
        S.error = ''
        S.errorRoute = ''
        // The bodies on the server may have moved with the rest of the data, so whatever is
        // on screen is re-fetched rather than kept.
        S.bodyStatus = 'idle'
      } catch (e) {
        S.status = 'failed'
        S.errorRoute = 'GET ' + r.route
        S.error = 'the response could not be read as a snapshot (' + (e && e.message ? e.message : String(e)) + ')'
      }
    } else {
      S.status = 'failed'
      S.errorRoute = 'GET ' + r.route
      S.error = r.error
    }
    render()
  })
}

document.addEventListener('click', function (e) {
  const btn = e.target.closest('[data-act]')
  if (!btn) return
  const act = btn.getAttribute('data-act')
  const v = btn.getAttribute('data-v')
  if (act === 'view') { S.view = v; history.replaceState(null, '', '#/' + v); render() }
  else if (act === 'layout') { S.layout = v; renderMain() }
  else if (act === 'filter') { S.filter = v; renderMain() }
  else if (act === 'file') { S.file = Number(v); renderMain() }
  else if (act === 'cfgmode') { S.configMode = v; renderMain() }
  else if (act === 'refresh') { loadSnapshot() }
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
