// Knowledge: the bundle tree on the left, the selected file on the right.
//
// Bodies no longer travel in the listing (D43 point 4): each entry carries an opaque id and its
// body is fetched from the server one file at a time. This view stays a pure string builder and
// never fetches; main.mjs issues the request for whatever file is selected and parks the result
// in S, so the states below are just a read of that state.

import { files, groups, rel, root } from '../data.mjs'
import { S } from '../state.mjs'
import { esc } from '../ui.mjs'

// A group heading carries no data-act, so it is a row and not a control. The tree's buttons are
// its files and nothing else.
function kTreeDirRow(g) {
  return '<div class="treebtn dir">'
    + '<span class="c-grow">' + esc(g.label) + (g.dir === null ? '' : '/') + '</span>'
    + '<span class="c count">' + g.entries.length + '</span>'
    + '</div>'
}

function kTreeFileRow(f, i) {
  const type = (f.frontmatter && f.frontmatter.type) || f.type || ''
  return '<button class="treebtn file' + (S.file === i ? ' active' : '') + '" data-act="file" data-v="' + i + '">'
    + '<span class="c-grow">' + esc((f.path || '').split('/').pop()) + '</span>'
    + '<span class="c count">' + esc(type) + '</span>'
    + '</button>'
}

// The body pane renders whichever state the fetched body is in. A body is missing only because
// the request has not landed, has failed, or because the entry carries no id to ask with.
function bodyPane(af) {
  if (S.bodyStatus === 'noid') {
    return '<div class="empty">This entry carries no id, so its body cannot be fetched. '
      + 'Ids are minted by the server; an entry without one came from a producer older than the body endpoint.</div>'
  }
  if (S.bodyStatus === 'loading') {
    return '<div class="empty">Loading the body of ' + esc(af.path || 'this file') + '.</div>'
  }
  if (S.bodyStatus === 'failed') {
    return '<div class="banner">'
      + '<span class="eyebrow fg-neg">body unavailable</span>'
      + '<span class="msg fg-dim small">'
      + esc(S.bodyError || 'the request failed and the server said nothing about why') + '</span>'
      + '<button class="btn" data-act="bodyretry">retry</button>'
      + '</div>'
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
  // escaped because a directory name is data from the served bundle.
  let tree = ''
  groups().forEach(function (g) {
    tree += kTreeDirRow(g)
    g.entries.forEach(function (e) { tree += kTreeFileRow(e.file, e.index) })
  })

  const fm = af.frontmatter || {}
  const fmRows = Object.keys(fm).map(function (k) {
    const v = fm[k]
    return '<div class="row kv">'
      + '<span class="w-fmkey fg-dim small">' + esc(k) + '</span>'
      + '<span class="c-wrap">' + esc(typeof v === 'object' ? JSON.stringify(v) : v) + '</span>'
      + '</div>'
  }).join('')

  const type = fm.type || af.type || ''
  return '<div class="gridk">'
    + '<section class="panel">'
    + '<div class="panel-head short">'
    + '<span class="eyebrow">' + esc(root()) + '</span>'
    + '<span class="panel-note">okf 0.2</span>'
    + '<span class="panel-meta">' + list.length + ' file' + (list.length === 1 ? '' : 's') + '</span>'
    + '</div>' + tree + '</section>'
    + '<section class="panel">'
    + '<div class="panel-head">'
    + '<span class="c-grow">' + esc(af.path || '') + '</span>'
    + (type ? '<span class="c status fg-dim">' + esc(type) + '</span>' : '')
    + '<span class="panel-meta count">' + esc(af.size || '')
    + (af.updated ? ' &#183; ' + esc(rel(af.updated)) : '') + '</span>'
    + '</div>'
    + fmRows
    + bodyPane(af)
    + '</section>'
    + '</div>'
}
