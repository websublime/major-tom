#!/usr/bin/env node
// Major Tom dashboard launcher (D32, D44).
//
// THIS FILE IS COPIED BYTE FOR BYTE into a target project, at
// `.claude/server/launcher.js`, by the onboard workflow. It receives no
// `${CLAUDE_PLUGIN_ROOT}` substitution and no templating of any kind, so it has to be
// correct exactly as written here.
//
// Why it exists (D32 call 2, as amended by D44 call 2). The Claude Desktop `launch.json`
// surface is per-project and performs no plugin-path substitution, so the `program` field
// of the managed `major-tom-dashboard` entry has to name a file that lives inside the
// repository. Only this launcher lands there; the application itself stays in the
// installed plugin. A copy of the server would age silently, leaving a user who updated
// the plugin running the old dashboard until a re-onboard, with nothing to warn them.
// A launcher resolves the installed plugin on every run instead.
//
// Why it resolves by version rather than by a literal path (D44 call 3). The plugin
// install path carries the plugin version, so it changes on every update, which is routine
// rather than exceptional. This file therefore scans the plugin cache and picks the highest
// version present. The comparison is semver-aware and never a string comparison: this
// project's own history carries 0.9.0 and 0.17.0, which a string compare orders backwards.
//
// It never records a development install path. An onboard run from a `--plugin-dir`
// checkout writes exactly this file, unchanged, so the launcher fails with its explicit
// message until the plugin is installed properly, and then starts working with no
// re-onboard. That honest failure is the intended behaviour.
//
// `/major-tom:dashboard` never reads this file: that command substitutes
// `${CLAUDE_PLUGIN_ROOT}` on every run and starts `app/server.js` from the plugin directly.
//
// Usage: node launcher.js [port]
//
// The port, when Claude Desktop's `autoPort` supplies one, is passed straight through to
// the server. The repository to serve is not passed in: it is the repository this file
// sits in, worked out below.

'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const childProcess = require('child_process')

const PLUGIN_NAME = 'major-tom'
const SERVER_RELATIVE_PATH = path.join('app', 'server.js')
const CONFIG_RELATIVE_PATH = path.join('.claude', 'major-tom.json')
const FORWARDED_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP']

// ---------------------------------------------------------------------------
// Filesystem probes. Every one of them answers false rather than throwing: this
// walks directories that may not exist, and a missing directory is an ordinary
// outcome, not an error.
// ---------------------------------------------------------------------------

function isDirectory(target) {
  try {
    return fs.statSync(target).isDirectory()
  } catch (err) {
    return false
  }
}

function isFile(target) {
  try {
    return fs.statSync(target).isFile()
  } catch (err) {
    return false
  }
}

function entryNames(dir) {
  try {
    return fs.readdirSync(dir)
  } catch (err) {
    return []
  }
}

// ---------------------------------------------------------------------------
// Semver comparison. Numeric segment by numeric segment, never lexical.
// ---------------------------------------------------------------------------

const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

function parseVersion(value) {
  if (typeof value !== 'string') {
    return null
  }
  const match = VERSION_PATTERN.exec(value.trim())
  if (!match) {
    return null
  }
  return {
    numbers: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] === undefined ? [] : match[4].split('.'),
  }
}

function compareIdentifiers(left, right) {
  const leftIsNumeric = /^\d+$/.test(left)
  const rightIsNumeric = /^\d+$/.test(right)
  if (leftIsNumeric && rightIsNumeric) {
    const a = Number(left)
    const b = Number(right)
    if (a === b) return 0
    return a < b ? -1 : 1
  }
  if (leftIsNumeric) return -1
  if (rightIsNumeric) return 1
  if (left === right) return 0
  return left < right ? -1 : 1
}

// A version with a prerelease tag ranks below the same version without one.
function comparePrerelease(left, right) {
  if (left.length === 0 && right.length === 0) return 0
  if (left.length === 0) return 1
  if (right.length === 0) return -1
  const shared = Math.min(left.length, right.length)
  for (let index = 0; index < shared; index += 1) {
    const outcome = compareIdentifiers(left[index], right[index])
    if (outcome !== 0) return outcome
  }
  if (left.length === right.length) return 0
  return left.length < right.length ? -1 : 1
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left.numbers[index] !== right.numbers[index]) {
      return left.numbers[index] < right.numbers[index] ? -1 : 1
    }
  }
  return comparePrerelease(left.prerelease, right.prerelease)
}

// ---------------------------------------------------------------------------
// Plugin resolution.
//
// Installed plugins live at <config>/plugins/cache/<marketplace>/<plugin>/<version>/.
// The <marketplace> segment is the `name` field of that marketplace's manifest, which is
// not derivable from the plugin name, so no marketplace name is hard-coded here: every
// marketplace directory present is checked for a `major-tom` plugin directory and the
// highest version found across all of them wins. That is also what keeps this file correct
// if the marketplace is ever renamed or the plugin is ever published from more than one.
//
// CLAUDE_CONFIG_DIR is honoured when set, so a relocated Claude configuration directory is
// found; it is also what makes this resolution testable without touching a real ~/.claude.
// ---------------------------------------------------------------------------

