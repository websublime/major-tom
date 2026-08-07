// Mutable UI state, the load lifecycle, and the view registry metadata.

import { commits, root, timeline } from './data.mjs'

export const VIEWS = ['overview', 'roadmap', 'timeline', 'git', 'knowledge', 'config']

// A function rather than a constant, because two of these count things that only exist once a
// snapshot has been fetched (D43 point 7). Called on every header render, so it always states
// the data actually on screen and not the data that was there when the page loaded.
export function subtitles() {
  return {
    overview: 'Lifecycle state, roadmap and knowledge at a glance',
    roadmap: 'Milestones, tasks and open questions',
    timeline: timeline().events.length + '-event window merged with the commit stream',
    git: commits().length + '-commit window from the snapshot',
    knowledge: root() + ' as an OKF 0.2 bundle',
    config: 'Single source of truth for every plugin surface'
  }
}

export const S = {
  view: 'overview', layout: 'A', rail: localStorage.getItem('mt-rail') !== '0',
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

  // The body of the currently selected knowledge file, fetched one at a time now that bodies
  // have left the listing (D43 point 4). `bodyId` is the id of the file this body belongs to
  // and `bodySeq` is the sequence number of the request that is allowed to write here: a
  // response whose sequence is not the latest issued is dropped, so clicking quickly through
  // files can never leave one file's body under another file's name.
  bodyId: '', bodySeq: 0, bodyStatus: 'idle', bodyText: '', bodyError: ''
}

const initialHash = (location.hash || '').replace(/^#\/?/, '')
if (VIEWS.indexOf(initialHash) !== -1) S.view = initialHash
