#!/usr/bin/env node
// Canonical renderer for Major Tom templates (D29). Node, no dependencies.
// Implements exactly the grammar in templates/README.md; anything beyond it is a design
// change: extend the README first, then this file, then the templates.
//
// Usage:
//   node render.js render <template> <config.json>           rendered text to stdout
//   node render.js apply <template> <config.json> <target>   render, then managed-block write
//   node render.js inject <html> <data.json> <target>        replace the JSON data island
//
// apply semantics: the rendered output must carry the managed markers. If the target file
// has markers, only the block between them is replaced; without markers the block is
// appended; a missing target is created. Content outside the markers is never touched.
//
// inject semantics (the dashboard path, D31): the source html must contain the data island
// <script type="application/json" id="major-tom-data">...</script>. Its content is replaced
// with the JSON from data.json (validated to parse); everything else is copied verbatim to
// the target. The dashboard is never rendered through the mustache grammar.

'use strict'

const fs = require('fs')

const BEGIN = '<!-- major-tom:begin -->'
const END = '<!-- major-tom:end -->'

function fail(msg) {
  console.error(`render.js: ${msg}`)
  process.exit(1)
}

function resolvePath(path, root, scopes) {
  let base = root
  let rest = path
  if (path === 'this') return scopes.length ? scopes[scopes.length - 1] : undefined
  if (path.startsWith('this.')) {
    if (!scopes.length) return undefined
    base = scopes[scopes.length - 1]
    rest = path.slice(5)
  }
  for (const part of rest.split('.')) {
    if (base === null || base === undefined) return undefined
    base = base[part]
  }
  return base
}

function truthy(v) {
  if (v === undefined || v === null || v === false || v === '') return false
  if (Array.isArray(v) && v.length === 0) return false
  return true
}

function renderRange(tokens, start, end, root, scopes) {
  let out = ''
  let i = start
  while (i < end) {
    const t = tokens[i]
    const open = /^\{\{\s*(#if|#each)\s+([^}\s]+)\s*\}\}$/.exec(t)
    if (open) {
      const kind = open[1]
      let depth = 1
      let j = i + 1
      for (; j < end; j++) {
        if (new RegExp(`^\\{\\{\\s*${kind}\\s`).test(tokens[j])) depth++
        else if (new RegExp(`^\\{\\{\\s*/${kind.slice(1)}\\s*\\}\\}$`).test(tokens[j])) {
          depth--
          if (depth === 0) break
        }
      }
      if (depth !== 0) fail(`unclosed {{${kind} ${open[2]}}}`)
      const val = resolvePath(open[2], root, scopes)
      if (kind === '#if') {
        if (truthy(val)) out += renderRange(tokens, i + 1, j, root, scopes)
      } else if (Array.isArray(val)) {
        for (const item of val) out += renderRange(tokens, i + 1, j, root, scopes.concat([item]))
      }
      i = j + 1
      continue
    }
    if (/^\{\{\s*\/(if|each)\s*\}\}$/.test(t)) fail(`unbalanced ${t}`)
    const sub = /^\{\{\s*([^#/][^}]*?)\s*\}\}$/.exec(t)
    if (sub) {
      const val = resolvePath(sub[1], root, scopes)
      out += val === undefined || val === null ? '' : String(val)
      i++
      continue
    }
    out += t
    i++
  }
  return out
}

function render(templateSrc, config) {
  // Standalone block tags (a line holding only the tag) are consumed with their line
  // break, so control flow leaves no blank lines behind.
  const src = templateSrc.replace(
    /^[ \t]*(\{\{\s*(?:#if|#each)\s+[^}]+\}\}|\{\{\s*\/(?:if|each)\s*\}\})[ \t]*\r?\n/gm,
    '$1'
  )
  const tokens = src.split(/(\{\{[^}]+\}\})/)
  let out = renderRange(tokens, 0, tokens.length, config, [])
  out = out
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
  out = out.replace(/\n{3,}/g, '\n\n')
  if (!out.endsWith('\n')) out += '\n'
  return out
}

function applyManaged(target, rendered) {
  const rb = rendered.indexOf(BEGIN)
  const re = rendered.indexOf(END)
  if (rb === -1 || re === -1 || re < rb) fail('rendered output must carry the managed markers')
  const block = rendered.slice(rb, re + END.length)
  if (!fs.existsSync(target)) {
    fs.writeFileSync(target, rendered)
    return 'created'
  }
  const current = fs.readFileSync(target, 'utf8')
  const b = current.indexOf(BEGIN)
  const e = current.indexOf(END)
  if (b !== -1 && e !== -1 && e > b) {
    fs.writeFileSync(target, current.slice(0, b) + block + current.slice(e + END.length))
    return 'replaced'
  }
  const sep = current.endsWith('\n') ? '\n' : '\n\n'
  fs.writeFileSync(target, current + sep + block + '\n')
  return 'appended'
}

const [, , cmd, tplPath, cfgPath, targetPath] = process.argv
if (cmd !== 'render' && cmd !== 'apply' && cmd !== 'inject')
  fail('usage: render.js render|apply|inject <template|html> <config.json|data.json> [target]')
if (!tplPath || !cfgPath) fail('template and config paths are required')
if ((cmd === 'apply' || cmd === 'inject') && !targetPath) fail(`${cmd} requires a target path`)

if (cmd === 'inject') {
  let dataRaw
  try {
    dataRaw = fs.readFileSync(cfgPath, 'utf8')
    JSON.parse(dataRaw)
  } catch (e) {
    fail(`data ${cfgPath}: ${e.message}`)
  }
  // A "</script" inside a JSON string would terminate the island in the browser; the
  // \/ escape is legal JSON and neutralizes it without changing the parsed value.
  const safe = dataRaw.trim().replace(/<\/script/gi, '<\\/script')
  const html = fs.readFileSync(tplPath, 'utf8')
  const island = /(<script[^>]*id="major-tom-data"[^>]*>)[\s\S]*?(<\/script>)/
  if (!island.test(html)) fail(`no data island (script id="major-tom-data") in ${tplPath}`)
  const next = html.replace(island, (_, openTag, closeTag) => `${openTag}\n${safe}\n${closeTag}`)
  fs.writeFileSync(targetPath, next)
  console.log(`injected ${targetPath}`)
  process.exit(0)
}

let config
try {
  config = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
} catch (e) {
  fail(`config ${cfgPath}: ${e.message}`)
}
const rendered = render(fs.readFileSync(tplPath, 'utf8'), config)
if (/\{\{[^}]+\}\}/.test(rendered)) fail('rendered output still contains template syntax')

if (cmd === 'render') {
  process.stdout.write(rendered)
} else {
  const action = applyManaged(targetPath, rendered)
  console.log(`${action} ${targetPath}`)
}
