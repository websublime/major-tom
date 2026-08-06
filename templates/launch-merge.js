#!/usr/bin/env node
// Merges the managed Major Tom dashboard entry into .claude/launch.json (D32).
// Node, no dependencies. launch.json is a Claude Desktop surface: it cannot reference the
// plugin install path (no substitution there), so the entry points at the repo-local
// server copy the onboard writes to .claude/server/.
//
// Usage: node launch-merge.js <launch.json> <dashboard-html-path> [server-path]
//
// Policy: the entry named "major-tom-dashboard" is managed and rewritten whole on every
// run; every other configuration, autoVerify, and any unknown field are preserved
// untouched. An existing file that does not parse is a hard failure, never overwritten.

'use strict'

const fs = require('fs')

function fail(msg) {
  console.error(`launch-merge.js: ${msg}`)
  process.exit(1)
}

const [, , launchPath, dashboardPath, serverPathArg] = process.argv
if (!launchPath || !dashboardPath) {
  fail('usage: node launch-merge.js <launch.json> <dashboard-html-path> [server-path]')
}
const serverPath = serverPathArg || '.claude/server/dashboard-server.js'

let doc = { version: '0.0.1', configurations: [] }
if (fs.existsSync(launchPath)) {
  try {
    doc = JSON.parse(fs.readFileSync(launchPath, 'utf8'))
  } catch (e) {
    fail(`existing ${launchPath} does not parse (${e.message}); refusing to overwrite it`)
  }
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    fail(`existing ${launchPath} is not a JSON object; refusing to overwrite it`)
  }
}
if (doc.configurations === undefined) doc.configurations = []
if (!Array.isArray(doc.configurations)) fail('configurations is not an array; refusing to touch this file')
if (!doc.version) doc.version = '0.0.1'

const entry = {
  name: 'major-tom-dashboard',
  program: serverPath,
  args: [dashboardPath],
  port: 4242,
  autoPort: true,
}

const idx = doc.configurations.findIndex((c) => c && c.name === 'major-tom-dashboard')
if (idx === -1) doc.configurations.push(entry)
else doc.configurations[idx] = entry

fs.writeFileSync(launchPath, JSON.stringify(doc, null, 2) + '\n')
console.log(`${idx === -1 ? 'added' : 'updated'} major-tom-dashboard in ${launchPath}`)
