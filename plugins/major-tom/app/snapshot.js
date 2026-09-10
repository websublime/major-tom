#!/usr/bin/env node
// Computes the Major Tom dashboard snapshot (schema v2) for a target repository.
// Node, no dependencies beyond the vendored YAML parser in ./vendor (D47 point 2).
//
// This script is the single producer of the snapshot (D43 point 8): the onboard no longer
// computes it in prose, so the window rules of D41 (the timeline key and its sources), D42
// (git and timeline share one window) and D45 (that window is a parameter) exist in exactly
// one place and cannot diverge. The consumer contract lives in
// plugins/major-tom/app/README.md, "Snapshot schema v2"; this file implements it and nothing
// else.
//
// Two entry points, one concept walk:
//
//   const { buildSnapshot, readConceptBody } = require('./snapshot.js')  // the server's reads
//   node snapshot.js [--repo <dir>] [--out <file>]                       // the CLI
//
// buildSnapshot({repoRoot, days, limit}) returns the snapshot object. days and limit are
// optional overrides of the window the config carries; absent, the configured value applies.
// The CLI, which runs only when this file is the process entry point, is that same call plus
// argument parsing and output, always at the configured window: it is how a human inspects
// exactly what the server will serve, and it is what the test suite drives.
//
// readConceptBody({repoRoot, id}) returns the body of the one concept that id addresses, or
// null when no concept has it. It lives here rather than in the server so that no caller ever
// holds a knowledge path; its own comment states the case.
//
// --repo defaults to the current working directory; --out defaults to stdout. The CLI writes
// exactly one file, the --out path, and nothing else anywhere: it never writes into the
// target repository unless --out points there.
//
// Fail closed when <repo>/.claude/major-tom.json is missing, does not parse, is not an
// object, does not name persistence.root, names a root that does not exist, or carries no
// snapshot block for buildSnapshot to read its window from. No default config is ever
// improvised. The two entry points fail closed differently, and deliberately:
// every check calls fail(), which throws a SnapshotError, so the library caller sees an
// exception it can answer with a 500 while the process keeps serving; only the CLI wrapper
// turns that exception into a stderr line and a non-zero exit. The checks themselves exist
// once and neither path can drift from the other.
//
// Determinism is a hard requirement: two runs over the same unchanged repository produce
// byte-identical JSON except for generatedAt. Every sort below is total (every tie is broken
// explicitly) and every directory is walked in sorted order, so no result depends on readdir
// order or on comparison stability. generatedAt is read once and is the single clock every
// window is measured from.
//
// Output: JSON.stringify(snapshot, null, 2) plus a trailing newline, with the six required
// keys generatedAt, config, git, knowledge, decisions, timeline. lastRun is added when a run
// record carries a run block and is omitted entirely otherwise. roadmap is always omitted: no
// mechanism produces it and the dashboard shows an honest empty state for it.

'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('node:crypto')
const { execFileSync } = require('child_process')
const yaml = require('./vendor/js-yaml.cjs.js')

// The window limits, all three still reported in timeline.window, but only one of them a
// constant since D45. What did not change is why they exist: they are a legibility limit and
// not a weight one (D43 point 4), a reader can hold the last 30 days of a project in their
// head, and the floor and the ceiling keep that true for a repository that had a quiet month
// and for one that had a frantic week alike. What changed is who chooses them.
//
// The horizon and the ceiling are now a configured default that a request may move, so the
// numbers D41 and D42 fixed, 30 days and 500 entries, appear nowhere in this file as defaults:
// they live in .claude/major-tom.json (D45 point 3), which is the single source of truth for
// them, and a fallback here would leave two sources for one number and let them disagree
// unnoticed. What is here instead are the hard bounds a value must sit inside, whichever of the
// two it came from, and they are the same bounds config.schema.json states, so an invalid
// default is caught at onboard validation and not only at read time. That the shipped default
// for the ceiling happens to equal its maximum is a fact about the config the onboard writes,
// not a default this file keeps.
//
// A value outside the bounds is refused and never clamped (D45 point 2): the ceiling is not
// decoration, it is what stops a request asking for an unbounded response, and a clamp would
// serve one window while the caller asked for another.
const DAYS_MIN = 1
const DAYS_MAX = 365

