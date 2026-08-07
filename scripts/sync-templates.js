#!/usr/bin/env node
// Syncs the authoring source templates/ (repo root, D19) into each plugin directory (D23).
// The installed plugin cache only contains the plugin directory, so runtime copies must
// live under each plugin root. This script keeps them byte for byte identical.
//
// Everything under templates/ is synced. The dashboard application is not: it is authored
// inside its own plugin at plugins/major-tom/app/ (D44 point 1), outside this scope.
//
// Usage:
//   node scripts/sync-templates.js          copy source into every target
//   node scripts/sync-templates.js --check  exit 1 if any target drifts from source

const fs = require('fs')
const path = require('path')

const repoRoot = path.resolve(__dirname, '..')
const source = path.join(repoRoot, 'templates')
const targets = [
  path.join(repoRoot, 'plugins', 'major-tom', 'templates'),
  path.join(repoRoot, 'plugins', 'major-tom-copilot', 'templates'),
]

function listFiles(dir, base) {
  if (!fs.existsSync(dir)) return []
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    const rel = path.relative(base, full)
    if (entry.isDirectory()) out.push(...listFiles(full, base))
    else out.push(rel)
  }
  return out.sort()
}

function check() {
  const sourceFiles = listFiles(source, source)
  let drift = 0
  for (const target of targets) {
    const targetFiles = listFiles(target, target)
    for (const rel of sourceFiles) {
      const t = path.join(target, rel)
      if (!fs.existsSync(t)) {
        console.error(`missing: ${path.relative(repoRoot, t)}`)
        drift++
      } else if (!fs.readFileSync(path.join(source, rel)).equals(fs.readFileSync(t))) {
        console.error(`differs: ${path.relative(repoRoot, t)}`)
        drift++
      }
    }
    for (const rel of targetFiles) {
      if (!sourceFiles.includes(rel)) {
        console.error(`orphan: ${path.relative(repoRoot, path.join(target, rel))}`)
        drift++
      }
    }
  }
  if (drift > 0) {
    console.error(`${drift} drift(s). Run: node scripts/sync-templates.js`)
    process.exit(1)
  }
  console.log('templates in sync')
}

function sync() {
  for (const target of targets) {
    fs.rmSync(target, { recursive: true, force: true })
    fs.cpSync(source, target, { recursive: true })
    console.log(`synced ${path.relative(repoRoot, source)} -> ${path.relative(repoRoot, target)}`)
  }
}

if (process.argv.includes('--check')) check()
else sync()
