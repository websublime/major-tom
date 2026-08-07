// Snapshot derivations. The input is the JSON the server computed and api.mjs fetched
// (D43 point 7); the data island this module used to parse is gone with `render.js inject`.
//
// What changed and what did not. Every derivation below is the one that was here before, with
// the same defensive reading: a missing key, a malformed key and a wrong type are all tolerated
// at every level, because a snapshot from an older producer must degrade into an honest empty
// view instead of a broken page. What changed is only when they run. They used to be top-level
// constants evaluated at module load, which an asynchronous fetch makes impossible, so the
// module now holds one stored derivation and exposes accessors over it.
//
// Derived once per stored snapshot, not once per accessor call: setData does the work and the
// accessors are lookups. That keeps the cost and the internal consistency of a single load
// exactly where they were, and it keeps the relative times (`rel`) fixed between refreshes
// rather than drifting under a view that is re-rendered on every keystroke.
//
// Before the first load, and after a failed one, the store holds the derivation of an empty
// snapshot: the chrome renders honest zeros while state.mjs carries what is actually going on.

// The five canonical areas of section 11, in the order that section declares them. They are a
// convention, not a schema: OQ-7 leaves the bundle's internal layout open. So this list is used
// to order the groups the bundle actually holds and to keep the overview's five tiles present
// even at zero; it never decides which groups exist. See deriveGroups.
export const AREAS = ['memories', 'docs', 'runs', 'monitors', 'logs']

// The label of the group holding the concepts that sit at the bundle root, with no directory
// above them. It starts with a slash on purpose: a path segment can never contain one, so this
// label cannot collide with the label of a real directory however that directory is named,
// including a directory literally called "(bundle root)".
export const ROOT_GROUP_LABEL = '/ (bundle root)'

export const KIND_COLOR = { feat: 'var(--accent)', fix: 'var(--stop)', docs: 'var(--dim)', test: 'var(--ok)', chore: 'var(--dimmer)', refactor: 'var(--warn)' }
export const TIER_COLOR = { trivial: 'var(--dimmer)', task: 'var(--warn)', substantive: 'var(--accent)' }

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

function deriveCommits(raw) {
  return (Array.isArray(raw.git) ? raw.git : []).map(function (c) {
    const kind = c.kind || (String(c.subject || '').match(/^(feat|fix|docs|test|chore|refactor)/) || [])[1] || 'other'
    return {
      sha: String(c.hash || '').slice(0, 7), kind: kind, kindColor: KIND_COLOR[kind] || 'var(--dim)',
      subject: c.subject || '', author: c.author || '', add: c.add, del: c.del,
      when: rel(c.date), date: c.date || ''
    }
  })
}

// One entry per concept. Bodies no longer travel here (D43 point 4): each entry carries the
// opaque `id` the server minted for it, and views.knowledge fetches one body at a time through
// api.mjs. A string entry is still accepted, which is what a producer older than schema v2
// wrote, and such an entry simply has no id to fetch with.
function deriveFiles(raw) {
  return ((raw.knowledge || {}).files || []).map(function (f) {
    return typeof f === 'string' ? { path: f } : f
  })
}

// The one grouping of the knowledge listing, read by the tree (views/knowledge.mjs) and by the
// overview's per-area counts alike. Every entry of knowledge.files[] lands in exactly one group,
// keyed by the first segment of its path.
//
// Why the first segment rather than the five canonical areas. Section 11 declares memories,
// docs, runs, monitors and logs as the convention, but OQ-7 leaves the bundle's internal layout
// open, so the bundle may legitimately hold a concept the convention does not predict: in a
// directory nobody declared, or at the bundle root itself. Grouping against a fixed list drops
// such a file out of the tree entirely while still counting it in the rail, which is how a file
// became invisible and, once bodies are fetched for the selected file only, unreachable. A view
// that silently drops a file it was given is worse than one that shows an unexpected group. The
// five areas still appear whenever they hold something, because they emerge from the data like
// any other group.
//
// The grouping is a partition, which is what makes the counts add up and what guarantees the
// tree renders exactly one button per file: a nested path contributes to its first segment only,
// so memories/docs/x.md is one entry under memories and not one under each.
//
// Each entry keeps the index it has in files(), because that index is what a tree button carries
// and what selects the file. Grouping reorders the presentation and never the array.
//
// Group order: the canonical areas first, in the order section 11 declares them, then every
// other directory in code-unit order, then the bundle root last. The convention leads because it
// is what a reader expects to find; anything outside it collects below, where it reads as the
// exception it is; the root group is the least ordinary of all, so it closes the list. Code-unit
// order rather than localeCompare, so the same bundle renders identically under every locale.
// Files inside a group keep the snapshot's own order, which the producer already fixed.
function deriveGroups(fileList) {
  const byDir = new Map()
  const rootEntries = []
  fileList.forEach(function (f, i) {
    const parts = String(f.path == null ? '' : f.path).split('/')
    // A single segment is a file at the bundle root. So is a path with an empty first segment
    // (a leading slash) and so is a missing path: neither names a directory to group under.
    if (parts.length < 2 || parts[0] === '') {
      rootEntries.push({ file: f, index: i })
      return
    }
    if (!byDir.has(parts[0])) byDir.set(parts[0], [])
    byDir.get(parts[0]).push({ file: f, index: i })
  })
  const others = []
  byDir.forEach(function (entries, dir) { if (AREAS.indexOf(dir) === -1) others.push(dir) })
  others.sort(function (a, b) { return a < b ? -1 : a > b ? 1 : 0 })
  const out = AREAS.filter(function (a) { return byDir.has(a) })
    .concat(others)
    .map(function (dir) { return { dir: dir, label: dir, entries: byDir.get(dir) } })
  if (rootEntries.length) out.push({ dir: null, label: ROOT_GROUP_LABEL, entries: rootEntries })
  return out
}

