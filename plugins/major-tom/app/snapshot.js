#!/usr/bin/env node
// Computes the Major Tom dashboard snapshot (schema v2) for a target repository.
// Node, no dependencies beyond the vendored YAML parser in ./vendor (D47 point 2).
//
// This script is the single producer of the snapshot (D43 point 8): the onboard no longer
// computes it in prose, so the window rules of D33 (body caps), D41 (the timeline key and
// its sources) and D42 (git and timeline share one window) exist in exactly one place and
// cannot diverge. The consumer contract lives in templates/README.md, "Snapshot schema v2";
// this file implements it and nothing else.
//
// Usage:
//   node snapshot.js [--repo <dir>] [--out <file>]
//
// --repo defaults to the current working directory; --out defaults to stdout. The script
// writes exactly one file, the --out path, and nothing else anywhere: it never writes into
// the target repository unless --out points there.
//
// Fail closed, with a message on stderr and a non-zero exit, when <repo>/.claude/major-tom.json
// is missing, does not parse, is not an object, does not name persistence.root, or names a
// root that does not exist. No default config is ever improvised.
//
// Determinism is a hard requirement: two runs over the same unchanged repository produce
// byte-identical JSON except for generatedAt. Every sort below is total (every tie is broken
// explicitly) and every directory is walked in sorted order, so no result depends on readdir
// order or on comparison stability. generatedAt is read once and is the single clock every
// window is measured from.
//
// Output: JSON.stringify(snapshot, null, 2) plus a trailing newline, with the six required
// keys generatedAt, config, git, knowledge, decisions, timeline. lastRun and roadmap are
// omitted entirely: no mechanism produces them yet and the dashboard shows honest empty
// states for both.

'use strict'

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const yaml = require('./vendor/js-yaml.cjs.js')

// The window limits, all four literal and all four always reported in timeline.window.
const WINDOW_DAYS = 30
const FLOOR_EVENTS = 50
const CEILING_EVENTS = 500
const BYTE_BUDGET = 262144
// The D33 body caps: 32 KB of body per file, 1 MB of embedded bodies in total.
const BODY_FILE_CAP = 32768
const BODY_TOTAL_CAP = 1048576
const SUMMARY_MAX = 200
const DAY_MS = 86400000

const COMMIT_KINDS = ['feat', 'fix', 'docs', 'test', 'chore', 'refactor']
// A conventional-commit prefix: type, optional scope, optional breaking "!", then the colon.
// The colon is required, so a subject like "fix the build" is "other" rather than "fix".
const KIND_RE = new RegExp('^(' + COMMIT_KINDS.join('|') + ')(\\([^)]*\\))?!?:')

// Record and field separators for the git log format. Neither can occur in a commit
// subject, an author name or an ISO date, so the parse below needs no quoting rules.
const REC_SEP = '\u001e'
const FLD_SEP = '\u001f'

function fail(msg) {
  console.error(`snapshot.js: ${msg}`)
  process.exit(1)
}

function parseArgs(argv) {
  const args = { repo: process.cwd(), out: null }
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === '--repo') {
      if (i + 1 >= argv.length) fail('--repo requires a directory')
      args.repo = argv[i + 1]
      i += 1
    } else if (token === '--out') {
      if (i + 1 >= argv.length) fail('--out requires a file path')
      args.out = argv[i + 1]
      i += 1
    } else {
      fail(`unknown argument ${token}; usage: snapshot.js [--repo <dir>] [--out <file>]`)
    }
  }
  return args
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

// Byte length of a string as it will be written, used for both body caps and the timeline
// byte budget, so every limit is counted in the same unit the artifact is measured in.
function byteLength(text) {
  return Buffer.byteLength(text, 'utf8')
}

// Cuts a string to at most maxBytes bytes without splitting a UTF-8 character: if the byte
// at the cut point is a continuation byte the character started earlier, so the cut moves
// back to that character's boundary. This is the "cut cleanly" of D33.
function cutToBytes(text, maxBytes) {
  const buf = Buffer.from(text, 'utf8')
  if (buf.length <= maxBytes) return { text, truncated: false, bytes: buf.length }
  let end = maxBytes
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end -= 1
  const cut = buf.subarray(0, end)
  return { text: cut.toString('utf8'), truncated: true, bytes: cut.length }
}