// The floor is the one that stays literal. It is server behavior and not a parameter (D45
// point 1): it exists so the view is never empty, and exposing all three would invite
// combinations that mean nothing, a floor above the ceiling first among them. It is also the
// ceiling's own minimum, which is what removes that combination from the parameter space: a
// request for a ceiling of 10 would return 50 entries and quietly lie about the limit it
// applied.
const FLOOR_EVENTS = 50
const LIMIT_MIN = FLOOR_EVENTS
const LIMIT_MAX = 500

// The bounds as one value, exported so a caller that refuses a bad value before calling (the
// server answering a query string with a 400) reads them from here rather than restating them.
const WINDOW_BOUNDS = Object.freeze({
  days: Object.freeze({ min: DAYS_MIN, max: DAYS_MAX }),
  limit: Object.freeze({ min: LIMIT_MIN, max: LIMIT_MAX }),
})

const SUMMARY_MAX = 200
const DAY_MS = 86400000

// A concept that is an intent, matched by path. The direct children of runs/intents/ are the
// intents; every other concept under runs/ that declares type: run is a run record. Both the
// timeline and the lastRun key branch on this, so the two cannot disagree about which files
// are runs.
const INTENT_PATH_RE = /^runs\/intents\/[^/]+\.md$/

// The length of a knowledge file's id, in hex characters. 16 hex characters is 64 bits of
// the SHA-256 of the path: by the birthday bound a bundle would need on the order of 2^32
// concepts before a collision became likely, and a bundle of four billion files is not a
// realistic object. Short enough to read in a URL, long enough that the id can be treated as
// unique without the producer having to check.
const ID_HEX_LENGTH = 16

const COMMIT_KINDS = ['feat', 'fix', 'docs', 'test', 'chore', 'refactor']
// A conventional-commit prefix: type, optional scope, optional breaking "!", then the colon.
// The colon is required, so a subject like "fix the build" is "other" rather than "fix".
const KIND_RE = new RegExp('^(' + COMMIT_KINDS.join('|') + ')(\\([^)]*\\))?!?:')

// Record and field separators for the git log format. Neither can occur in a commit
// subject, an author name or an ISO date, so the parse below needs no quoting rules.
const REC_SEP = '\u001e'
const FLD_SEP = '\u001f'

// The one failure type this file raises. Named so a caller can tell a refused input (a
// repository that is not onboarded, a config that does not parse) from a genuine defect, and
// answer the first with a message instead of a stack trace.
class SnapshotError extends Error {
  constructor(msg, parameter) {
    super(msg)
    this.name = 'SnapshotError'
    // Which request parameter the caller got wrong, when a request parameter is what failed,
    // and null for every other fail-closed condition. It carries the one distinction the
    // message cannot: a refused days or limit is a bad request, a missing config or a missing
    // persistence root is a broken repository, and the two have different remedies, so a
    // server must be able to answer the first with a 400 and the second with a 500 without
    // matching on message text. The message always names the parameter, the value received and
    // the accepted range anyway, so a caller that only forwards the text still tells its user
    // what to change.
    this.parameter = parameter === undefined ? null : parameter
  }
}

// Every fail-closed check calls this, and it always throws. The process only ever exits from
// the CLI wrapper at the bottom of the file: a server must not die because one request named
// a bad repository.
function fail(msg) {
  throw new SnapshotError(msg)
}

// The same, for the refusal of a window parameter the caller passed in.
function failParameter(parameter, msg) {
  throw new SnapshotError(msg, parameter)
}

// A value as it should read back inside a message: a string is quoted, so an empty or padded
// one is visible; a container is named rather than dumped; everything else is stringified as
// itself, which keeps NaN and Infinity legible where JSON.stringify would turn them into null.
function describeValue(value) {
  if (typeof value === 'string') return JSON.stringify(value)
  if (value !== null && typeof value === 'object') return Array.isArray(value) ? 'an array' : 'an object'
  return String(value)
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
  return { config, configPath, persistenceRoot }
}

