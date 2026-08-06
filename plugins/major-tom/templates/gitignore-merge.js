#!/usr/bin/env node
// Writes the managed Major Tom block into the target project's .gitignore (D38, D40).
// Node, no dependencies. The block lists the paths that are mechanism state and never
// knowledge: the git worktrees used for delegated work (D38), the per-session
// turn-correlation state (D36), and the generated dashboard server copy (D32). None of
// them is authored by anyone, none of them survives a reclone, so none of them belongs in
// the history of the project.
//
// Usage: node gitignore-merge.js [repo-root]        repo-root defaults to .
//
// Policy: the block between "# major-tom:begin" and "# major-tom:end" is managed and
// rewritten whole on every run; every byte before the begin marker and after the end
// marker is preserved untouched. A file without markers gets the block appended after one
// blank line, keeping its own content intact. Entries that already exist outside the block
// are never removed and never deduplicated: the block is authoritative for itself only,
// and a repeated ignore line is harmless to git. A file with a broken marker pair (begin
// without end, end without begin, end before begin, or either marker more than once) is a
// hard failure, never rewritten. The marker convention mirrors render.js, with "#" comment
// syntax because .gitignore has no HTML comments.

'use strict'

const fs = require('fs')
const path = require('path')

const BEGIN = '# major-tom:begin'
const END = '# major-tom:end'

const BLOCK = [
  BEGIN,
  '# Major Tom mechanism state, never knowledge (PRD D38, D40).',
  '.claude/worktrees/',
  '.claude/session/',
  '.claude/server/',
  END,
]

function fail(msg) {
  console.error(`gitignore-merge.js: ${msg}`)
  process.exit(1)
}

const [, , repoRootArg] = process.argv
const repoRoot = repoRootArg || '.'

if (!fs.existsSync(repoRoot)) {
  fail(`repo root ${repoRoot} does not exist; refusing to create it`)
}
if (!fs.statSync(repoRoot).isDirectory()) {
  fail(`repo root ${repoRoot} is not a directory`)
}

const targetPath = path.join(repoRoot, '.gitignore')
const existed = fs.existsSync(targetPath)

function indexesOf(lines, marker) {
  const found = []
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() === marker) found.push(i)
  }
  return found
}

let out
if (!existed) {
  out = BLOCK.join('\n') + '\n'
} else {
  let raw
  try {
    raw = fs.readFileSync(targetPath, 'utf8')
  } catch (e) {
    fail(`cannot read existing ${targetPath} (${e.message})`)
  }

  const lines = raw.split('\n')
  const begins = indexesOf(lines, BEGIN)
  const ends = indexesOf(lines, END)

  if (begins.length > 1) {
    fail(`existing ${targetPath} has ${begins.length} "${BEGIN}" markers, expected at most one; refusing to touch this file`)
  }
  if (ends.length > 1) {
    fail(`existing ${targetPath} has ${ends.length} "${END}" markers, expected at most one; refusing to touch this file`)
  }
  if (begins.length === 1 && ends.length === 0) {
    fail(`existing ${targetPath} has a "${BEGIN}" marker without a matching "${END}"; refusing to touch this file`)
  }
  if (ends.length === 1 && begins.length === 0) {
    fail(`existing ${targetPath} has a "${END}" marker without a matching "${BEGIN}"; refusing to touch this file`)
  }
  if (begins.length === 1 && ends.length === 1 && ends[0] < begins[0]) {
    fail(`existing ${targetPath} has its "${END}" marker before its "${BEGIN}" marker; refusing to touch this file`)
  }

  if (begins.length === 1) {
    const replaced = lines.slice(0, begins[0]).concat(BLOCK, lines.slice(ends[0] + 1))
    out = replaced.join('\n')
  } else if (raw.trim() === '') {
    out = BLOCK.join('\n') + '\n'
  } else {
    const base = raw.endsWith('\n') ? raw : raw + '\n'
    out = base + '\n' + BLOCK.join('\n') + '\n'
  }
}

fs.writeFileSync(targetPath, out)
console.log(`${existed ? 'updated' : 'created'} ${targetPath}`)
