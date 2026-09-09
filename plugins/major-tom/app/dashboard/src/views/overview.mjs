// Overview: the lifecycle strip, then the roadmap brief beside the knowledge counts, the
// activity strip across both columns, and git history beside the decisions. Sections without a
// data producer render empty states.

import { commits, counts, decisions, lastRun, roadmap, root } from '../data.mjs'
import { commitRow, decisionRow, esc, milestoneVm, phaseVms } from '../ui.mjs'
import { timelineRow, timelineStream } from './timeline.mjs'

// The right side of the lifecycle head names the phase the run sits on. With no phase active it
// states how far the run got instead.
function lifecycleMeta(phases, run) {
  const at = phases.findIndex(function (p) { return p.status === 'active' })
  const tail = run.duration ? ' &#183; ' + esc(run.duration) : ''
  if (at === -1) {
    const done = phases.filter(function (p) { return p.status === 'done' }).length
    return done + '/' + phases.length + ' done' + tail
  }
  return 'phase ' + (at + 1) + '/' + phases.length + ' &#183; ' + esc(phases[at].name) + tail
}

function lifecyclePanel() {
  const phases = phaseVms()
  const run = lastRun()
  if (!phases || !phases.length) {
    return '<section class="panel"><div class="panel-head"><span class="eyebrow">lifecycle</span></div>'
      + '<div class="empty">No runs recorded yet. The lifecycle tiles light up when workflow runs start writing phase records.</div>'
      + '</section>'
  }
  return '<section class="panel"><div class="panel-head">'
    + '<span class="eyebrow">lifecycle</span>'
    + '<span class="panel-note">' + esc(run.id || '') + '</span>'
    + '<span class="panel-meta">' + lifecycleMeta(phases, run) + '</span></div>'
    + '<div class="phases">'
    + phases.map(function (p) {
      return '<div class="phase' + (p.status === 'active' ? ' on' : '') + '">'
        + '<div class="phase-top"><span class="sq ' + p.key + '"></span>'
        + '<span class="count">' + p.num + '</span>'
        + '<span class="count push">' + esc(p.elapsed) + '</span></div>'
        + '<div class="phase-name' + (p.status === 'pending' ? ' fg-dimmer' : '') + '">' + esc(p.name) + '</div>'
        + '<span class="bar"><span class="' + p.key + '" style="width:' + p.pct + '%"></span></span>'
        + '<div class="ellip count">' + esc(p.artifact) + '</div></div>'
    }).join('')
    + '</div></section>'
}

// The three cross-links into the other views are plain anchors. A data-act would hand them to
// the delegated click handler, which replaces the current history entry instead of pushing one,
// and Back would then leave the dashboard rather than return to the overview. As anchors they
// move the fragment, and the hashchange listener in main.mjs routes them.
export function vOverview() {
  const ms = roadmap().map(milestoneVm)
  const roadmapBrief = '<section class="panel"><div class="panel-head">'
    + '<span class="eyebrow">roadmap</span>'
    + '<a href="#/roadmap" class="panel-meta">open</a></div>'
    + (ms.length ? ms.map(function (m) {
      return '<div class="row tall">'
        + '<span class="sq ' + m.key + '"></span>'
        + '<span class="c-grow">' + esc(m.title) + '</span>'
        + '<span class="w-count c-right count">' + m.done + '/' + m.total + '</span>'
        + '<span class="bar w-bar"><span class="' + m.key + '" style="width:' + esc(m.pct) + '%"></span></span>'
        + '<span class="w-pct c-right small fg-dim">' + esc(m.pct) + '%</span></div>'
    }).join('')
      : '<div class="empty">No roadmap data yet. Milestones appear when the track phase starts writing them.</div>')
    + '</section>'

  const knowledgePanel = '<section class="panel"><div class="panel-head">'
    + '<span class="eyebrow">' + esc(root()) + '</span>'
    + '<span class="panel-note push">okf 0.2</span></div>'
    + counts().map(function (c) {
      return '<div class="row tall">'
        + '<span class="c-grow fg-dim">' + esc(c.label) + '</span>'
        + '<span class="c num" style="font-weight:500">' + c.n + '</span></div>'
    }).join('')
    + '</section>'

  const recent = timelineStream().slice(0, 5)
  const activityStrip = '<section class="panel span2"><div class="panel-head">'
    + '<span class="eyebrow">activity</span>'
    + '<span class="panel-note">last ' + recent.length + ' of the merged stream</span>'
    + '<a href="#/timeline" class="panel-meta">timeline</a></div>'
    + (recent.length ? recent.map(timelineRow).join('')
      : '<div class="empty">No activity in the snapshot yet: no recorded events and no commits.</div>')
    + '</section>'

  const commitList = commits()
  const gitPanel = '<section class="panel"><div class="panel-head">'
    + '<span class="eyebrow">git history</span>'
    + '<a href="#/git" class="panel-meta">full log</a></div>'
    + (commitList.length ? commitList.slice(0, 7).map(commitRow).join('')
      : '<div class="empty">No commits in the snapshot.</div>')
    + '</section>'

  const decisionList = decisions()
  const decisionsPanel = '<section class="panel"><div class="panel-head">'
    + '<span class="eyebrow">decisions</span>'
    + '<span class="panel-note push">'
    + decisionList.filter(function (d) { return d.status !== 'open' }).length + ' closed &#183; '
    + decisionList.filter(function (d) { return d.status === 'open' }).length + ' open</span></div>'
    + (decisionList.length ? decisionList.slice(0, 7).map(decisionRow).join('')
      : '<div class="empty">No decision records in the bundle yet (OKF concepts with type: decision).</div>')
    + '</section>'

  return lifecyclePanel()
    + '<div class="grid2">' + roadmapBrief + knowledgePanel + activityStrip + gitPanel + decisionsPanel + '</div>'
}
