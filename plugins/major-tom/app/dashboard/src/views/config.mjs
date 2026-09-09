// Config: the served configuration as one sectioned key/value table, or as the raw JSON.

import { cfg } from '../data.mjs'
import { S } from '../state.mjs'
import { esc } from '../ui.mjs'

function fmtV(v) {
  if (Array.isArray(v)) return v.length === 0 ? '[ ]' : v.map(function (x) { return typeof x === 'object' && x !== null ? Object.values(x).join(' / ') : String(x) }).join(', ')
  if (typeof v === 'object' && v !== null) return Object.keys(v).map(function (k) { return k + ': ' + fmtV(v[k]) }).join(' · ')
  return v === '' ? '(empty)' : String(v)
}

function cfgLeafRow(k, v) {
  return '<div class="row wrap">'
    + '<span class="w-key fg-dim small">' + esc(k) + '</span>'
    + '<span class="c-wrap' + (v === '(empty)' ? ' fg-dimmer' : '') + '">' + esc(v) + '</span>'
    + '</div>'
}

// One top-level config key renders as one section. An object or an array opens a header row and
// lists its members under it; a scalar states its value on the header row itself, so no key is
// written twice.
function cfgSection(key, v) {
  const head = '<div class="row group"><span class="w-key eyebrow">' + esc(key) + '</span>'
  if (Array.isArray(v)) {
    return head + '</div>' + (v.length
      ? v.map(function (x, i) { return cfgLeafRow('[' + i + ']', fmtV(x)) }).join('')
      : cfgLeafRow('[ ]', '(empty)'))
  }
  if (typeof v === 'object' && v !== null) {
    return head + '</div>' + Object.keys(v).map(function (k) { return cfgLeafRow(k, fmtV(v[k])) }).join('')
  }
  return head + '<span class="c-wrap">' + esc(fmtV(v)) + '</span></div>'
}

export function vConfig() {
  const config = cfg()
  // Every return below wraps the tools row and its table in one tight stack, for the reason
  // views/git.mjs gives.
  const tools = '<div class="stack tight"><div class="tools">'
    + '<div class="seg">'
    + '<button data-act="cfgmode" data-v="table"' + (S.configMode === 'table' ? ' class="active"' : '') + '>table</button>'
    + '<button data-act="cfgmode" data-v="raw"' + (S.configMode === 'raw' ? ' class="active"' : '') + '>raw json</button>'
    + '</div>'
    + '<span class="fg-dim small">.claude/major-tom.json &#183; schemaVersion '
    + esc(config.schemaVersion != null ? config.schemaVersion : '?') + '</span>'
    + '<span class="push sq done"></span><span class="fg-dim small">validated at onboard</span>'
    + '</div>'

  if (S.configMode === 'raw') {
    return tools + '<section class="panel">'
      + '<div class="panel-head short"><span class="eyebrow">raw</span></div>'
      + '<pre class="body raw">' + esc(JSON.stringify(config, null, 2)) + '</pre>'
      + '</section></div>'
  }

  const keys = Object.keys(config)
  if (!keys.length) {
    return tools + '<section class="panel"><div class="empty">No configuration in the snapshot.</div></section></div>'
  }
  return tools + '<section class="panel">'
    + '<div class="thead"><span class="w-key">key</span><span class="c-grow">value</span></div>'
    + keys.map(function (key) { return cfgSection(key, config[key]) }).join('')
    + '</section></div>'
}
