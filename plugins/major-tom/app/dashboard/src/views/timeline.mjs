// Timeline: the recorded intent and run stream (snapshot key `timeline`, D41) merged
// client side with the commit stream, newest first, grouped by day and then by session.
// Commits are never duplicated into the key; the merge happens here.

import { clock, commits, timeline } from '../data.mjs'
import { esc } from '../ui.mjs'

// The two limits that can bite, and the only two the server can now report: D43 point 4
// dropped the 256 KB timeline budget, so "bytes" left the set of reasons along with it. An
// unrecognised reason still prints verbatim rather than being swallowed, which is how a
// snapshot from an older producer still states honestly why it dropped events.
const REASON_TEXT = {
  days: 'days (the day horizon)',
  ceiling: 'ceiling (the event ceiling)'
}

function stated(v) {
  return v == null || v === '' ? 'not stated' : String(v)
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
  const commitItems = commits().map(function (c) {
    const ms = Date.parse(c.date)
    return {
      stream: 'commit', kind: 'commit', mark: c.sha, label: c.kind, color: c.kindColor,
      text: c.subject, truncated: false, session: '', path: '',
      date: c.date, when: c.when, at: isNaN(ms) ? null : ms
    }
  })
  const events = timeline().events.map(function (e) {
    return {
      stream: 'event', kind: e.kind, mark: e.kind === 'run' ? 'run' : 'intent',
      label: e.kind === 'run' ? '' : (e.tier || 'intent') + (e.type ? ' ' + e.type : ''),
      color: e.color, text: e.text, truncated: e.truncated, session: e.session, path: e.path,
      date: e.date, when: e.when, at: e.at
    }
  })
  return events.concat(commitItems).sort(function (a, b) {
    if (a.at == null && b.at == null) return 0
    if (a.at == null) return 1
    if (b.at == null) return -1
    return b.at - a.at
  })
}

// One row of the merged stream, at the width of the git table. The overview's activity strip
// calls this too, so the row states itself and takes nothing from its table.
//
// A commit is marked by its sha in the neutral column colour; an event is marked by the stream
// it came from, coloured by its tier. The kind column carries the colour in both cases. The
// value is the one data.mjs derived, and it is written inline because a derived colour has no
// class to carry it; the git table's kind column does the same.
export function timelineRow(it) {
  const isCommit = it.stream === 'commit'
  return '<div class="row">'
    + '<span class="w-sha small' + (isCommit ? ' fg-dim' : '') + '"'
    + (isCommit ? '' : ' style="color:' + it.color + '"') + '>' + esc(it.mark) + '</span>'
    + '<span class="w-owner ellip small" style="color:' + it.color + '">' + esc(it.label) + '</span>'
    + '<span class="c-grow">' + esc(it.text) + '</span>'
    + (it.truncated
      ? '<span class="c status fg-active" title="summary cut at the 200-character cap">truncated</span>'
      : '')
    + (it.path ? '<span class="w-author c-right ellip count">' + esc(it.path) + '</span>' : '')
    + '<span class="w-when c-right count">' + esc(clock(it.date) || it.when) + '</span>'
    + '</div>'
}

// Plain text, always rendered: the window this view stands on and every omission it was
// told about. Truncation is never silent (D41).
export function timelineWindowLine() {
  const t = timeline()
  if (!t.present) {
    return 'This snapshot carries no timeline key: no recorded events and no window to state. '
      + 'Any rows below are commits from the git window.'
  }
  const w = t.window
  const o = t.omitted
  const head = w
    ? 'Window: last ' + stated(w.days) + ' days, floor ' + stated(w.floorEvents) + ' events, ceiling '
      + stated(w.ceilingEvents) + ' events.'
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
  const eventCount = timeline().events.length
  const commitCount = commits().length
  const tools = '<div class="tools">'
    + '<span class="fg-dim small">' + eventCount + ' recorded event'
    + (eventCount === 1 ? '' : 's') + ' &#183; ' + commitCount + ' commit'
    + (commitCount === 1 ? '' : 's') + '</span>'
    + '<span class="push fg-dim small">' + stream.length + ' in the merged stream</span></div>'
  const windowPanel = '<section class="panel">'
    + '<div class="panel-head short"><span class="eyebrow">window</span></div>'
    + '<div class="pad prose fg-dim">' + esc(timelineWindowLine()) + '</div></section>'

  if (!stream.length) {
    return tools + windowPanel + '<section class="panel"><div class="empty">'
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

  // One panel per day, one head row per session block inside it. The path column is labelled
  // only when the day holds an item that carries a path.
  return tools + windowPanel + days.map(function (bucket) {
    const blocks = []
    bucket.items.forEach(function (it) {
      const key = groupKey(it)
      const last = blocks[blocks.length - 1]
      if (last && last.key === key) last.items.push(it)
      else blocks.push({ key: key, label: groupLabel(it), items: [it] })
    })
    const hasPath = bucket.items.some(function (it) { return !!it.path })
    return '<section class="panel">'
      + '<div class="panel-head short"><span class="eyebrow">' + esc(dayLabel(bucket.key)) + '</span>'
      + '<span class="panel-meta">' + bucket.items.length + ' item'
      + (bucket.items.length === 1 ? '' : 's') + '</span></div>'
      + '<div class="thead"><span class="w-sha">mark</span><span class="w-owner">kind</span>'
      + '<span class="c-grow">summary</span>'
      + (hasPath ? '<span class="w-author c-right">path</span>' : '')
      + '<span class="w-when c-right">when</span></div>'
      + blocks.map(function (b) {
        return '<div class="row group"><span class="c-grow eyebrow">' + esc(b.label) + '</span>'
          + '<span class="count">' + b.items.length + '</span></div>'
          + b.items.map(timelineRow).join('')
      }).join('')
      + '</section>'
  }).join('')
}
