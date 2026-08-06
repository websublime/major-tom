// Bootstrap: chrome (rail + header), view dispatch, event delegation, router.

import { CFG, COMMITS, DATA, FILES, ROADMAP } from './data.mjs'
import { S, SUBTITLES, VIEWS } from './state.mjs'
import { esc } from './ui.mjs'
import { vOverview } from './views/overview.mjs'
import { vRoadmap } from './views/roadmap.mjs'
import { vGit } from './views/git.mjs'
import { vKnowledge } from './views/knowledge.mjs'
import { vConfig } from './views/config.mjs'

const VIEW_FN = { overview: vOverview, roadmap: vRoadmap, git: vGit, knowledge: vKnowledge, config: vConfig }

function renderRail() {
  const items = [
    ['overview', '◈', ''], ['roadmap', '⌗', ROADMAP.length || ''], ['git', '⎇', COMMITS.length || ''],
    ['knowledge', '▤', FILES.length || ''], ['config', '{ }', Object.keys(CFG).length || '']
  ]
  document.getElementById('rail').innerHTML =
    '<div class="brand"><div class="brand-badge">MT</div>'
    + '<div class="rail-label" style="display:flex;flex-direction:column">'
    + '<span class="sans" style="font-size:14px;font-weight:600;letter-spacing:-.01em">Major Tom</span>'
    + '<span style="font-size:10.5px;color:var(--dimmer)">' + esc(CFG.onboard && CFG.onboard.pluginVersion ? 'v' + CFG.onboard.pluginVersion : '') + '</span></div></div>'
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

function renderMain() {
  const p = CFG.project || {}
  const ex = CFG.execution || {}
  const teamPill = ex.workingModel === 'team' && ex.team
    ? 'team &#183; ' + ((ex.team.members || []).length) + ' + coordinator'
    : esc(ex.workingModel || '')
  document.getElementById('main').innerHTML =
    '<header class="top"><div style="display:flex;flex-direction:column;gap:2px;min-width:0">'
    + '<h1 class="sans">' + esc(S.view) + '</h1>'
    + '<span style="color:var(--dim);font-size:12px">' + esc(SUBTITLES[S.view]) + '</span></div>'
    + '<div style="display:flex;align-items:center;gap:8px;margin-left:auto;flex-wrap:wrap">'
    + '<span class="pill"><span class="dot pulse"></span>snapshot ' + esc(DATA.generatedAt || 'n/a') + '</span>'
    + (p.name ? '<span class="pill">' + esc(p.name) + (p.topology ? ' &#183; ' + esc(p.topology) : '') + '</span>' : '')
    + (teamPill ? '<span class="pill accent">' + teamPill + '</span>' : '')
    + '</div></header>' + VIEW_FN[S.view]()
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
  document.getElementById('app').classList.toggle('collapsed', !S.rail)
  renderRail()
  renderMain()
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
document.title = 'Major Tom: ' + ((CFG.project || {}).name || 'dashboard')
render()
