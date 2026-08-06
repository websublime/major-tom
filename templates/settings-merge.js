#!/usr/bin/env node
// Merges the managed Major Tom session defaults into the target project's Claude Code
// settings file (D37). Node, no dependencies. Three keys, fixed values: the subprocess
// env scrub and the experimental agent teams flag (both string "1", the form Claude Code
// reads env values in), plus extended thinking on by default.
//
// Usage: node settings-merge.js [claude-dir]        claude-dir defaults to .claude
//
// Policy: file choice follows what the project already has. settings.local.json when it
// exists (the more specific file, matching Claude Code's local-over-shared precedence),
// otherwise settings.json when it exists, otherwise settings.json is created fresh
// (project-wide defaults are shared, not personal). Only the three managed keys are
// written: every other top-level key and every other env entry is preserved untouched.
// An existing file that does not parse, that is not a JSON object, or whose env is not a
// JSON object, is a hard failure, never overwritten.

'use strict'

const fs = require('fs')
const path = require('path')

function fail(msg) {
  console.error(`settings-merge.js: ${msg}`)
  process.exit(1)
}

const [, , claudeDirArg] = process.argv
const claudeDir = claudeDirArg || '.claude'

const localPath = path.join(claudeDir, 'settings.local.json')
const sharedPath = path.join(claudeDir, 'settings.json')

let targetPath
if (fs.existsSync(localPath)) targetPath = localPath
else targetPath = sharedPath

const existed = fs.existsSync(targetPath)

let doc = {}
if (existed) {
  let raw
  try {
    raw = fs.readFileSync(targetPath, 'utf8')
  } catch (e) {
    fail(`cannot read existing ${targetPath} (${e.message})`)
  }
  try {
    doc = JSON.parse(raw)
  } catch (e) {
    fail(`existing ${targetPath} does not parse (${e.message}); refusing to overwrite it`)
  }
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    fail(`existing ${targetPath} is not a JSON object; refusing to overwrite it`)
  }
  if (doc.env !== undefined && (doc.env === null || typeof doc.env !== 'object' || Array.isArray(doc.env))) {
    fail(`existing ${targetPath} has an env that is not a JSON object; refusing to touch this file`)
  }
}

if (doc.env === undefined) doc.env = {}
doc.env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB = '1'
doc.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = '1'
doc.alwaysThinkingEnabled = true

if (!existed) fs.mkdirSync(path.dirname(targetPath), { recursive: true })
fs.writeFileSync(targetPath, JSON.stringify(doc, null, 2) + '\n')
console.log(`${existed ? 'updated' : 'created'} ${targetPath}`)
