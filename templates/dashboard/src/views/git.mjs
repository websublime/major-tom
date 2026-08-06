// Git: full commit window with text filter and conventional-kind segments.

import { COMMITS } from '../data.mjs'
import { S } from '../state.mjs'
import { esc } from '../ui.mjs'

export function vGit() {
  const q = S.query.trim().toLowerCase()
  const visible = COMMITS.filter(function (c) {
    return (S.filter === 'all' || c.kind === S.filter)
      && (!q || (c.subject + ' ' + c.sha + ' ' + c.author).toLowerCase().indexOf(q) !== -1)
  })
  const kinds = ['all', 'feat', 'fix', 'docs', 'test', 'chore', 'refactor']
  const bar = '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:0 4px">'
    + '<div class="pill" style="flex:0 0 300px;gap:9px"><span style="color:var(--dimmer)">&#9906;</span>'
    + '<input id="git-q" type="text" placeholder="filter subject, sha, author" value="' + esc(S.query) + '" '
    + 'style="flex:1 1 auto;min-width:0;border:0;outline:none;background:transparent;color:var(--text);font-family:inherit;font-size:12.5px"></div>'
    + '<div class="seg">' + kinds.map(function (k) {
      return '<button data-act="filter" data-v="' + k + '" class="' + (S.filter === k ? 'active' : '') + '">' + k + '</button>'
    }).join('') + '</div>'
    + '<span style="margin-left:auto;color:var(--dim);font-size:11.5px">' + visible.length + ' of ' + COMMITS.length + ' commits</span></div>'
  if (!COMMITS.length) return bar + '<section class="panel"><div class="empty">No commits in the snapshot.</div></section>'
  const hasStat = COMMITS.some(function (c) { return c.add != null })
  return bar + '<section class="panel" style="padding:14px 14px 8px 14px">'
    + '<div style="display:flex;gap:12px;padding:0 12px 10px 12px;color:var(--dim);font-size:10.5px;letter-spacing:.12em;text-transform:uppercase">'
    + '<span style="flex:0 0 78px">sha</span><span style="flex:0 0 58px">kind</span><span style="flex:1 1 auto">subject</span>'
    + '<span style="flex:0 0 130px">author</span>' + (hasStat ? '<span style="flex:0 0 84px">files</span>' : '')
    + '<span style="flex:0 0 84px">when</span></div>'
    + '<div style="display:flex;flex-direction:column;gap:2px">'
    + visible.map(function (c) {
      return '<div class="row" style="gap:12px;padding:9px 12px">'
        + '<span style="flex:0 0 78px"><span class="chip sha">' + esc(c.sha) + '</span></span>'
        + '<span style="flex:0 0 58px;color:' + c.kindColor + ';font-size:11px">' + esc(c.kind) + '</span>'
        + '<span class="ellip" style="flex:1 1 auto;min-width:0">' + esc(c.subject) + '</span>'
        + '<span class="ellip" style="flex:0 0 130px;color:var(--dim);font-size:11.5px">' + esc(c.author) + '</span>'
        + (hasStat ? '<span style="flex:0 0 84px;font-size:11px"><span style="color:var(--ok)">+' + (c.add || 0) + '</span> <span style="color:var(--stop)">&#8722;' + (c.del || 0) + '</span></span>' : '')
        + '<span style="flex:0 0 84px;color:var(--dimmer);font-size:11px">' + esc(c.when) + '</span></div>'
    }).join('') + '</div></section>'
}