// The overview's knowledge tiles: one per canonical area, one per group outside the convention,
// and the total last. Built from the same partition as the tree, so the area tiles now sum to
// the total instead of quietly omitting whatever lives outside the five areas.
//
// What this changes and what it does not. The five canonical tiles are still always rendered,
// at zero when the area is empty, because the convention is what they state. What they count
// changes in one case: an area name is now matched as the first path segment only, so
// memories/docs/x.md counts under memories alone where it used to count under both memories and
// docs. Double counting is precisely what stopped the tiles from adding up.
function deriveCounts(fileList, groupList) {
  const byDir = new Map()
  groupList.forEach(function (g) { if (g.dir !== null) byDir.set(g.dir, g.entries.length) })
  const out = AREAS.map(function (a) { return { label: a, n: byDir.get(a) || 0 } })
  groupList.forEach(function (g) {
    if (g.dir === null || AREAS.indexOf(g.dir) === -1) out.push({ label: g.label, n: g.entries.length })
  })
  out.push({ label: 'concepts', n: fileList.length })
  return out
}

function deriveDecisions(raw, fileList) {
  return Array.isArray(raw.decisions) ? raw.decisions : fileList
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
}

// The timeline key (D41). Optional: a snapshot from a producer older than it lacks the key
// entirely, so a missing or malformed key degrades to an empty view that states what it does
// not have. Commits are deliberately not part of it; the view merges the git key in client side.
//
// `window` no longer carries `byteBudget` and `omitted.reason` can no longer be "bytes"
// (D43 point 4 dropped the 256 KB timeline budget along with the knowledge caps). The days
// horizon, the floor and the ceiling survive untouched, as a legibility choice rather than a
// weight one. A snapshot old enough to still carry a byteBudget simply has a member nothing
// reads; the view states the window it is given and nothing else.
function deriveTimeline(raw) {
  const t = raw.timeline && typeof raw.timeline === 'object' && !Array.isArray(raw.timeline) ? raw.timeline : null
  const source = t && Array.isArray(t.events) ? t.events : []
  const events = source.filter(function (e) { return e && typeof e === 'object' }).map(function (e) {
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
    window: w ? { days: w.days, floorEvents: w.floorEvents, ceilingEvents: w.ceilingEvents } : null,
    omitted: o ? { count: Number(o.count) || 0, oldestKept: o.oldestKept || '', reason: o.reason == null ? null : String(o.reason) } : null
  }
}

// The one place a whole snapshot is turned into the shape the views read.
//
// The top-level guard is the single tolerance this rewrite adds, and it is added because the
// input genuinely changed: the island could only ever hold what the renderer put there, while
// a response body is whatever arrived, including `null` or an array. Everything below it reads
// exactly as defensively as it did before.
function derive(raw) {
  const data = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const config = data.config || {}
  const fileList = deriveFiles(data)
  const groupList = deriveGroups(fileList)
  return {
    data: data,
    cfg: config,
    root: (config.persistence && config.persistence.root) || '.knowledge',
    commits: deriveCommits(data),
    files: fileList,
    groups: groupList,
    counts: deriveCounts(fileList, groupList),
    decisions: deriveDecisions(data, fileList),
    timeline: deriveTimeline(data),
    roadmap: data.roadmap && Array.isArray(data.roadmap.milestones) ? data.roadmap.milestones : [],
    lastRun: data.lastRun || null
  }
}

let CURRENT = derive({})

// Stores one fetched snapshot and derives it. Called by the boot and by every refresh, and by
// nothing else. It throws only if a derivation throws on a genuinely malformed payload, which
// the caller turns into the error state rather than a blank page.
export function setData(raw) {
  CURRENT = derive(raw)
}

export function generatedAt() { return CURRENT.data.generatedAt || '' }
export function cfg() { return CURRENT.cfg }
export function root() { return CURRENT.root }
export function commits() { return CURRENT.commits }
export function files() { return CURRENT.files }
export function groups() { return CURRENT.groups }
export function counts() { return CURRENT.counts }
export function decisions() { return CURRENT.decisions }
export function timeline() { return CURRENT.timeline }
export function roadmap() { return CURRENT.roadmap }
export function lastRun() { return CURRENT.lastRun }
