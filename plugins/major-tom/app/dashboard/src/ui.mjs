// Shared fragments: escaping, the status mapping, and the rows more than one view builds.

import { day, lastRun } from './data.mjs'

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  })
}

// Every status word collapses to one of three states, and the word this returns is both the
// token name and the class stem: `sq done`, `fg-active`, a bar fill of `idle`.
function uiStatusKey(st) {
  if (st === 'done') return 'done'
  if (st === 'active') return 'active'
  return st === 'failed' ? 'neg' : 'idle'
}

// The overview's git brief renders one commit per row. The full log has its own row in
// views/git.mjs.
export function commitRow(c) {
  return '<div class="row">'
    + '<span class="w-sha fg-dim small">' + esc(c.sha) + '</span>'
    + '<span class="w-kind fg-dimmer small">' + esc(c.kind) + '</span>'
    + '<span class="c-grow">' + esc(c.subject) + '</span>'
    + '<span class="w-when c-right count">' + esc(c.when) + '</span>'
    + '</div>'
}

// `mark` is already an HTML entity, so a view writes it without escaping it.
export function milestoneVm(m) {
  const tasks = Array.isArray(m.tasks) ? m.tasks : []
  const done = tasks.filter(function (t) { return t.status === 'done' }).length
  return {
    title: m.title || '', version: m.version || '', status: m.status || 'planned',
    pct: m.pct != null ? m.pct : (tasks.length ? Math.round(done / tasks.length * 100) : 0),
    key: uiStatusKey(m.status), done: done, total: tasks.length,
    tasks: tasks.map(function (t) {
      const st = t.status || 'todo'
      return {
        ref: t.ref || '', title: t.title || '', owner: t.owner || '', status: st,
        key: uiStatusKey(st),
        mark: st === 'done' ? '&#10003;' : st === 'active' ? '&#9656;' : '&#183;'
      }
    })
  }
}

export function decisionRow(d) {
  const open = d.status === 'open'
  return '<div class="row">'
    + '<span class="w-ref small ellip ' + (open ? 'fg-active' : 'fg-done') + '" title="' + esc(d.id) + '">' + esc(d.id) + '</span>'
    + '<span class="c-grow' + (open ? '' : ' fg-dim') + '">' + esc(d.text) + '</span>'
    + '<span class="c c-right count">' + esc(open ? 'open' : day(d.date)) + '</span>'
    + '</div>'
}

// phaseVms returns one view model per phase of the last run, and null when no run was recorded.
// `pct` fills the phase bar, and only a finished phase has a measured one, so an unfinished
// phase reads 0.
export function phaseVms() {
  const run = lastRun()
  if (!run || !Array.isArray(run.phases)) return null
  return run.phases.map(function (p, i) {
    const st = p.status || 'pending'
    return {
      num: String(i + 1).padStart(2, '0'), name: p.name || '', artifact: p.artifact || '',
      status: st, elapsed: p.elapsed || '', key: uiStatusKey(st),
      pct: st === 'done' ? 100 : 0
    }
  })
}
