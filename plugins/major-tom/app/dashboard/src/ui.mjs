// Shared fragments: escaping, status colors, reusable row and card builders.

import { lastRun } from './data.mjs'

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  })
}

export function statusColor(st) {
  return st === 'done' ? 'var(--ok)' : st === 'active' ? 'var(--accent)' : 'var(--line2)'
}

export function commitRow(c) {
  return '<div class="row">'
    + '<span class="chip sha">' + esc(c.sha) + '</span>'
    + '<span style="flex:0 0 58px;color:' + c.kindColor + ';font-size:11px">' + esc(c.kind) + '</span>'
    + '<span class="ellip" style="flex:1 1 auto;min-width:0">' + esc(c.subject) + '</span>'
    + '<span style="flex:0 0 auto;color:var(--dimmer);font-size:11px">' + esc(c.when) + '</span>'
    + '</div>'
}

export function milestoneVm(m) {
  const tasks = Array.isArray(m.tasks) ? m.tasks : []
  const done = tasks.filter(function (t) { return t.status === 'done' }).length
  return {
    title: m.title || '', version: m.version || '', status: m.status || 'planned',
    pct: m.pct != null ? m.pct : (tasks.length ? Math.round(done / tasks.length * 100) : 0),
    color: statusColor(m.status), done: done, total: tasks.length, tasks: tasks
  }
}

export function decisionRow(d) {
  const open = d.status === 'open'
  return '<div class="row">'
    + '<span class="chip" style="' + (open ? 'border:1px solid var(--line2);color:var(--warn)' : 'background:var(--ok-soft);color:var(--ok)') + '">' + esc(d.id) + '</span>'
    + '<span class="ellip" style="flex:1 1 auto;min-width:0;color:' + (open ? 'var(--text)' : 'var(--dim)') + '">' + esc(d.text) + '</span>'
    + '<span style="flex:0 0 auto;color:var(--dimmer);font-size:11px">' + esc(open ? 'open' : (d.date || '')) + '</span>'
    + '</div>'
}

export function phaseVms() {
  const run = lastRun()
  if (!run || !Array.isArray(run.phases)) return null
  return run.phases.map(function (p, i) {
    const st = p.status || 'pending'
    return {
      num: String(i + 1).padStart(2, '0'), name: p.name || '', artifact: p.artifact || '', status: st,
      elapsed: p.elapsed || '', color: statusColor(st === 'pending' ? 'planned' : st),
      pct: st === 'done' ? 100 : st === 'active' ? 55 : 0,
      labelColor: st === 'pending' ? 'var(--dimmer)' : 'var(--text)'
    }
  })
}