// ---------------------------------------------------------------------------------------
// the window

// One window parameter, resolved from the override the caller passed and the default the
// config carries, in that order of precedence: an absent override means the configured value
// applies, which is what makes the query parameter of D45 point 3 a temporary adjustment made
// in the page rather than a second place the project's window is decided.
//
// Both are refused the same way and for the same reason (D45 point 2), and neither is ever
// repaired: a non-integer or out-of-range value is answered with an error instead of being
// pulled back inside the bounds, because a clamp would serve a window nobody asked for and
// report it as though it had been. Only the source of the bad value differs, and with it the
// remedy the message names: a bad override is the caller's to fix, a bad default is the
// config's, and the config's is fixed by re-running the onboard.
//
// Integer means integer: a float, a numeric string and NaN are all refused rather than
// coerced, so the one accepted spelling of a window value is a number the caller meant.
function resolveParameter(name, override, configured, min, max, configPath) {
  if (override !== undefined && override !== null) {
    if (!Number.isInteger(override) || override < min || override > max) {
      failParameter(
        name,
        `${name} must be an integer between ${min} and ${max}, received ${describeValue(override)}`
      )
    }
    return override
  }
  if (!Number.isInteger(configured) || configured < min || configured > max) {
    fail(
      `${configPath} sets snapshot.${name} to ${describeValue(configured)}; it must be an integer between ` +
        `${min} and ${max}. Re-run the major-tom onboard to write a valid value`
    )
  }
  return configured
}

// The window the whole snapshot is cut to: the configured default of D45 point 3, moved by
// the optional overrides.
//
// A config with no snapshot block is refused and never defaulted, which is the direct
// consequence of that same point: the default lives in the config precisely so that this file
// carries none, and a fallback here would put the number back in two places. The cost is
// accepted rather than hidden: a project onboarded before this block existed cannot serve its
// dashboard until it is re-onboarded, which is exactly the situation D46's session-start hook
// already reports to the user, that the project's generated artifacts were written by an older
// plugin and the action is to re-run the onboard. The message says the same thing at the point
// of failure, so a user who never saw the notice still learns what to do.
function resolveWindow(config, configPath, options) {
  const block = config.snapshot
  if (!isPlainObject(block)) {
    fail(
      `${configPath} carries no snapshot block, so the window has no configured default and none is assumed ` +
        `here. Re-run the major-tom onboard to write it`
    )
  }
  return {
    days: resolveParameter('days', options.days, block.days, DAYS_MIN, DAYS_MAX, configPath),
    limit: resolveParameter('limit', options.limit, block.limit, LIMIT_MIN, LIMIT_MAX, configPath),
  }
}

// The one window both streams are cut by (D42, made a parameter by D45 point 4), computed once
// per snapshot and handed to the git walk and the timeline walk as the same value. That is the
// whole mechanism behind "the parameter moves both streams together": there is one selection
// object and one selection rule, so a window change is one substitution in one place rather
// than two that would have to agree, and the ragged reading D42 exists to prevent cannot come
// back through a stream that was left behind.
function windowSelection(generatedAtMs, resolved) {
  return {
    days: resolved.days,
    cutoffMs: generatedAtMs - resolved.days * DAY_MS,
    floor: FLOOR_EVENTS,
    ceiling: resolved.limit,
  }
}

// The selection itself, in exactly the order the prose states, so two runs over the same
// repository produce the same result and so both streams produce it the same way:
//   1. take the candidates, already sorted newest first;
//   2. keep the ones inside the horizon, measured from generatedAt;
//   3. floor: when that leaves fewer than 50, extend to the 50 newest overall, however old;
//   4. ceiling: cut to at most the effective limit;
//   5. report which limit bit last.
// reason names the last limit that actually removed entries, so a later limit overwrites an
// earlier one and a limit that removed nothing never claims the omission. Its values are
// therefore "days", "ceiling" and null, and nothing else. Only the timeline reports it; the
// git key carries entries and no bookkeeping, which is the D42 field set unchanged.
function selectInWindow(sorted, selection) {
  const inWindow = sorted.filter((c) => c.ms >= selection.cutoffMs)
  let kept = inWindow.length >= selection.floor ? inWindow : sorted.slice(0, selection.floor)
  let reason = kept.length < sorted.length ? 'days' : null
  if (kept.length > selection.ceiling) {
    kept = kept.slice(0, selection.ceiling)
    reason = 'ceiling'
  }
  return { kept, reason }
}

