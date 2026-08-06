// Knowledge: bundle tree navigation plus the file viewer with frontmatter chips.

import { AREAS, FILES, ROOT, rel } from '../data.mjs'
import { S } from '../state.mjs'
import { esc } from '../ui.mjs'

function treeBtn(f, i, indent) {
  const on = S.file === i
  return '<button class="navbtn" data-act="file" data-v="' + i + '" style="border-radius:12px;padding:8px 10px;'
    + (indent ? 'padding-left:28px;' : '') + (on ? 'background:var(--accent-soft);color:var(--accent)' : '') + '">'
    + '<span style="color:var(--dimmer)">' + (indent ? '·' : '≡') + '</span>'
    + '<span class="ellip" style="flex:1 1 auto;min-width:0">' + esc((f.path || '').split('/').pop()) + '</span>'
    + '<span style="color:var(--dimmer);font-size:10.5px">' + esc((f.frontmatter && f.frontmatter.type) || f.type || '') + '</span></button>'
}

export function vKnowledge() {
  if (!FILES.length) return '<section class="panel"><div class="empty">The knowledge bundle is empty.</div></section>'
  const af = FILES[S.file] || FILES[0]
  let tree = ''
  FILES.forEach(function (f, i) {
    if ((f.path || '').split('/').pop() !== 'index.md') return
    tree += treeBtn(f, i)
  })
  AREAS.forEach(function (dir) {
    const inDir = FILES.map(function (f, i) { return [f, i] }).filter(function (p) {
      return (p[0].path || '').indexOf(dir + '/') !== -1 && (p[0].path || '').split('/').pop() !== 'index.md'
    })
    if (!inDir.length) return
    tree += '<div style="display:flex;align-items:center;gap:9px;padding:8px 10px;color:var(--dim);font-size:12.5px">'
      + '<span style="color:var(--dimmer)">&#9656;</span><span>' + dir + '/</span>'
      + '<span style="margin-left:auto;color:var(--dimmer);font-size:10.5px">' + inDir.length + '</span></div>'
    inDir.forEach(function (p) { tree += treeBtn(p[0], p[1], true) })
  })
  const fm = af.frontmatter || {}
  const fmRows = Object.keys(fm).map(function (k) {
    const v = fm[k]
    return '<div class="tile" style="display:flex;gap:10px;padding:8px 12px;border-radius:12px">'
      + '<span style="flex:0 0 auto;color:var(--dim);font-size:11.5px">' + esc(k) + '</span>'
      + '<span style="flex:1 1 auto;min-width:0;font-size:12px;word-break:break-word;text-align:right">' + esc(typeof v === 'object' ? JSON.stringify(v) : v) + '</span></div>'
  }).join('')
  return '<div style="display:grid;grid-template-columns:minmax(240px,300px) minmax(0,1fr);gap:14px;align-items:start">'
    + '<section class="panel" style="padding:14px"><div class="panel-head" style="padding:2px 8px 12px 8px">'
    + '<span class="eyebrow">' + esc(ROOT) + '</span>'
    + '<span class="chip" style="margin-left:auto">okf 0.2</span></div>'
    + '<div style="display:flex;flex-direction:column;gap:2px">' + tree + '</div></section>'
    + '<section class="panel" style="min-width:0"><div class="panel-head">'
    + '<span class="sans ellip" style="font-size:14.5px;font-weight:600;min-width:0">' + esc(af.path || '') + '</span>'
    + (fm.type || af.type ? '<span class="chip" style="background:var(--accent-soft);border:1px solid var(--accent-line);color:var(--accent)">' + esc(fm.type || af.type) + '</span>' : '')
    + '<span style="margin-left:auto;color:var(--dimmer);font-size:11px;white-space:nowrap">' + esc(af.size || '') + (af.updated ? ' &#183; ' + rel(af.updated) : '') + '</span></div>'
    + (fmRows ? '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:6px;padding-bottom:14px">' + fmRows + '</div>' : '')
    + (af.body != null
      ? '<pre class="body">' + esc(af.body) + (af.truncated ? '\n\n[truncated at the snapshot window cap]' : '') + '</pre>'
      : '<div class="empty">Body not embedded in the snapshot (over the window cap or metadata-only).</div>')
    + '</section></div>'
}
