// Roadmap: the overall progress header, then one table whose group rows are the milestones and
// whose rows are their tasks.

import { roadmap } from '../data.mjs'
import { esc, milestoneVm } from '../ui.mjs'

export function vRoadmap() {
  const ms = roadmap().map(milestoneVm)

  // The empty state carries no head, because column labels over no rows label nothing. This is
  // the rule views/git.mjs states for its churn column.
  if (!ms.length) {
    return '<section class="panel">'
      + '<div class="empty">No roadmap data yet. This view fills in when the track phase starts writing milestones into the snapshot.</div>'
      + '</section>'
  }

  const thead = '<div class="thead">'
    + '<span class="w-mark"></span>'
    + '<span class="w-ref">ref</span>'
    + '<span class="c-grow">task</span>'
    + '<span class="w-owner">owner</span>'
    + '<span class="w-status c-right">status</span></div>'

  const done = ms.filter(function (m) { return m.status === 'done' }).length
  const active = ms.filter(function (m) { return m.status === 'active' }).length
  const overall = Math.round(ms.reduce(function (a, m) { return a + m.pct }, 0) / ms.length)

  const head = '<section class="panel"><div class="pad tools">'
    + '<span class="eyebrow">overall</span>'
    + '<span class="sans num" style="font-size:18px;font-weight:600">' + overall + '%</span>'
    + '<span class="bar wide" style="flex:1 1 200px"><span style="width:' + overall + '%"></span></span>'
    + '<span class="small fg-dim nowrap"><span class="fg-done">&#9632;</span> ' + done + ' done</span>'
    + '<span class="small fg-dim nowrap"><span class="fg-active">&#9632;</span> ' + active + ' active</span>'
    + '<span class="small fg-dim nowrap"><span class="fg-idle">&#9632;</span> ' + (ms.length - done - active) + ' planned</span>'
    + '</div></section>'

  const table = '<section class="panel">' + thead + ms.map(function (m) {
    return '<div class="row group">'
      + '<span class="sq ' + m.key + '"></span>'
      + '<span class="c" style="font-weight:500">' + esc(m.title) + '</span>'
      + '<span class="c count">' + esc(m.version) + '</span>'
      + '<span class="push tools small fg-dim">'
      + '<span class="num">' + m.done + '/' + m.total + '</span>'
      + '<span class="bar w-bar"><span class="' + m.key + '" style="width:' + esc(m.pct) + '%"></span></span>'
      + '<span class="w-pct c-right fg-text">' + esc(m.pct) + '%</span></span></div>'
      + m.tasks.map(function (t) {
        return '<div class="row wrap">'
          + '<span class="w-mark small fg-' + t.key + '">' + t.mark + '</span>'
          + '<span class="w-ref count">' + esc(t.ref) + '</span>'
          + '<span class="c-wrap' + (t.status === 'todo' ? ' fg-dim' : '') + '">' + esc(t.title) + '</span>'
          + '<span class="w-owner small fg-dim ellip">' + esc(t.owner) + '</span>'
          + '<span class="w-status c-right status fg-' + t.key + '">' + esc(t.status) + '</span></div>'
      }).join('')
  }).join('') + '</section>'

  return head + table
}
