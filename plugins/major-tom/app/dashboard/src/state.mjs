// Mutable UI state, the load lifecycle, and the view registry metadata.

import { commits, root, timeline } from './data.mjs'

export const VIEWS = ['overview', 'roadmap', 'timeline', 'git', 'knowledge', 'config']

// A function rather than a constant, because two of these count things that only exist once a
// snapshot has been fetched (D43 point 7). Called on every header render, so it always states
// the data actually on screen and not the data that was there when the page loaded.
export function subtitles() {
  return {
    overview: 'lifecycle state, roadmap and knowledge at a glance',
    roadmap: 'overall progress, milestones and their tasks',
    timeline: timeline().events.length + '-event window merged with the commit stream',
    git: commits().length + '-commit window from the snapshot',
    knowledge: root() + ' as an OKF 0.2 bundle',
    config: 'single source of truth for every plugin surface'
  }
}

export const S = {
  view: 'overview', rail: localStorage.getItem('mt-rail') !== '0',
  theme: localStorage.getItem('mt-theme') || (window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'),
  filter: 'all', query: '', file: 0, configMode: 'table',

  // The load lifecycle. `status` is 'loading' until the first snapshot arrives, then 'ready'
  // or 'failed'; it never returns to 'loading' once data is on screen, because a refresh over
  // a rendered view must not blank it. `busy` is the in-flight flag that both states share,
  // and it is what stops the refresh control from issuing overlapping requests. `hasData` says
  // whether a snapshot ever landed, which is what separates "nothing to show" from "a refresh
  // failed over something worth keeping on screen". `error` is the message the server sent,
  // which is all the page has to show once D43 point 2 removed the fallback, and `errorRoute`
  // names the request that failed.
  status: 'loading', busy: false, hasData: false, error: '', errorRoute: '',

  // The window of D45, which is the one the timeline events and the git commits are both cut
  // by (D42, D45 point 4). Three fields, and the split between them is what the control needs
  // to stay honest.
  //
  // `window` is the window the reader chose, and it is null until a choice is made: null means
  // no parameters travel and the server applies the configured default, which is what puts a
  // reload back on the default without anything having to reset it. It is not in localStorage
  // and not in the URL, deliberately (D45 point 3): the parameter is an adjustment to a reading
  // session, not a setting, and the config stays the single source of truth for the window a
  // project shows. The theme and the rail state above are stored, and that precedent was
  // considered and rejected here, because a stored window would make what this page shows no
  // longer derivable from the config alone.
  //
  // `windowDraft` is what the two fields hold. It is re-synced from the effective window of
  // every snapshot that lands, so the control states the window on screen rather than a
  // constant, and it is left exactly as typed when a request is refused, so the reader corrects
  // the value in place instead of retyping it.
  //
  // `windowError` is the message the server sent when it refused the window. It is kept apart
  // from `error` above on purpose: `error` means no snapshot could be computed, while this one
  // means the snapshot on screen is untouched and a number in a field is wrong. `windowBusy`
  // is the in-flight half of the same distinction, true only while a window change is in the
  // air and not while an ordinary refresh is, so the control states what it is actually doing.
  window: null, windowDraft: { days: '', limit: '' }, windowError: '', windowBusy: false,

  // The body of the currently selected knowledge file, fetched one at a time now that bodies
  // have left the listing (D43 point 4). `bodyId` is the id of the file this body belongs to
  // and `bodySeq` is the sequence number of the request that is allowed to write here: a
  // response whose sequence is not the latest issued is dropped, so clicking quickly through
  // files can never leave one file's body under another file's name.
  bodyId: '', bodySeq: 0, bodyStatus: 'idle', bodyText: '', bodyError: ''
}

const initialHash = (location.hash || '').replace(/^#\/?/, '')
if (VIEWS.indexOf(initialHash) !== -1) S.view = initialHash