// Summaries are capped in characters, not bytes: "at most 200 characters" (D41).
function capSummary(text) {
  const s = String(text)
  if (s.length <= SUMMARY_MAX) return { summary: s, truncated: false }
  return { summary: s.slice(0, SUMMARY_MAX), truncated: true }
}

function toMillis(at) {
  const t = Date.parse(at)
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t
}

// Newest first, ties broken by collection order (seq is unique, so the order is total and
// never depends on the sort being stable). For the intents log, collection order is file
// order, which is what the prose means by "source order"; for git it is the order git log
// emitted. Both the git key and the timeline key sort with this comparator.
function byNewest(a, b) {
  if (a.ms !== b.ms) return a.ms < b.ms ? 1 : -1
  return a.seq - b.seq
}

function nullableString(value) {
  if (value === undefined || value === null) return null
  const s = String(value)
  return s === '' ? null : s
}

// ---------------------------------------------------------------------------------------
// config

function readConfig(repoRoot) {
  const configPath = path.join(repoRoot, '.claude', 'major-tom.json')
  let raw
  try {
    raw = fs.readFileSync(configPath, 'utf8')
  } catch (e) {
    fail(`cannot read ${configPath} (${e.message}); this file is the only source of the config, no default is assumed`)
  }
  let config
  try {
    config = JSON.parse(raw)
  } catch (e) {
    fail(`${configPath} does not parse as JSON (${e.message})`)
  }
  if (!isPlainObject(config)) fail(`${configPath} must hold a JSON object`)
  const root = config.persistence && config.persistence.root
  if (typeof root !== 'string' || root.trim() === '') {
    fail(`${configPath} does not name persistence.root; refusing to guess the knowledge root`)
  }
  const persistenceRoot = path.resolve(repoRoot, root)
  let stat
  try {
    stat = fs.statSync(persistenceRoot)
  } catch (e) {
    fail(`persistence root ${persistenceRoot} does not exist (${e.message}); the repository is not onboarded`)
  }
  if (!stat.isDirectory()) fail(`persistence root ${persistenceRoot} is not a directory`)
  return { config, persistenceRoot }
}

// ---------------------------------------------------------------------------------------
// git

// The git window is the timeline window (D42), so both sides of the merged reading end at
// the same point: the commits of the last 30 days, extended to the 50 most recent when the
// horizon holds fewer, and cut to 500 when it holds more.
function collectGit(repoRoot, generatedAtMs) {
  const format = ['%H', '%aI', '%an', '%s'].join(FLD_SEP)
  let stdout
  try {
    stdout = execFileSync(
      'git',
      ['log', '--numstat', '--no-renames', `--format=${REC_SEP}${format}`],
      { cwd: repoRoot, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }
    )
  } catch (e) {
    // A repository with zero commits makes git log exit non-zero, as does a directory that
    // is not a git repository at all. Both are reported as an empty history rather than as
    // a crash: the absence of commits is a fact about the repository, not a failure.
    return []
  }

  const commits = []
  for (const record of stdout.split(REC_SEP)) {
    if (record.trim() === '') continue
    const seq = commits.length
    const lines = record.split('\n')
    const header = lines[0].split(FLD_SEP)
    if (header.length < 4) continue
    const subject = header.slice(3).join(FLD_SEP)
    let add = 0
    let del = 0
    for (let i = 1; i < lines.length; i += 1) {
      const parts = lines[i].split('\t')
      if (parts.length < 3) continue
      // A binary file reports "-" for both counts; it contributes zero lines, not NaN.
      const a = parts[0] === '-' ? 0 : Number.parseInt(parts[0], 10)
      const d = parts[1] === '-' ? 0 : Number.parseInt(parts[1], 10)
      if (Number.isFinite(a)) add += a
      if (Number.isFinite(d)) del += d
    }
    const kindMatch = KIND_RE.exec(subject)
    commits.push({
      seq,
      ms: toMillis(header[1]),
      entry: {
        hash: header[0],
        date: header[1],
        author: header[2],
        subject,
        kind: kindMatch ? kindMatch[1] : 'other',
        add,
        del,
      },
    })
  }

  // git log emits newest first by committer date; the exposed date is the author date, so
  // the order is re-established explicitly on the field the snapshot actually carries. Ties,
  // which are common because the author date has second resolution, keep the order git
  // emitted, so commits made inside the same second stay in history order instead of being
  // shuffled by an arbitrary key. seq is unique, so the comparison is total and never
  // depends on the sort being stable.
  commits.sort(byNewest)

  const cutoff = generatedAtMs - WINDOW_DAYS * DAY_MS
  const inWindow = commits.filter((c) => c.ms >= cutoff)
  let selected = inWindow.length >= FLOOR_EVENTS ? inWindow : commits.slice(0, FLOOR_EVENTS)
  if (selected.length > CEILING_EVENTS) selected = selected.slice(0, CEILING_EVENTS)
  return selected.map((c) => c.entry)
}

