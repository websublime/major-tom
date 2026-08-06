// Timeline: the recorded intent and run stream (snapshot key `timeline`, D41) merged
// client side with the commit stream, newest first, grouped by day and then by session.
// Commits are never duplicated into the key; the merge happens here.

import { COMMITS, TIMELINE, clock } from '../data.mjs'
import { esc } from '../ui.mjs'

const REASON_TEXT = {
  days: 'days (the day horizon)',
  ceiling: 'ceiling (the event ceiling)',
  bytes: 'bytes (the byte budget)'
}

function stated(v) {
  return v == null || v === '' ? 'not stated' : String(v)
}

function kbBytes(n) {
  const v = Number(n)
  if (n == null || !isFinite(v)) return 'not stated'
  return v >= 1024 ? Math.round(v / 1024) + ' KB' : v + ' bytes'
}

function reasonText(r) {
  if (r == null || r === '') return 'not stated'
  return REASON_TEXT[r] || String(r)
}

function dayKey(ms) {
  if (ms == null) return ''
  const d = new Date(ms)
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

function dayLabel(key) {
  if (!key) return 'undated'
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  if (key === dayKey(today.getTime())) return 'today'
  if (key === dayKey(yesterday.getTime())) return 'yesterday'
  return key
}

function groupKey(it) {
  return it.stream === 'commit' ? 'commit' : 'session:' + it.session
}

function groupLabel(it) {
  if (it.stream === 'commit') return 'git'
  return it.session ? 'session ' + it.session : 'no session id'
}

// The merged stream: timeline events plus commits, one chronological order, newest first.
// Items with an unparseable date keep their place at the end rather than being dropped.
export function timelineStream() {
  const commits = COMMITS.map(function (c) {
    const ms = Date.parse(c.date)
    return {
      stream: 'commit', kind: 'commit', mark: c.sha, label: c.kind, color: c.kindColor,
      text: c.subject, truncated: false, session: '', path: '',
      date: c.date, when: c.when, at: isNaN(ms) ? null : ms
    }
  })
  const events = TIMELINE.events.map(function (e) {
    return {
      stream: 'event', kind: e.kind, mark: e.kind === 'run' ? 'run' : 'intent',
      label: e.kind === 'run' ? '' : (e.tier || 'intent') + (e.type ? ' ' + e.type : ''),
      color: e.color, text: e.text, truncated: e.truncated, session: e.session, path: e.path,
      date: e.date, when: e.when, at: e.at
    }
  })
  return events.concat(commits).sort(function (a, b) {
    if (a.at == null && b.at == null) return 0
    if (a.at == null) return 1
    if (b.at == null) return -1
    return b.at - a.at
  })
}

// One row of the merged stream, at the density of commitRow and decisionRow.
export function timelineRow(it) {
  const isCommit = it.stream === 'commit'
  return '<div class="row">'
    + '<span class="chip' + (isCommit ? ' sha' : '') + '"'
    + (isCommit ? '' : ' style="color:' + it.color + '"') + '>' + esc(it.mark) + '</span>'
    + '<span class="ellip" style="flex:0 0 122px;color:' + it.color + ';font-size:11px">' + esc(it.label) + '</span>'
    + '<span class="ellip" style="flex:1 1 auto;min-width:0">' + esc(it.text) + '</span>'
    + (it.truncated ? '<span class="chip" style="flex:0 0 auto;color:var(--warn)" title="summary cut at the snapshot cap">truncated</span>' : '')
    + (it.path ? '<span class="ellip" style="flex:0 1 190px;color:var(--dimmer);font-size:11px;text-align:right">' + esc(it.path) + '</span>' : '')
    + '<span style="flex:0 0 42px;text-align:right;color:var(--dimmer);font-size:11px">' + esc(clock(it.date) || it.when) + '</span>'
    + '</div>'
}

// Plain text, always rendered: the window this view stands on and every omission it was
// told about. Truncation is never silent (D41).
export function timelineWindowLine() {
  if (!TIMELINE.present) {
    return 'This snapshot carries no timeline key: no recorded events and no window to state. '
      + 'Any rows below are commits from the git window.'
  }
  const w = TIMELINE.window
  const o = TIMELINE.omitted
  const head = w
    ? 'Window: last ' + stated(w.days) + ' days, floor ' + stated(w.floorEvents) + ' events, ceiling '
      + stated(w.ceilingEvents) + ' events, byte budget ' + kbBytes(w.byteBudget) + '.'
    : 'Window: not stated in this snapshot.'
  let tail
  if (!o) {
    tail = 'No omission record in this snapshot, so how much was left out is unknown.'
  } else if (o.count > 0) {
    tail = o.count + ' event' + (o.count === 1 ? '' : 's') + ' omitted, oldest kept '
      + stated(o.oldestKept) + ', limit that bit: ' + reasonText(o.reason) + '.'
  } else {
    tail = 'Nothing omitted: every event inside the window is shown.'
  }
  return head + ' ' + tail
}

export function vTimeline() {
  const stream = timelineStream()
  const bar = '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:0 4px">'
    + '<span style="color:var(--dim);font-size:11.5px">' + TIMELINE.events.length + ' recorded event'
    + (TIMELINE.events.length === 1 ? '' : 's') + ' &#183; ' + COMMITS.length + ' commit'
    + (COMMITS.length === 1 ? '' : 's') + '</span>'
    + '<span style="margin-left:auto;color:var(--dim);font-size:11.5px">' + stream.length + ' in the merged stream</span></div>'
  const note = '<div style="padding:0 6px;color:var(--dim);font-size:11.5px;line-height:1.65">'
    + esc(timelineWindowLine()) + '</div>'

  if (!stream.length) {
    return bar + note + '<section class="panel"><div class="empty">'
      + 'No events and no commits in this snapshot. The timeline fills in as intents and runs '
      + 'are recorded under the runs area and as commits land in the window.</div></section>'
  }

  const days = []
  stream.forEach(function (it) {
    const key = dayKey(it.at)
    const last = days[days.length - 1]
    if (last && last.key === key) last.items.push(it)
    else days.push({ key: key, items: [it] })
  })

  return bar + note + days.map(function (day) {
    const blocks = []
    day.items.forEach(function (it) {
      const key = groupKey(it)
      const last = blocks[blocks.length - 1]
      if (last && last.key === key) last.items.push(it)
      else blocks.push({ key: key, label: groupLabel(it), items: [it] })
    })
    return '<section class="panel"><div class="panel-head">'
      + '<span class="eyebrow">' + esc(dayLabel(day.key)) + '</span>'
      + '<span style="margin-left:auto;color:var(--dimmer);font-size:11px">' + day.items.length
      + ' item' + (day.items.length === 1 ? '' : 's') + '</span></div>'
      + '<div style="display:flex;flex-direction:column;gap:10px">'
      + blocks.map(function (b) {
        return '<div><div style="display:flex;align-items:center;gap:9px;padding:0 10px 4px 10px">'
          + '<span style="color:var(--dimmer);font-size:10.5px;letter-spacing:.08em;text-transform:uppercase">'
          + esc(b.label) + '</span>'
          + '<span style="margin-left:auto;color:var(--dimmer);font-size:10.5px">' + b.items.length + '</span></div>'
          + '<div style="display:flex;flex-direction:column;gap:2px">' + b.items.map(timelineRow).join('') + '</div></div>'
      }).join('')
      + '</div></section>'
  }).join('')
}
