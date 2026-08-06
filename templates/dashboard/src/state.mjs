// Mutable UI state and the view registry metadata.

import { CFG, COMMITS, ROOT } from './data.mjs'

export const VIEWS = ['overview', 'roadmap', 'git', 'knowledge', 'config']

export const SUBTITLES = {
  overview: 'Lifecycle state, roadmap and knowledge at a glance',
  roadmap: 'Milestones, tasks and open questions',
  git: COMMITS.length + '-commit window from the snapshot',
  knowledge: ROOT + ' as an OKF 0.2 bundle',
  config: 'Single source of truth for every plugin surface'
}

export const S = {
  view: 'overview', layout: 'A', rail: localStorage.getItem('mt-rail') !== '0',
  theme: localStorage.getItem('mt-theme') || (window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'),
  filter: 'all', query: '', file: 0, configMode: 'table'
}

const initialHash = (location.hash || '').replace(/^#\/?/, '')
if (VIEWS.indexOf(initialHash) !== -1) S.view = initialHash