// ---------------------------------------------------------------------------------------
// knowledge

// Walks the persistence root depth first, entries sorted by name at every level, so the
// traversal order is fixed by the tree and never by readdir order. Symlinks are not
// followed: isDirectory() and isFile() are false for them, which keeps the walk finite and
// keeps the snapshot to files that actually live under the root.
function walkMarkdown(root) {
  const out = []
  const stack = ['']
  while (stack.length > 0) {
    const relDir = stack.pop()
    const absDir = path.join(root, relDir)
    let entries
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true })
    } catch (e) {
      continue
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    const dirs = []
    for (const entry of entries) {
      const rel = relDir === '' ? entry.name : `${relDir}/${entry.name}`
      if (entry.isDirectory()) dirs.push(rel)
      else if (entry.isFile() && entry.name.endsWith('.md')) out.push(rel)
    }
    // Pushed in reverse so the stack pops them in sorted order.
    for (let i = dirs.length - 1; i >= 0; i -= 1) stack.push(dirs[i])
  }
  out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  return out
}

// Splits YAML frontmatter from the body. Returns null when the file does not open with a
// "---" line closed by another "---" line, or when the YAML does not parse, or when it
// parses to something other than a mapping: all three mean the file is not an OKF concept.
// A parse failure is a skipped file, never a crashed run and never an invented value.
function splitFrontmatter(raw) {
  const lines = raw.split('\n')
  if (lines.length === 0 || lines[0].trim() !== '---') return null
  let end = -1
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '---') {
      end = i
      break
    }
  }
  if (end === -1) return null
  let frontmatter
  try {
    frontmatter = yaml.load(lines.slice(1, end).join('\n'))
  } catch (e) {
    return null
  }
  if (!isPlainObject(frontmatter)) return null
  return { frontmatter, body: lines.slice(end + 1).join('\n') }
}

// The concepts under the persistence root: every non-reserved .md file carrying YAML
// frontmatter (D28). index.md is reserved at every depth (it is the bundle index, not a
// concept), non-.md files never qualify (so runs/intents.log and the generated
// dashboard.html are out by construction), and a .md without parseable mapping frontmatter
// is not a concept either.
function collectConcepts(persistenceRoot) {
  const concepts = []
  for (const rel of walkMarkdown(persistenceRoot)) {
    if (rel === 'index.md' || rel.endsWith('/index.md')) continue
    const abs = path.join(persistenceRoot, rel)
    let raw
    let stat
    try {
      raw = fs.readFileSync(abs, 'utf8')
      stat = fs.statSync(abs)
    } catch (e) {
      continue
    }
    const split = splitFrontmatter(raw)
    if (!split) continue
    concepts.push({
      path: rel,
      size: stat.size,
      updated: new Date(stat.mtimeMs).toISOString(),
      frontmatter: split.frontmatter,
      body: split.body,
    })
  }
  return concepts
}

