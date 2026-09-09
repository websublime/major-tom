// Git: the full commit window, narrowed by a text filter and by conventional kind.

import { commits } from '../data.mjs'
import { S } from '../state.mjs'
import { esc } from '../ui.mjs'

const GIT_KINDS = ['all', 'feat', 'fix', 'docs', 'test', 'chore', 'refactor']

// The churn column is dropped whole when no commit in the window carries diff stats, so the
// head and the rows state the same columns rather than a label over nothing.
function gitCommitRow(c, hasStat) {
  return '<div class="row">'
    + '<span class="w-sha fg-dim small">' + esc(c.sha) + '</span>'
    + '<span class="w-kind small" style="color:' + c.kindColor + '">' + esc(c.kind) + '</span>'
    + '<span class="c-grow">' + esc(c.subject) + '</span>'
    + '<span class="w-author ellip fg-dim small">' + esc(c.author) + '</span>'
    + (hasStat
      ? '<span class="w-churn c-right num small"><span class="fg-done">+' + esc(c.add || 0) + '</span> '
        + '<span class="fg-neg">&#8722;' + esc(c.del || 0) + '</span></span>'
      : '')
    + '<span class="w-when c-right count">' + esc(c.when) + '</span>'
    + '</div>'
}

export function vGit() {
  const q = S.query.trim().toLowerCase()
  const all = commits()
  // The query runs over `fullSubject`, the line the repository wrote, while the cell shows the
  // stripped one. A word that lives only in the prefix therefore still matches, so typing
  // `release` finds `chore(release): manifests at 0.28.0`, whose cell prints the tail alone.
  const visible = all.filter(function (c) {
    return (S.filter === 'all' || c.kind === S.filter)
      && (!q || (c.fullSubject + ' ' + c.sha + ' ' + c.author).toLowerCase().indexOf(q) !== -1)
  })

  // Both returns below wrap the tools row and its table in one tight stack, so the row sits
  // closer to the table than the gap the view leaves between blocks. dashboard.css owns both gaps.
  //
  // The input carries no listener of its own. main.mjs binds one after every render, which is
  // what keeps it at exactly one listener per rendered element.
  const tools = '<div class="stack tight"><div class="tools">'
    + '<div class="filter"><span>filter</span>'
    + '<input id="git-q" type="text" placeholder="subject, sha, author" value="' + esc(S.query) + '"></div>'
    + '<div class="seg">' + GIT_KINDS.map(function (k) {
      return '<button data-act="filter" data-v="' + k + '"'
        + (S.filter === k ? ' class="active"' : '') + '>' + k + '</button>'
    }).join('') + '</div>'
    + '<span class="push fg-dim small">' + visible.length + ' of ' + all.length + ' commits</span>'
    + '</div>'

  if (!all.length) {
    return tools + '<section class="panel"><div class="empty">No commits in the snapshot.</div></section></div>'
  }

  const hasStat = all.some(function (c) { return c.add != null })
  return tools + '<section class="panel">'
    + '<div class="thead">'
    + '<span class="w-sha">sha</span>'
    + '<span class="w-kind">kind</span>'
    + '<span class="c-grow">subject</span>'
    + '<span class="w-author">author</span>'
    + (hasStat ? '<span class="w-churn c-right">churn</span>' : '')
    + '<span class="w-when c-right">when</span>'
    + '</div>'
    + visible.map(function (c) { return gitCommitRow(c, hasStat) }).join('')
    + '</section></div>'
}
