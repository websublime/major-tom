// Overview: lifecycle (grid or console layout), roadmap brief, knowledge counts,
// recent git, decisions. Sections without a data producer render empty states.

import { COMMITS, COUNTS, DECISIONS, LASTRUN, ROADMAP, ROOT } from '../data.mjs'
import { S } from '../state.mjs'
import { commitRow, decisionRow, esc, milestoneVm, phaseVms } from '../ui.mjs'

function lifecycleGrid(phases) {
  return '<section class="panel"><div class="panel-head"><span class="eyebrow">lifecycle</span>'
    + '<span style="color:var(--dimmer);font-size:11.5px">' + esc(LASTRUN.id || '') + '</span>'
    + '<span class="chip" style="margin-left:auto;padding:4px 11px;color:var(--text);font-size:11.5px">'
    + phases.filter(function (p) { return p.status === 'done' }).length + '/' + phases.length + ' done</span></div>'
    + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(96px,1fr));gap:8px">'
    + phases.map(function (p) {
      return '<div class="tile" style="padding:12px;display:flex;flex-direction:column;gap:8px;min-width:0;'
        + (p.status === 'active' ? 'background:var(--accent-soft);border:1px solid var(--accent-line)' : 'border:1px solid transparent') + '">'
        + '<div style="display:flex;align-items:center;gap:7px"><span style="width:7px;height:7px;border-radius:50%;background:' + p.color + '"></span>'
        + '<span style="color:var(--dimmer);font-size:10.5px">' + p.num + '</span></div>'
        + '<div class="sans ellip" style="color:' + p.labelColor + ';font-size:13.5px;font-weight:500">' + esc(p.name) + '</div>'
        + '<div class="bar"><span style="background:' + p.color + ';width:' + p.pct + '%"></span></div>'
        + '<div class="ellip" style="color:var(--dimmer);font-size:10.5px">' + esc(p.artifact) + '</div></div>'
    }).join('') + '</div></section>'
}

function lifecycleConsole(phases) {
  return '<section class="panel"><div class="panel-head">'
    + '<span class="chip" style="width:26px;height:26px;border-radius:10px;background:var(--accent-soft);border:1px solid var(--accent-line);color:var(--accent);display:grid;place-items:center">&#9656;</span>'
    + '<span class="sans" style="font-size:14px;font-weight:600">' + esc(LASTRUN.id || '') + '</span>'
    + '<span style="color:var(--dim);font-size:11.5px">' + esc(LASTRUN.workflow || '') + '</span>'
    + '<span class="chip" style="margin-left:auto;padding:4px 11px;font-size:11.5px">' + esc((LASTRUN.duration || '') + (LASTRUN.mode ? ' · ' + LASTRUN.mode : '')) + '</span></div>'
    + '<div style="display:flex;flex-direction:column;gap:3px">'
    + phases.map(function (p) {
      return '<div style="display:flex;align-items:center;gap:13px;padding:9px 12px;border-radius:13px;background:' + (p.status === 'active' ? 'var(--accent-soft)' : 'var(--tile)') + '">'
        + '<span style="flex:0 0 16px;color:var(--dimmer);font-size:11px">' + p.num + '</span>'
        + '<span style="flex:0 0 7px;height:7px;border-radius:50%;background:' + p.color + '"></span>'
        + '<span class="sans" style="flex:0 0 118px;font-size:13.5px;color:' + p.labelColor + ';font-weight:500">' + esc(p.name) + '</span>'
        + '<span class="ellip" style="flex:1 1 auto;min-width:0;color:var(--dim);font-size:11.5px">' + esc(p.artifact) + '</span>'
        + '<span class="chip" style="color:' + p.color + ';letter-spacing:.08em;text-transform:uppercase">' + esc(p.status) + '</span>'
        + '<span style="flex:0 0 50px;text-align:right;color:var(--dimmer);font-size:11px">' + esc(p.elapsed) + '</span></div>'
    }).join('') + '</div></section>'
}

