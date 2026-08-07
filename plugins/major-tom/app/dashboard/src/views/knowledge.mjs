// Knowledge: bundle tree navigation plus the file viewer with frontmatter chips.
//
// Bodies no longer travel in the listing (D43 point 4): each entry carries an opaque id and its
// body is fetched from the server one file at a time. This view stays a pure string builder and
// never fetches; main.mjs issues the request for whatever file is selected and parks the result
// in S, so the four states below are just a read of that state.

import { files, groups, rel, root } from '../data.mjs'
import { S } from '../state.mjs'
import { esc } from '../ui.mjs'

function treeBtn(f, i) {
  const on = S.file === i
  return '<button class="navbtn" data-act="file" data-v="' + i + '" style="border-radius:12px;padding:8px 10px;padding-left:28px;'
    + (on ? 'background:var(--accent-soft);color:var(--accent)' : '') + '">'
    + '<span style="color:var(--dimmer)">·</span>'
    + '<span class="ellip" style="flex:1 1 auto;min-width:0">' + esc((f.path || '').split('/').pop()) + '</span>'
    + '<span style="color:var(--dimmer);font-size:10.5px">' + esc((f.frontmatter && f.frontmatter.type) || f.type || '') + '</span></button>'
}

// The body pane, in the four states a fetched body can be in. The empty state this replaces
// said the body was "not embedded in the snapshot (over the window cap or metadata-only)",
// which described a 32 KB per-file cap that D43 point 4 removed; there is no cap left to blame
// and no reason left for a body to be missing other than a request that has not landed, has
// failed, or an entry that carries no id to ask with.
function bodyPane(af) {
  if (S.bodyStatus === 'noid') {
    return '<div class="empty">This entry carries no id, so its body cannot be fetched. '
      + 'Ids are minted by the server; an entry without one came from a producer older than the body endpoint.</div>'
  }
  if (S.bodyStatus === 'loading') {
    return '<div class="empty">Loading the body of ' + esc(af.path || 'this file') + '.</div>'
  }
  if (S.bodyStatus === 'failed') {
    return '<section class="panel" style="background:var(--tile);box-shadow:none">'
      + '<div class="panel-head"><span class="eyebrow">body unavailable</span>'
      + '<button class="btn" data-act="bodyretry" style="margin-left:auto">retry</button></div>'
      + '<div style="color:var(--dim);font-size:12px;line-height:1.7;word-break:break-word">'
      + esc(S.bodyError || 'the request failed and the server said nothing about why') + '</div></section>'
  }
  if (S.bodyStatus === 'ready') {
    if (S.bodyText === '') return '<div class="empty">This file has no body: frontmatter only.</div>'
    return '<pre class="body">' + esc(S.bodyText) + '</pre>'
  }
  return '<div class="empty">No body requested for this file yet.</div>'
}

export function vKnowledge() {
  const list = files()
  if (!list.length) return '<section class="panel"><div class="empty">The knowledge bundle is empty.</div></section>'
  const af = list[S.file] || list[0]
  // One button per entry of knowledge.files[], and never more or fewer: the groups are the
  // partition data.mjs derives, so the tree and the rail's count state the same number by
  // construction. Group headings and their order are explained at deriveGroups; a heading is
  // escaped because a directory name is data from the served bundle, not a literal from here.
  //
  // Gone with the fixed area list: the branch that rendered an entry whose basename is index.md
  // unindented at the top of the tree. index.md is the bundle index, not a concept, and the
  // server's concept walk skips it at every depth, so no listing the server produces can contain
  // one; the page is served by that server and always reflects it, so no older artifact can
  // reach this code either. Keeping the branch would also break the invariant above, since an
  // entry it matched would get that button plus its group's button.
  let tree = ''
  groups().forEach(function (g) {
    tree += '<div style="display:flex;align-items:center;gap:9px;padding:8px 10px;color:var(--dim);font-size:12.5px">'
      + '<span style="color:var(--dimmer)">&#9656;</span><span>' + esc(g.label) + (g.dir === null ? '' : '/') + '</span>'
      + '<span style="margin-left:auto;color:var(--dimmer);font-size:10.5px">' + g.entries.length + '</span></div>'
    g.entries.forEach(function (e) { tree += treeBtn(e.file, e.index) })
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
    + '<span class="eyebrow">' + esc(root()) + '</span>'
    + '<span class="chip" style="margin-left:auto">okf 0.2</span></div>'
    + '<div style="display:flex;flex-direction:column;gap:2px">' + tree + '</div></section>'
    + '<section class="panel" style="min-width:0"><div class="panel-head">'
    + '<span class="sans ellip" style="font-size:14.5px;font-weight:600;min-width:0">' + esc(af.path || '') + '</span>'
    + (fm.type || af.type ? '<span class="chip" style="background:var(--accent-soft);border:1px solid var(--accent-line);color:var(--accent)">' + esc(fm.type || af.type) + '</span>' : '')
    + '<span style="margin-left:auto;color:var(--dimmer);font-size:11px;white-space:nowrap">' + esc(af.size || '') + (af.updated ? ' &#183; ' + rel(af.updated) : '') + '</span></div>'
    + (fmRows ? '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:6px;padding-bottom:14px">' + fmRows + '</div>' : '')
    + bodyPane(af)
    + '</section></div>'
}