function cacheDirectories() {
  const roots = []
  const configured = process.env.CLAUDE_CONFIG_DIR
  if (typeof configured === 'string' && configured.trim() !== '') {
    roots.push(path.resolve(configured.trim()))
  }
  let home = ''
  try {
    home = os.homedir()
  } catch (err) {
    home = ''
  }
  if (typeof home === 'string' && home !== '') {
    roots.push(path.join(home, '.claude'))
  }
  const seen = []
  for (let index = 0; index < roots.length; index += 1) {
    const candidate = path.join(roots[index], 'plugins', 'cache')
    if (seen.indexOf(candidate) === -1) seen.push(candidate)
  }
  return seen
}

// Returns { version, versionName, serverPath } for the highest installed version whose
// directory actually carries app/server.js, or null when there is none. A half-written
// cache entry is skipped rather than allowed to win.
function resolveInstalledServer(caches) {
  let best = null
  for (let cacheIndex = 0; cacheIndex < caches.length; cacheIndex += 1) {
    const cacheDir = caches[cacheIndex]
    const marketplaces = entryNames(cacheDir)
    for (let mIndex = 0; mIndex < marketplaces.length; mIndex += 1) {
      const pluginDir = path.join(cacheDir, marketplaces[mIndex], PLUGIN_NAME)
      if (!isDirectory(pluginDir)) continue
      const versionNames = entryNames(pluginDir)
      for (let vIndex = 0; vIndex < versionNames.length; vIndex += 1) {
        const versionName = versionNames[vIndex]
        const version = parseVersion(versionName)
        if (version === null) continue
        const serverPath = path.join(pluginDir, versionName, SERVER_RELATIVE_PATH)
        if (!isFile(serverPath)) continue
        if (best === null || compareVersions(version, best.version) > 0) {
          best = { version: version, versionName: versionName, serverPath: serverPath }
        }
      }
    }
  }
  return best
}

// ---------------------------------------------------------------------------
// Repository root.
//
// This file is written to <repo>/.claude/server/launcher.js, so the repository root is two
// directories above it. That is derived from where the file sits, which the onboard
// controls, in preference to the working directory, which the caller controls and which
// nothing about the Claude Desktop launch surface pins down. The working directory is still
// consulted as a fallback, and the choice between the two is settled by evidence rather
// than by preference: the candidate that actually carries .claude/major-tom.json wins, and
// the location-derived candidate wins when neither does.
// ---------------------------------------------------------------------------

function resolveRepoRoot() {
  const fromLocation = path.resolve(__dirname, '..', '..')
  const candidates = [fromLocation]
  let fromCwd = ''
  try {
    fromCwd = process.cwd()
  } catch (err) {
    fromCwd = ''
  }
  if (fromCwd !== '') {
    const resolvedCwd = path.resolve(fromCwd)
    if (resolvedCwd !== fromLocation) candidates.push(resolvedCwd)
  }
  for (let index = 0; index < candidates.length; index += 1) {
    if (isFile(path.join(candidates[index], CONFIG_RELATIVE_PATH))) return candidates[index]
  }
  return fromLocation
}

// ---------------------------------------------------------------------------
// Entry point.
// ---------------------------------------------------------------------------

const caches = cacheDirectories()
const resolved = resolveInstalledServer(caches)

if (resolved === null) {
  console.error(
    [
      'launcher.js: no installed major-tom plugin was found.',
      'Looked for <marketplace>/major-tom/<version>/app/server.js under:',
      caches.length === 0 ? '  (no Claude configuration directory could be determined)' : caches.map((dir) => `  ${dir}`).join('\n'),
      'Install or update the major-tom plugin, then start the dashboard again:',
      '  claude plugin install major-tom',
      '  claude plugin update major-tom',
      'This launcher resolves the installed plugin on every run, so once the plugin is',
      'installed the dashboard works with no re-onboard.',
    ].join('\n')
  )
  process.exit(1)
}

const repoRoot = resolveRepoRoot()
const serverArgs = [resolved.serverPath, repoRoot].concat(process.argv.slice(2))

console.log(`launcher.js: major-tom ${resolved.versionName} serving ${repoRoot}`)

const child = childProcess.spawn(process.execPath, serverArgs, { stdio: 'inherit' })

// Forwarded rather than left to the process group: whoever stops the launcher means to stop
// the server, and a server left running after its launcher is gone holds the port.
FORWARDED_SIGNALS.forEach((signal) => {
  process.on(signal, () => {
    try {
      child.kill(signal)
    } catch (err) {
      // The child is already gone; its exit handler settles the exit code.
    }
  })
})

child.on('error', (err) => {
  console.error(`launcher.js: could not start ${resolved.serverPath} (${err.message})`)
  process.exit(1)
})

child.on('exit', (code, signal) => {
  if (signal) {
    const number = os.constants.signals[signal]
    process.exit(typeof number === 'number' ? 128 + number : 1)
  }
  process.exit(typeof code === 'number' ? code : 1)
})
