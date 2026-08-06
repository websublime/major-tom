// Roadmap: overall progress plus one section per milestone with its tasks.

import { ROADMAP } from '../data.mjs'
import { esc, milestoneVm } from '../ui.mjs'

export function vRoadmap() {
  const ms = ROADMAP.map(milestoneVm)
  if (!ms.length) return '<section class="panel"><div class="empty">No roadmap data yet. This view fills in when the track phase starts writing milestones into the snapshot.</div></section>'
  const done = ms.filter(function (m) { return m.status === 'done' }).length
  const active = ms.filter(function (m) { return m.status === 'active' }).length
  const overall = Math.round(ms.reduce(function (a, m) { return a + m.pct }, 0) / ms.length)
  const head = '<section class="panel" style="display:flex;align-items:center;gap:20px;flex-wrap:wrap">'
    + '<div style="display:flex;flex-direction:column;gap:1px"><span class="eyebrow">overall</span>'
    + '<span class="sans" style="font-size:26px;font-weight:600">' + overall + '%</span></div>'
    + '<div class="bar" style="flex:1 1 240px;height:7px"><span style="height:7px;background:var(--accent);width:' + overall + '%"></span></div>'
    + '<div style="display:flex;gap:8px">'
    + '<span class="chip" style="padding:5px 12px;background:var(--ok-soft);color:var(--ok);font-size:11.5px">' + done + ' done</span>'
    + '<span class="chip" style="padding:5px 12px;background:var(--accent-soft);color:var(--accent);font-size:11.5px">' + active + ' active</span>'
    + '<span class="chip" style="padding:5px 12px;font-size:11.5px">' + (ms.length - done - active) + ' planned</span>'
    + '</div></section>'
  return head + ms.map(function (m) {
    return '<section class="panel"><div class="panel-head">'
      + '<span style="width:8px;height:8px;border-radius:50%;background:' + m.color + '"></span>'
      + '<span class="sans" style="font-size:15px;font-weight:600">' + esc(m.title) + '</span>'
      + '<span style="color:var(--dimmer);font-size:11.5px">' + esc(m.version) + '</span>'
      + '<span class="chip" style="padding:2px 10px;color:' + m.color + ';letter-spacing:.08em;text-transform:uppercase">' + esc(m.status) + '</span>'
      + '<span style="margin-left:auto;display:flex;align-items:center;gap:12px;color:var(--dim);font-size:11.5px">'
      + '<span>' + m.done + '/' + m.total + ' tasks</span>'
      + '<span class="bar" style="width:120px;height:4px;display:inline-block"><span style="height:4px;background:' + m.color + ';width:' + m.pct + '%"></span></span>'
      + '<span style="width:36px;text-align:right;color:var(--text)">' + m.pct + '%</span></span></div>'
      + '<div style="display:flex;flex-direction:column;gap:3px">'
      + m.tasks.map(function (t) {
        const mark = t.status === 'done' ? '✓' : t.status === 'active' ? '▸' : '·'
        const mc = t.status === 'done' ? 'var(--ok)' : t.status === 'active' ? 'var(--accent)' : 'var(--dimmer)'
        return '<div class="tile" style="display:flex;align-items:center;gap:12px;padding:9px 12px">'
          + '<span style="flex:0 0 14px;color:' + mc + ';font-size:12px">' + mark + '</span>'
          + '<span class="chip">' + esc(t.ref || '') + '</span>'
          + '<span style="flex:1 1 auto;min-width:0;color:' + (t.status === 'todo' ? 'var(--dim)' : 'var(--text)') + '">' + esc(t.title || '') + '</span>'
          + '<span style="flex:0 0 auto;color:var(--dimmer);font-size:11px">' + esc(t.owner || '') + '</span></div>'
      }).join('') + '</div></section>'
  }).join('')
}
