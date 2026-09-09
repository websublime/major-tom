#!/usr/bin/env node
// Builds the single-file dashboard artifact from the authoring split (D34).
// Node, no dependencies. Reads plugins/major-tom/app/dashboard/ (index.html +
// dashboard.css + src/**/*.mjs), bundles the ES modules into one IIFE, inlines the CSS,
// embeds the vendored IBM Plex faces as data URIs, and emits
// plugins/major-tom/app/dashboard.html as a GENERATED file. The artifact invariant
// (one self-contained HTML, D32) is untouched; only authoring changes.
//
// Usage:
//   node scripts/build-dashboard.js          build plugins/major-tom/app/dashboard.html
//   node scripts/build-dashboard.js --check  exit 1 if the artifact is stale
//
// The bundler is deliberately a constrained subset and FAILS CLOSED outside it:
//   - imports are static, named, relative, and end in .mjs:  import { a } from './x.mjs'
//   - no default imports/exports, no namespace imports, no dynamic import()
//   - no import cycles
//   - top-level declarations must be unique across all modules (they share one scope)
// Anything richer is a design change: extend this script first, then the modules.

'use strict'

const fs = require('fs')
const path = require('path')

const repoRoot = path.resolve(__dirname, '..')
const srcDir = path.join(repoRoot, 'plugins', 'major-tom', 'app', 'dashboard')
const fontsDir = path.join(repoRoot, 'plugins', 'major-tom', 'app', 'vendor', 'fonts')
const outFile = path.join(repoRoot, 'plugins', 'major-tom', 'app', 'dashboard.html')

function fail(msg) {
  console.error(`build-dashboard: ${msg}`)
  process.exit(1)
}

const IMPORT_RE = /^import\s+\{[^}]*\}\s+from\s+['"]([^'"]+)['"];?\s*$/gm
const BAD_IMPORT_RE = /^import\s+(?!\{)/m
const DYNAMIC_IMPORT_RE = /\bimport\s*\(/
const DECL_RE = /^(?:export\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm

function loadModule(rel) {
  const full = path.join(srcDir, rel)
  if (!fs.existsSync(full)) fail(`module not found: ${rel}`)
  return fs.readFileSync(full, 'utf8')
}

function importsOf(source, fromRel) {
  const out = []
  for (const m of source.matchAll(IMPORT_RE)) {
    const spec = m[1]
    if (!spec.startsWith('./') && !spec.startsWith('../')) fail(`${fromRel}: non-relative import "${spec}"`)
    if (!spec.endsWith('.mjs')) fail(`${fromRel}: import must end in .mjs: "${spec}"`)
    out.push(path.normalize(path.join(path.dirname(fromRel), spec)))
  }
  const stripped = source.replace(IMPORT_RE, '')
  if (BAD_IMPORT_RE.test(stripped)) fail(`${fromRel}: only "import { names } from './x.mjs'" is supported`)
  if (DYNAMIC_IMPORT_RE.test(source)) fail(`${fromRel}: dynamic import() is not supported`)
  return out
}

// Topological order via DFS from the entry, cycle-checked.
const order = []
const state = {} // rel -> 'visiting' | 'done'
const sources = {}
function visit(rel, chain) {
  if (state[rel] === 'done') return
  if (state[rel] === 'visiting') fail(`import cycle: ${chain.concat(rel).join(' -> ')}`)
  state[rel] = 'visiting'
  const src = loadModule(rel)
  sources[rel] = src
  for (const dep of importsOf(src, rel)) visit(dep, chain.concat(rel))
  state[rel] = 'done'
  order.push(rel)
}

const indexHtml = fs.readFileSync(path.join(srcDir, 'index.html'), 'utf8')
const entryMatch = indexHtml.match(/<script type="module" src="([^"]+)"><\/script>/)
if (!entryMatch) fail('index.html has no <script type="module" src="..."> entry')
visit(path.normalize(entryMatch[1]), [])

// One shared scope: enforce unique top-level declarations across modules.
const seen = {}
for (const rel of order) {
  for (const m of sources[rel].matchAll(DECL_RE)) {
    const name = m[1]
    if (seen[name]) fail(`duplicate top-level declaration "${name}" in ${rel} (also in ${seen[name]})`)
    seen[name] = rel
  }
}

const bundled = order.map(function (rel) {
  const body = sources[rel]
    .replace(IMPORT_RE, '')
    .replace(/^export\s+/gm, '')
    .trim()
  return `/* == ${rel} == */\n${body}`
}).join('\n\n')

// The vendored IBM Plex faces, embedded so the page fetches no font and works offline.
// Only the latin subset is vendored, and the range below is the one the subset actually
// covers, so anything outside it falls to the fallback stack instead of a tofu.
const LATIN_RANGE = 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD'

// Mono ships one static file per weight. Sans is a single variable file whose wght axis
// runs 100 to 700, so one rule declares the whole range rather than repeating 40KB of
// base64 once per weight. vendor/README.md records the provenance and the hashes.
const FACES = [
  { family: 'IBM Plex Mono', weight: '400', file: 'ibm-plex-mono-latin-400.woff2' },
  { family: 'IBM Plex Mono', weight: '500', file: 'ibm-plex-mono-latin-500.woff2' },
  { family: 'IBM Plex Mono', weight: '600', file: 'ibm-plex-mono-latin-600.woff2' },
  { family: 'IBM Plex Sans', weight: '100 700', stretch: '100%', file: 'ibm-plex-sans-latin-variable.woff2' },
]

function fontFaceCss() {
  return FACES.map(function (face) {
    const full = path.join(fontsDir, face.file)
    if (!fs.existsSync(full)) fail(`vendored font not found: ${face.file}`)
    const data = fs.readFileSync(full).toString('base64')
    const lines = [
      '@font-face {',
      `  font-family: '${face.family}';`,
      '  font-style: normal;',
      `  font-weight: ${face.weight};`,
    ]
    if (face.stretch) lines.push(`  font-stretch: ${face.stretch};`)
    lines.push('  font-display: swap;')
    lines.push(`  src: url(data:font/woff2;base64,${data}) format('woff2');`)
    lines.push(`  unicode-range: ${LATIN_RANGE};`)
    lines.push('}')
    return lines.join('\n')
  }).join('\n\n')
}

const css = fs.readFileSync(path.join(srcDir, 'dashboard.css'), 'utf8').trim()

let html = indexHtml
if (!html.includes('<link rel="stylesheet" href="dashboard.css">')) fail('index.html is missing the dashboard.css link')
html = html.replace('<link rel="stylesheet" href="dashboard.css">', '<style>\n' + fontFaceCss() + '\n\n' + css + '\n</style>')
html = html.replace(entryMatch[0], '<script>\n(function () {\n\'use strict\'\n\n' + bundled + '\n})()\n</script>')
html = html.replace('<!doctype html>', '<!doctype html>\n<!-- GENERATED by scripts/build-dashboard.js from plugins/major-tom/app/dashboard/. Do not edit; edit the authoring split and rebuild. -->')

if (process.argv.includes('--check')) {
  const current = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : ''
  if (current !== html) {
    console.error('plugins/major-tom/app/dashboard.html is stale. Run: node scripts/build-dashboard.js')
    process.exit(1)
  }
  console.log('dashboard artifact in sync')
} else {
  fs.writeFileSync(outFile, html)
  console.log(`built plugins/major-tom/app/dashboard.html (${order.length} modules, ${html.length} bytes)`)
}
