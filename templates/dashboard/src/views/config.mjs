// Config: sectioned key/value tables or the raw JSON, straight from the island.

import { CFG } from '../data.mjs'
import { S } from '../state.mjs'
import { esc } from '../ui.mjs'

function fmtV(v) {
  if (Array.isArray(v)) return v.length === 0 ? '[ ]' : v.map(function (x) { return typeof x === 'object' && x !== null ? Object.values(x).join(' / ') : String(x) }).join(', ')
  if (typeof v === 'object' && v !== null) return Object.keys(v).map(function (k) { return k + ': ' + fmtV(v[k]) }).join(' · ')
  return v === '' ? '(empty)' : String(v)
}

export function vConfig() {
  const bar = '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:0 4px">'
    + '<div class="seg">'
    + '<button data-act="cfgmode" data-v="table" class="' + (S.configMode === 'table' ? 'active' : '') + '">table</button>'
    + '<button data-act="cfgmode" data-v="raw" class="' + (S.configMode === 'raw' ? 'active' : '') + '">raw json</button></div>'
    + '<span style="color:var(--dim);font-size:11.5px">.claude/major-tom.json &#183; schemaVersion ' + esc(CFG.schemaVersion != null ? CFG.schemaVersion : '?') + '</span>'
    + '<span class="chip" style="margin-left:auto;display:flex;align-items:center;gap:8px;padding:5px 12px;background:var(--ok-soft);color:var(--ok);font-size:11.5px"><span class="dot"></span>validated at onboard</span></div>'
  if (S.configMode === 'raw') {
    return bar + '<section class="panel"><div class="panel-head"><span class="eyebrow">raw</span></div>'
      + '<pre class="body" style="white-space:pre;overflow:auto">' + esc(JSON.stringify(CFG, null, 2)) + '</pre></section>'
  }
  const sections = Object.keys(CFG).map(function (key) {
    const v = CFG[key]
    let rows
    if (Array.isArray(v)) rows = v.length ? v.map(function (x, i) { return { k: '[' + i + ']', v: fmtV(x) } }) : [{ k: '[ ]', v: '(empty)' }]
    else if (typeof v === 'object' && v !== null) rows = Object.keys(v).map(function (k) { return { k: k, v: fmtV(v[k]) } })
    else rows = [{ k: key, v: fmtV(v) }]
    return '<section class="panel"><div class="panel-head">'
      + '<span class="sans" style="font-size:14px;font-weight:600">' + esc(key) + '</span></div>'
      + '<div style="display:flex;flex-direction:column;gap:2px">'
      + rows.map(function (r) {
        return '<div class="tile" style="display:flex;gap:12px;padding:8px 12px;border-radius:12px">'
          + '<span style="flex:0 0 160px;color:var(--dim);font-size:11.5px;word-break:break-word">' + esc(r.k) + '</span>'
          + '<span style="flex:1 1 auto;min-width:0;color:' + (r.v === '(empty)' ? 'var(--dimmer)' : 'var(--text)') + ';word-break:break-word">' + esc(r.v) + '</span></div>'
      }).join('') + '</div></section>'
  }).join('')
  return bar + '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));gap:14px;align-items:start">' + sections + '</div>'
}