// index.md is read for one purpose only, the order in which bodies are embedded, and is
// never itself an entry (D33).
//
// How an index line resolves to a file: the index is authored prose, so its lines are not a
// fixed record format. Every token on the line that looks like a relative path ending in
// .md is extracted in order (this catches the bare "- runs/intents/x.md ..." the intent
// recorder writes, the "[title](path.md)" of a markdown link, and a backticked path alike),
// each candidate is normalized by stripping a leading "./" or "/", and the first candidate
// that matches a collected concept path wins. A line resolving to nothing, to index.md, or
// to a path already seen contributes nothing. Anything the index does not name keeps its
// walk order after the named files.
function indexOrder(persistenceRoot, conceptPaths) {
  const known = new Set(conceptPaths)
  let raw
  try {
    raw = fs.readFileSync(path.join(persistenceRoot, 'index.md'), 'utf8')
  } catch (e) {
    return []
  }
  const ordered = []
  const seen = new Set()
  for (const line of raw.split('\n')) {
    const candidates = line.match(/[A-Za-z0-9._/-]+\.md/g)
    if (!candidates) continue
    for (const candidate of candidates) {
      const rel = candidate.replace(/^\.\//, '').replace(/^\/+/, '')
      if (!known.has(rel) || seen.has(rel)) continue
      seen.add(rel)
      ordered.push(rel)
      break
    }
  }
  return ordered
}

// The knowledge key. Files are emitted in the order the body caps are applied, index order
// first and then the rest in walk order, so the embedded bodies are a visible prefix of the
// list rather than an arbitrary subset of it.
//
// The 1 MB total is read as the prose states it, "only while the running total stays under
// 1 MB": bodies are embedded while the next one still fits the remaining budget, and once
// one does not fit, embedding stops for that file and for every file after it. body and
// truncated are both omitted when no body is embedded, which is exactly what the schema's
// optional markers mean and what the dashboard renders as "body not embedded".
function buildKnowledge(persistenceRoot, concepts) {
  const byPath = new Map(concepts.map((c) => [c.path, c]))
  const order = indexOrder(persistenceRoot, concepts.map((c) => c.path))
  const placed = new Set(order)
  const walkOrder = concepts.map((c) => c.path).filter((p) => !placed.has(p))
  const finalOrder = order.concat(walkOrder)

  const files = []
  let totalBodyBytes = 0
  let embedding = true
  for (const rel of finalOrder) {
    const concept = byPath.get(rel)
    const entry = {
      path: concept.path,
      type: concept.frontmatter.type === undefined ? null : concept.frontmatter.type,
      size: concept.size,
      updated: concept.updated,
      frontmatter: concept.frontmatter,
    }
    if (embedding) {
      const cut = cutToBytes(concept.body, BODY_FILE_CAP)
      if (totalBodyBytes + cut.bytes <= BODY_TOTAL_CAP) {
        totalBodyBytes += cut.bytes
        entry.body = cut.text
        if (cut.truncated) entry.truncated = true
      } else {
        embedding = false
      }
    }
    files.push(entry)
  }
  return { files }
}

// ---------------------------------------------------------------------------------------
// decisions

// Derived from the concepts whose frontmatter type is "decision", in the same order as the
// knowledge files. id falls back to the path, text falls back to the path, and status is
// "open" only when the frontmatter says exactly that and "closed" otherwise.
//
// date is frontmatter.date when the concept declares it, and the file mtime only as the
// fallback: a decision's date is a property of the decision, not of the last time somebody
// touched the file. The mtime already travels in the snapshot as knowledge.files[].updated,
// so repeating it here would spend the field without adding information. The fallback exists
// because no producer writes a date frontmatter key today. The vendored parser returns
// timestamp scalars as strings, so no Date coercion is needed; the value is stringified for
// the same defensive reason id and text are.
function buildDecisions(knowledgeFiles) {
  const decisions = []
  for (const file of knowledgeFiles) {
    const fm = file.frontmatter
    if (fm.type !== 'decision') continue
    decisions.push({
      id: fm.id === undefined || fm.id === null || fm.id === '' ? file.path : String(fm.id),
      text: fm.title === undefined || fm.title === null || fm.title === '' ? file.path : String(fm.title),
      date: fm.date === undefined || fm.date === null || fm.date === '' ? file.updated : String(fm.date),
      status: fm.status === 'open' ? 'open' : 'closed',
    })
  }
  return decisions
}

// ---------------------------------------------------------------------------------------
// timeline

// The three sources, all under the persistence root and nowhere else. .claude/session/ is
// never read (D41): it is gitignored, keyed by prompt id and mutated in place, so a
// committed snapshot built on it would be empty for everyone but its author.
function collectEvents(persistenceRoot, concepts) {
  const candidates = []
  let seq = 0

  const push = (event) => {
    event.seq = seq
    event.ms = toMillis(event.event.at)
    seq += 1
    candidates.push(event)
  }

  // Source 1: runs/intents.log, the trivial and task intents, in file order.
  //
  // Columns are timestamp, tier, type, promptId, sessionId, summary, with the summary always
  // last. Each line is split on tabs and branched on the field count, never on the content:
  // six or more fields is the post-D41 format, where field five is the session id and the
  // summary is field six onward rejoined with tabs, so a summary containing a tab is not
  // corrupted; exactly five fields is a pre-D41 line, whose session id is null and whose
  // summary is field five. Known limitation of the legacy format, stated rather than papered
  // over: a pre-D41 line whose own summary contained a tab also splits into six or more
  // fields and is indistinguishable from a post-D41 line, so its first summary chunk is read
  // as a session id. That reading is accepted; no heuristic on the value shape guesses around
  // it. Lines with fewer than five fields are not a known format at all and are skipped.
  let logRaw = null
  try {
    logRaw = fs.readFileSync(path.join(persistenceRoot, 'runs', 'intents.log'), 'utf8')
  } catch (e) {
    logRaw = null
  }
  if (logRaw !== null) {
    for (const line of logRaw.split('\n')) {
      if (line.trim() === '') continue
      const fields = line.split('\t')
      let sessionId
      let summaryRaw
      if (fields.length >= 6) {
        sessionId = nullableString(fields[4])
        summaryRaw = fields.slice(5).join('\t')
      } else if (fields.length === 5) {
        sessionId = null
        summaryRaw = fields[4]
      } else {
        continue
      }
      const capped = capSummary(summaryRaw)
      push({
        event: {
          at: fields[0],
          kind: 'intent',
          tier: nullableString(fields[1]),
          type: nullableString(fields[2]),
          promptId: nullableString(fields[3]),
          sessionId,
          summary: capped.summary,
          summaryTruncated: capped.truncated,
          path: null,
        },
      })
    }
  }

  // Source 2: runs/intents/*.md, the substantive intent concepts. Matched by path, as the
  // prose states, so the direct children of runs/intents/ that are concepts are the intents.
  const intentPathRe = /^runs\/intents\/[^/]+\.md$/
  for (const concept of concepts) {
    if (!intentPathRe.test(concept.path)) continue
    const fm = concept.frontmatter
    // at comes from recorded_at; when a concept lacks it the file mtime stands in, the same
    // fallback the run records use, so an event is never dropped and no date is invented.
    const at = nullableString(fm.recorded_at) || concept.updated
    const capped = capSummary(concept.body.trim())
    push({
      event: {
        at,
        kind: 'intent',
        tier: nullableString(fm.tier),
        type: nullableString(fm.request_type),
        promptId: nullableString(fm.prompt_id),
        sessionId: nullableString(fm.session_id),
        summary: capped.summary,
        summaryTruncated: capped.truncated,
        path: concept.path,
      },
    })
  }

  // Source 3: the run records under runs/ whose frontmatter type is "run". A file under
  // runs/intents/ is already an intent by source 2 and is never counted twice here.
  for (const concept of concepts) {
    if (!concept.path.startsWith('runs/')) continue
    if (intentPathRe.test(concept.path)) continue
    const fm = concept.frontmatter
    if (fm.type !== 'run') continue
    // The onboard writes generated: {by, at}; a plain string generated: <timestamp> is
    // accepted too. Without either, the file mtime is the timestamp.
    let at = null
    if (isPlainObject(fm.generated)) at = nullableString(fm.generated.at)
    else if (fm.generated !== undefined) at = nullableString(fm.generated)
    if (!at) at = concept.updated
    const capped = capSummary(fm.title === undefined || fm.title === null || fm.title === '' ? concept.path : String(fm.title))
    push({
      event: {
        at,
        kind: 'run',
        tier: null,
        type: null,
        promptId: null,
        sessionId: null,
        summary: capped.summary,
        summaryTruncated: capped.truncated,
        path: concept.path,
      },
    })
  }

  return candidates
}

// Selection, in exactly the order the prose states, so two runs over the same repository
// produce the same key:
//   1. collect every candidate from the three sources;
//   2. sort newest first by at, ties broken by source order;
//   3. keep the events inside the last 30 days, measured from generatedAt;
//   4. floor: when that leaves fewer than 50, extend to the 50 newest overall, however old;
//   5. ceiling: cut to at most 500;
//   6. byte budget: while the JSON encoding of events exceeds 262144 bytes, drop from the
//      oldest end, always at an event boundary and never mid-event;
//   7. omitted records how many candidates did not make it, the at of the oldest kept event,
//      and which limit bit last.
// reason names the last limit that actually removed events, so a later limit overwrites an
// earlier one and a limit that removed nothing never claims the omission.
function buildTimeline(candidates, generatedAtMs) {
  const sorted = candidates.slice().sort(byNewest)
  const total = sorted.length
  let reason = null

  const cutoff = generatedAtMs - WINDOW_DAYS * DAY_MS
  const inWindow = sorted.filter((c) => c.ms >= cutoff)
  let kept = inWindow.length >= FLOOR_EVENTS ? inWindow : sorted.slice(0, FLOOR_EVENTS)
  if (kept.length < total) reason = 'days'

  if (kept.length > CEILING_EVENTS) {
    kept = kept.slice(0, CEILING_EVENTS)
    reason = 'ceiling'
  }

  let events = kept.map((c) => c.event)
  // The budget is measured on the compact JSON encoding of the events array, the same unit
  // the 262144 literal is written in.
  if (byteLength(JSON.stringify(events)) > BYTE_BUDGET) {
    while (events.length > 0 && byteLength(JSON.stringify(events)) > BYTE_BUDGET) {
      events = events.slice(0, events.length - 1)
    }
    reason = 'bytes'
  }

  const omittedCount = total - events.length
  return {
    events,
    window: {
      days: WINDOW_DAYS,
      floorEvents: FLOOR_EVENTS,
      ceilingEvents: CEILING_EVENTS,
      byteBudget: BYTE_BUDGET,
    },
    omitted: {
      count: omittedCount,
      oldestKept: events.length > 0 ? events[events.length - 1].at : null,
      reason: omittedCount > 0 ? reason : null,
    },
  }
}

// ---------------------------------------------------------------------------------------
// main

function main() {
  const args = parseArgs(process.argv.slice(2))
  const repoRoot = path.resolve(args.repo)
  let repoStat
  try {
    repoStat = fs.statSync(repoRoot)
  } catch (e) {
    fail(`repo ${repoRoot} does not exist (${e.message})`)
  }
  if (!repoStat.isDirectory()) fail(`repo ${repoRoot} is not a directory`)

  // The single clock: read once, used for the git window and the timeline window alike, so
  // both sides of the merged reading end at the same point (D42).
  const generatedAt = new Date().toISOString()
  const generatedAtMs = Date.parse(generatedAt)

  const { config, persistenceRoot } = readConfig(repoRoot)
  const concepts = collectConcepts(persistenceRoot)
  const knowledge = buildKnowledge(persistenceRoot, concepts)

  const snapshot = {
    generatedAt,
    config,
    git: collectGit(repoRoot, generatedAtMs),
    knowledge,
    decisions: buildDecisions(knowledge.files),
    timeline: buildTimeline(collectEvents(persistenceRoot, concepts), generatedAtMs),
  }

  const out = JSON.stringify(snapshot, null, 2) + '\n'
  if (args.out) {
    try {
      fs.writeFileSync(args.out, out)
    } catch (e) {
      fail(`cannot write ${args.out} (${e.message})`)
    }
  } else {
    process.stdout.write(out)
  }
}

main()
