// Snapshot parsing and derivations. Everything downstream reads these constants;
// the data island is the only input (templates/README.md, snapshot schema v2).

export const AREAS = ['memories', 'docs', 'runs', 'monitors', 'logs']
export const KIND_COLOR = { feat: 'var(--accent)', fix: 'var(--stop)', docs: 'var(--dim)', test: 'var(--ok)', chore: 'var(--dimmer)', refactor: 'var(--warn)' }

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
      date: f.updated || '', status: f.frontmatter.status === 'open' ? 'open' : 'closed'
    }
  })

export const ROADMAP = DATA.roadmap && Array.isArray(DATA.roadmap.milestones) ? DATA.roadmap.milestones : []
export const LASTRUN = DATA.lastRun || null