// ---------------------------------------------------------------------------------------
// git

// The git window is the timeline window (D42), so both sides of the merged reading end at the
// same point: the commits inside the horizon, extended to the 50 most recent when the horizon
// holds fewer, and cut to the effective limit when it holds more. It is handed the same
// selection object the timeline gets and applies it through the same selectInWindow, so the
// horizon a request asks for moves both streams or neither (D45 point 4).
function collectGit(repoRoot, selection) {
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

  return selectInWindow(commits, selection).kept.map((c) => c.entry)
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

// index.md is read for one purpose only, the order the knowledge files are listed in, and is
// never itself an entry.
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

// The id a knowledge file is addressed by (D43 point 4, as the body endpoint needs it): a
// prefix of the SHA-256 of the path relative to the persistence root, hex encoded.
//
// Derived from the path and from nothing else, so it is the same on every machine and on
// every run, and an edit to the file does not change it. Opaque on purpose: the endpoint that
// serves a body takes one of these and resolves it against the list the concept walk built,
// so a request can never name a file the walk did not select, and no path travels from the
// client to the filesystem. The digest is one-way, so the id also carries no path to read out
// of it.
function conceptId(relPath) {
  return crypto.createHash('sha256').update(relPath, 'utf8').digest('hex').slice(0, ID_HEX_LENGTH)
}

// The knowledge key: one entry per concept, carrying its id, its path, its frontmatter and
// the file facts, and never its body. Bodies are fetched one at a time from the server
// instead (D43 point 4), so a listing costs the same whether the bundle holds ten concepts or
// a thousand, and there is no cap to cut anything against.
//
// The order is index order first, then everything the index does not name in walk order. Its
// reason is presentation, not truncation: index.md is the OKF bundle's progressive-disclosure
// mechanism (D28), so the order it imposes is the order the bundle's author wants it read,
// and the listing honors it.
function buildKnowledge(persistenceRoot, concepts) {
  const byPath = new Map(concepts.map((c) => [c.path, c]))
  const order = indexOrder(persistenceRoot, concepts.map((c) => c.path))
  const placed = new Set(order)
  const walkOrder = concepts.map((c) => c.path).filter((p) => !placed.has(p))
  const finalOrder = order.concat(walkOrder)

  const files = []
  for (const rel of finalOrder) {
    const concept = byPath.get(rel)
    files.push({
      id: conceptId(concept.path),
      path: concept.path,
      type: concept.frontmatter.type === undefined ? null : concept.frontmatter.type,
      size: concept.size,
      updated: concept.updated,
      frontmatter: concept.frontmatter,
    })
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
// run records
//
// Two readers walk the same run records, the timeline's third source and the lastRun key, so
// what a run record is and when it happened are decided here once.

// A run record is a concept under runs/, outside runs/intents/, that declares type: run.
function isRunRecord(concept) {
  return (
    concept.path.startsWith('runs/') &&
    !INTENT_PATH_RE.test(concept.path) &&
    concept.frontmatter.type === 'run'
  )
}

// When a run record happened. The onboard writes generated: {by, at}; a plain string
// generated: <timestamp> is accepted too. Without either, the file mtime stands in, so a
// record is never dropped and no date is invented.
function runRecordAt(concept) {
  const fm = concept.frontmatter
  let at = null
  if (isPlainObject(fm.generated)) at = nullableString(fm.generated.at)
  else if (fm.generated !== undefined) at = nullableString(fm.generated)
  return at || concept.updated
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
  for (const concept of concepts) {
    if (!INTENT_PATH_RE.test(concept.path)) continue
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
    if (!isRunRecord(concept)) continue
    const fm = concept.frontmatter
    const capped = capSummary(fm.title === undefined || fm.title === null || fm.title === '' ? concept.path : String(fm.title))
    push({
      event: {
        at: runRecordAt(concept),
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

// The timeline key: the candidates of the three sources, sorted newest first with ties broken
// by source order, cut by the same selectInWindow the git key applies, and the bookkeeping the
// git key does not carry.
//
// window reports the window that was actually applied and not the one the config holds, so a
// page served under an override states the window it is showing rather than the project's
// default. floorEvents is the server constant, ceilingEvents is the effective limit.
//
// omitted records how many candidates did not make it, the at of the oldest kept event, and
// which limit bit last; selectInWindow decides the last of the three.
function buildTimeline(candidates, selection) {
  const sorted = candidates.slice().sort(byNewest)
  const total = sorted.length
  const { kept, reason } = selectInWindow(sorted, selection)
  const events = kept.map((c) => c.event)

  const omittedCount = total - events.length
  return {
    events,
    window: {
      days: selection.days,
      floorEvents: selection.floor,
      ceilingEvents: selection.ceiling,
    },
    omitted: {
      count: omittedCount,
      oldestKept: events.length > 0 ? events[events.length - 1].at : null,
      reason: omittedCount > 0 ? reason : null,
    },
  }
}

// ---------------------------------------------------------------------------------------
// the last run

// The one shape a run record's instant may take, and the same rule the producer pins on every
// report it collects (plugins/major-tom/workflows/onboard.js, the STAMP schema). The workflow
// runtime lets neither file import the other, so the two literals are held equal by a test in
// tests/snapshot.test.js instead of by a shared module.
//
// The form is narrow because a wider one cannot be read the same way twice. A stamp with no Z,
// or with an offset, is parsed against whatever timezone the reader runs in, so one repository
// would report different spans on different machines and break the byte-identical guarantee
// this file makes. A value that is not a string is not an instant either.
const RUN_STAMP_PATTERN = '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}Z$'
const RUN_STAMP = new RegExp(RUN_STAMP_PATTERN)

// The instant a value states, or null when the value states none.
function runStamp(value) {
  return typeof value === 'string' && RUN_STAMP.test(value) ? value : null
}

// A span between two of the record's instants, in the spelling the lifecycle strip displays.
// The record stores instants and the view does no arithmetic, so the formatting rule lives
// here and reads:
//
//   under a minute      seconds with one decimal, 0.0s and 12.0s
//   a minute and over   whole minutes and whole seconds, 1m 13s
//   an hour and over    whole hours and whole minutes, 1h 2m
//
// The seconds go at an hour because they are noise beside a running total that large and the
// phase cell is one narrow line. Every stamp is a whole second, so the decimal is always a
// zero, and the branch is chosen on the rounded value, so 60 seconds reads as 1m 0s and never
// as 60.0s.
//
// Null when either value is not an instant, and null when the end precedes the start. Neither
// is a span, and the caller omits the field rather than inventing a value for it. No clock is
// read here, and both instants come from the record, which is what keeps two runs over an
// unchanged repository byte identical.
function formatSpan(fromAt, toAt) {
  const from = runStamp(fromAt)
  const to = runStamp(toAt)
  if (from === null || to === null) return null
  const ms = Date.parse(to) - Date.parse(from)
  if (!Number.isFinite(ms) || ms < 0) return null

  const tenths = Math.round(ms / 100)
  if (tenths < 600) return `${(tenths / 10).toFixed(1)}s`
  const seconds = Math.round(ms / 1000)
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  const minutes = Math.round(ms / 60000)
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

// The statuses a run record may state for a phase, which are the ones the onboard writes.
const PHASE_STATUS = new Set(['done', 'active', 'failed'])

// One run record's run block, read into the lastRun shape, or null when the block does not
// carry a run.
//
// A usable block is a mapping whose phases are an array holding at least one mapping.
// Everything below that is skipped rather than repaired, exactly as an unparseable concept is
// skipped, so a broken record never fails the snapshot and never shadows the sound older run
// behind it. Everything above it is read leniently, so a missing scalar is null, because a run
// that did not state its mode is a fact about the record and not a reason to discard it.
//
// A status the record states as done, active or failed is passed through and anything else is
// read as pending. failed is not softened here. The onboard records it for a phase whose agent
// did not complete while the run itself carried on, and the reader has no business turning that
// back into a phase that never started.
//
// elapsed and duration are omitted when no pair of instants supports them, which is the
// ordinary case for the phase writing the record, because it is still active and has no finish,
// so its elapsed is absent rather than zero or empty.
function readRunBlock(concept) {
  const block = concept.frontmatter.run
  if (!isPlainObject(block)) return null
  if (!Array.isArray(block.phases)) return null

  const phases = []
  for (const entry of block.phases) {
    if (!isPlainObject(entry)) continue
    const phase = {
      name: nullableString(entry.name),
      artifact: nullableString(entry.artifact),
      status: PHASE_STATUS.has(entry.status) ? entry.status : 'pending',
    }
    const elapsed = formatSpan(entry.startedAt, entry.finishedAt)
    if (elapsed !== null) phase.elapsed = elapsed
    phases.push(phase)
  }
  if (phases.length === 0) return null

  // id falls back to the record's path, the same fallback buildDecisions makes for a decision
  // that names no id. The path is a fact about the record; nothing here is invented.
  const lastRun = {
    id: nullableString(block.id) || concept.path,
    workflow: nullableString(block.workflow),
    mode: nullableString(block.mode),
  }
  const duration = formatSpan(block.startedAt, block.finishedAt)
  if (duration !== null) lastRun.duration = duration
  lastRun.phases = phases
  return lastRun
}

// The lastRun key: the newest run record carrying a usable run block.
//
// It reads the concept list and never timeline.events. A repository whose last run fell out of
// the window still has a last run, and a key that vanished when a reader narrowed the window
// would be a bug the window control could produce at will. lastRun is not a windowed concept
// and no selection is applied to it.
//
// The ordering is the timeline's ordering. Candidates carry the same instant runRecordAt gives
// the timeline's run events and are sorted by the same byNewest, with seq taken from the
// concept walk, which is path sorted. Two runs recorded in the same second therefore resolve
// the same way here and in the timeline, and they resolve the same way on every machine.
//
// Returns null when no record carries a block, and the caller then omits the key entirely, so
// a repository with no producer keeps the honest empty state the dashboard already draws and
// nothing needs migrating.
function buildLastRun(concepts) {
  const candidates = []
  for (const concept of concepts) {
    if (!isRunRecord(concept)) continue
    if (concept.frontmatter.run === undefined) continue
    candidates.push({ seq: candidates.length, ms: toMillis(runRecordAt(concept)), concept })
  }
  candidates.sort(byNewest)
  for (const candidate of candidates) {
    const lastRun = readRunBlock(candidate.concept)
    if (lastRun !== null) return lastRun
  }
  return null
}

// ---------------------------------------------------------------------------------------
// the snapshot

// The whole computation, and the only place it lives. The server calls this per request; the
// CLI below calls it once. Throws a SnapshotError on any of the fail-closed conditions and
// returns the snapshot object otherwise; it reads the filesystem and writes nothing.
//
// options.days and options.limit are the window overrides of D45. Both are optional and
// independent: an absent one leaves the configured default in force, so a caller may move one
// without having to restate the other.
//
// The order of the two judgements is the same one readConceptBody documents, and for the same
// reason: the repository is diagnosed before the request. The config has to be read first
// anyway, since it is where the default lives, so a repository that is not onboarded reports
// that whatever the request asked for. The window is then resolved before anything is walked,
// so a refused parameter costs no filesystem work beyond the config read.
function buildSnapshot(options) {
  const opts = options || {}
  const repoRoot = path.resolve(opts.repoRoot || process.cwd())
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

  const { config, configPath, persistenceRoot } = readConfig(repoRoot)
  const selection = windowSelection(generatedAtMs, resolveWindow(config, configPath, opts))
  const concepts = collectConcepts(persistenceRoot)
  const knowledge = buildKnowledge(persistenceRoot, concepts)

  const snapshot = {
    generatedAt,
    config,
    git: collectGit(repoRoot, selection),
    knowledge,
    decisions: buildDecisions(knowledge.files),
    timeline: buildTimeline(collectEvents(persistenceRoot, concepts), selection),
  }

  // lastRun is added only when a run record carries a run block. It is read from the concepts
  // rather than from the timeline, so the window never decides whether the key exists.
  const lastRun = buildLastRun(concepts)
  if (lastRun !== null) snapshot.lastRun = lastRun

  return snapshot
}

// The body of one concept, addressed by the id buildKnowledge minted for it (D43 point 8).
//
// Why the lookup lives here rather than in the server: the alternative was to export the
// concept walk and let the caller match the id and read the file, and that would put a
// knowledge path in the server's hands. It never holds one. It hands over an opaque id and
// receives a body or nothing, so "no path parameter is ever taken from a request" is a
// property of the module boundary rather than a property of how carefully the server was
// written. The concept walk and the frontmatter split also stay single-sourced: the body this
// returns is by construction the same body the listing described.
//
// The list is recomputed on every call. There is no cache, for the same reason the snapshot
// route has none: state the server does not keep is state that cannot go stale, and an edit on
// disk is visible to the next request.
//
// The order of the two judgements below is the contract, not an accident of writing. The
// config is read first and the id is judged second, so the repository is diagnosed before the
// request is: a repository that is not onboarded throws a SnapshotError whatever the query
// string said, and a well-formed repository answers a missing, empty or non-string id with
// null. The reverse order, which this function used to have, made one broken repository
// report two different things through the one endpoint, a 404 for /api/knowledge/body and a
// 500 naming the missing config for /api/knowledge/body?id=x, so the diagnosis a caller got
// depended on how malformed its own request was.
//
// What that costs, stated rather than hidden: a call that names no repository at all now
// reads the working directory's config before it can answer, so readConceptBody({}) is no
// longer answerable without touching the filesystem, and a malformed id against a broken
// repository now costs one config read. Neither is paid by the server, which validated its
// repo root at startup and passes it on every call. The check is cheap in the case that
// matters: readConfig runs before the id test, but the concept walk still runs after it, so a
// malformed id never walks the bundle.
//
// A malformed query string against a sound repository is still a request the server answers
// with a 404 and never a fault, which is the property the id test exists to hold.
//
// It takes no window parameter and reads none: a body is a body, and the window of D45 selects
// which entries a listing carries, not how much of one file is returned. It therefore never
// consults the config's snapshot block either, so a body still resolves in a repository whose
// config predates that block, which buildSnapshot refuses.
function readConceptBody(options) {
  const repoRoot = path.resolve((options && options.repoRoot) || process.cwd())
  const { persistenceRoot } = readConfig(repoRoot)
  const id = options && options.id
  if (typeof id !== 'string' || id === '') return null
  for (const concept of collectConcepts(persistenceRoot)) {
    if (conceptId(concept.path) === id) return concept.body
  }
  return null
}

module.exports = { buildSnapshot, readConceptBody, SnapshotError, WINDOW_BOUNDS }

// ---------------------------------------------------------------------------------------
// CLI

// The only place in this file that writes, and the only place that exits. Every fail-closed
// condition arrives here as a SnapshotError thrown by fail(), so the message and the non-zero
// exit are produced once, for argument errors and computation errors alike. Anything that is
// not a SnapshotError is a defect and is rethrown with its stack intact rather than being
// dressed up as a user-facing message.
function main(argv) {
  const args = parseArgs(argv)
  const snapshot = buildSnapshot({ repoRoot: args.repo })
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

if (require.main === module) {
  try {
    main(process.argv.slice(2))
  } catch (e) {
    if (!(e instanceof SnapshotError)) throw e
    console.error(`snapshot.js: ${e.message}`)
    process.exit(1)
  }
}