export function vOverview() {
  const phases = phaseVms()
  const bar = '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:0 4px">'
    + '<div class="seg">'
    + '<button data-act="layout" data-v="A" class="' + (S.layout === 'A' ? 'active' : '') + '">grid</button>'
    + '<button data-act="layout" data-v="B" class="' + (S.layout === 'B' ? 'active' : '') + '">console</button>'
    + '</div>'
    + (LASTRUN ? '<span style="margin-left:auto;color:var(--dim);font-size:11.5px">last run <span style="color:var(--text)">' + esc(LASTRUN.id || '') + '</span>' + (LASTRUN.duration ? ' &#183; ' + esc(LASTRUN.duration) : '') + '</span>' : '')
    + '</div>'

  let lifecycle
  if (!phases) {
    lifecycle = '<section class="panel"><div class="panel-head"><span class="eyebrow">lifecycle</span></div>'
      + '<div class="empty">No runs recorded yet. The lifecycle tiles light up when workflow runs start writing phase records.</div></section>'
  } else {
    lifecycle = S.layout === 'A' ? lifecycleGrid(phases) : lifecycleConsole(phases)
  }

  const ms = ROADMAP.map(milestoneVm)
  const roadmapBrief = '<section class="panel" style="grid-column:span 7">'
    + '<div class="panel-head"><span class="eyebrow">roadmap</span><a href="#/roadmap" style="margin-left:auto;font-size:11.5px">open &#8594;</a></div>'
    + (ms.length ? '<div style="display:flex;flex-direction:column;gap:8px">' + ms.map(function (m) {
      return '<div class="tile" style="display:flex;align-items:center;gap:12px;padding:10px 12px">'
        + '<span style="width:7px;height:7px;flex:0 0 auto;border-radius:50%;background:' + m.color + '"></span>'
        + '<span class="sans ellip" style="flex:1 1 auto;min-width:0;font-size:13.5px">' + esc(m.title) + '</span>'
        + '<span style="flex:0 0 auto;color:var(--dimmer);font-size:11px">' + m.done + '/' + m.total + '</span>'
        + '<span class="bar" style="flex:0 0 96px;height:4px"><span style="height:4px;background:' + m.color + ';width:' + m.pct + '%"></span></span>'
        + '<span style="flex:0 0 36px;text-align:right;font-size:11.5px">' + m.pct + '%</span></div>'
    }).join('') + '</div>' : '<div class="empty">No roadmap data yet. Milestones appear when the track phase starts writing them.</div>')
    + '</section>'

  const knowledgePanel = '<section class="panel" style="grid-column:span 5">'
    + '<div class="panel-head"><span class="eyebrow">' + esc(ROOT) + '</span>'
    + '<span style="margin-left:auto;color:var(--dimmer);font-size:11px">okf 0.2 bundle</span></div>'
    + '<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px">'
    + COUNTS.map(function (c) {
      return '<div class="tile" style="padding:12px;display:flex;flex-direction:column;gap:2px">'
        + '<span class="sans" style="font-size:24px;font-weight:600;letter-spacing:-.02em">' + c.n + '</span>'
        + '<span style="color:var(--dim);font-size:11px">' + esc(c.label) + '</span></div>'
    }).join('') + '</div></section>'

  const gitPanel = '<section class="panel" style="grid-column:span 7">'
    + '<div class="panel-head"><span class="eyebrow">git history</span><a href="#/git" style="margin-left:auto;font-size:11.5px">full log &#8594;</a></div>'
    + (COMMITS.length ? '<div style="display:flex;flex-direction:column;gap:2px">' + COMMITS.slice(0, 7).map(commitRow).join('') + '</div>'
      : '<div class="empty">No commits in the snapshot.</div>')
    + '</section>'

  const decisionsPanel = '<section class="panel" style="grid-column:span 5">'
    + '<div class="panel-head"><span class="eyebrow">decisions</span>'
    + '<span style="margin-left:auto;color:var(--dimmer);font-size:11px">'
    + DECISIONS.filter(function (d) { return d.status !== 'open' }).length + ' closed &#183; '
    + DECISIONS.filter(function (d) { return d.status === 'open' }).length + ' open</span></div>'
    + (DECISIONS.length ? '<div style="display:flex;flex-direction:column;gap:2px">' + DECISIONS.slice(0, 7).map(decisionRow).join('') + '</div>'
      : '<div class="empty">No decision records in the bundle yet (OKF concepts with type: decision).</div>')
    + '</section>'

  return bar + '<div style="display:flex;flex-direction:column;gap:14px">' + lifecycle
    + '<div class="grid12">' + roadmapBrief + knowledgePanel + gitPanel + decisionsPanel + '</div></div>'
}
