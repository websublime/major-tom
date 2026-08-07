// Snapshot parsing and derivations. Everything downstream reads these constants;
// the data island is the only input (templates/README.md, snapshot schema v2).

export const AREAS = ['memories', 'docs', 'runs', 'monitors', 'logs']
export const KIND_COLOR = { feat: 'var(--accent)', fix: 'var(--stop)', docs: 'var(--dim)', test: 'var(--ok)', chore: 'var(--dimmer)', refactor: 'var(--warn)' }
export const TIER_COLOR = { trivial: 'var(--dimmer)', task: 'var(--warn)', substantive: 'var(--accent)' }

function parseIsland() {
  try {
    return JSON.parse(document.getElementById('major-tom-data').textContent || '{}')
  } catch (e) {
    return {}
  }
}

export const DATA = parseIsland()
export const CFG = DATA.config || {}
export const ROOT = (CFG.persistence && CFG.persistence.root) || '.knowledge'

export function rel(iso) {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (isNaN(t)) return String(iso)
  const m = Math.round((Date.now() - t) / 60000)
  if (m < 1) return 'now'
  if (m < 60) return m + ' min ago'
  if (m < 1440) return Math.round(m / 60) + ' h ago'
  return Math.round(m / 1440) + ' d ago'
}

export function clock(iso) {
  const t = Date.parse(iso)
  if (isNaN(t)) return ''
  const d = new Date(t)
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
}

export const COMMITS = (Array.isArray(DATA.git) ? DATA.git : []).map(function (c) {
  const kind = c.kind || (String(c.subject || '').match(/^(feat|fix|docs|test|chore|refactor)/) || [])[1] || 'other'
  return {
    sha: String(c.hash || '').slice(0, 7), kind: kind, kindColor: KIND_COLOR[kind] || 'var(--dim)',
    subject: c.subject || '', author: c.author || '', add: c.add, del: c.del,
    when: rel(c.date), date: c.date || ''
  }
})

export const FILES = ((DATA.knowledge || {}).files || []).map(function (f) {
  return typeof f === 'string' ? { path: f } : f
})

export const COUNTS = (function () {
  const out = AREAS.map(function (a) {
    return { label: a, n: FILES.filter(function (f) { return (f.path || '').indexOf(a + '/') === 0 || (f.path || '').indexOf('/' + a + '/') !== -1 }).length }
  })
  out.push({ label: 'concepts', n: FILES.length })
  return out
})()

export const DECISIONS = Array.isArray(DATA.decisions) ? DATA.decisions : FILES
  .filter(function (f) { return f.frontmatter && f.frontmatter.type === 'decision' })
  .map(function (f) {
    return {
      id: f.frontmatter.id || f.path, text: f.frontmatter.title || f.path,
      // date precedence mirrors buildDecisions in plugins/major-tom/app/snapshot.js:
      // the declared frontmatter date, the file mtime otherwise. The two derivations of
      // this one field are deliberately coupled, so keep them in step.
      date: f.frontmatter.date || f.updated || '', status: f.frontmatter.status === 'open' ? 'open' : 'closed'
    }
  })

// The timeline key (D41). Optional: every artifact generated before it existed lacks it,
// so a missing or malformed key degrades to an empty view that states what it does not have.
// Commits are deliberately not part of it; the view merges DATA.git in client side.
export const TIMELINE = (function () {
  const t = DATA.timeline && typeof DATA.timeline === 'object' && !Array.isArray(DATA.timeline) ? DATA.timeline : null
  const raw = t && Array.isArray(t.events) ? t.events : []
  const events = raw.filter(function (e) { return e && typeof e === 'object' }).map(function (e) {
    const isRun = e.kind === 'run'
    const tier = isRun || e.tier == null ? null : String(e.tier)
    const sid = e.sessionId == null ? '' : String(e.sessionId)
    const ms = Date.parse(e.at)
    return {
      stream: 'event', kind: isRun ? 'run' : 'intent', tier: tier,
      type: isRun || e.type == null ? null : String(e.type),
      color: isRun ? 'var(--ok)' : (TIER_COLOR[tier] || 'var(--dim)'),
      text: e.summary == null ? '' : String(e.summary),
      truncated: e.summaryTruncated === true,
      promptId: e.promptId == null ? '' : String(e.promptId),
      sessionId: sid, session: sid ? sid.slice(0, 8) : '',
      path: e.path == null ? '' : String(e.path),
      date: e.at || '', when: rel(e.at), at: isNaN(ms) ? null : ms
    }
  })
  const w = t && t.window && typeof t.window === 'object' ? t.window : null
  const o = t && t.omitted && typeof t.omitted === 'object' ? t.omitted : null
  return {
    present: !!t, events: events,
    window: w ? { days: w.days, floorEvents: w.floorEvents, ceilingEvents: w.ceilingEvents, byteBudget: w.byteBudget } : null,
    omitted: o ? { count: Number(o.count) || 0, oldestKept: o.oldestKept || '', reason: o.reason == null ? null : String(o.reason) } : null
  }
})()

export const ROADMAP = DATA.roadmap && Array.isArray(DATA.roadmap.milestones) ? DATA.roadmap.milestones : []
export const LASTRUN = DATA.lastRun || null
