#!/usr/bin/env node
// The artifact map (D54). Node, CommonJS, zero dependencies.
//
// What this file is. One declaration of everything the major-tom plugin writes into a
// target project, and of the transitions that apply when a project was onboarded by an
// older version of the plugin. Before it existed, that knowledge was spread over seven
// steps of a workflow prompt, some prose assertions in the Finalize phase, three merge
// scripts and a recorder that creates files as a side effect, so nobody could answer "what
// does this put in my repo?" without reading all of it.
//
// Why it lives at the plugin root, beside config.schema.json, and not under templates/.
// It is the plugin's declaration about the target project, exactly as the schema is. It is
// not a template (nothing renders it) and not application code (the dashboard does not read
// it). The plugin root is also the only place both consumers can reach it: the installed
// plugin cache copies the plugin directory and nothing above it.
//
// Why mechanisms read it rather than humans. The workflow script has no filesystem access
// (workflows/README.md, the runtime constraints table), so onboard.js cannot require this
// file. The connection is therefore a script an agent runs, the same pattern render.js and
// the three merge scripts already use. That is what turns the Finalize phase from a prose
// judgement ("verify these files exist") into a mechanism ("run this and report what it
// says"), and it is why the two hand-written asset lists this file replaces could drift
// from each other without anything noticing.
//
// Usage:
//   node migration.js --verify [repo]      what the target has against what the map declares
//   node migration.js --assets             what must exist under the plugin root
//   node migration.js --check              the map does not lie about the plugin itself
//   node migration.js --plan [repo]        which transitions apply, reported, never performed
//   node migration.js --quarantine [repo]  move proven residue out of the way, in place
//
// One of those five writes, and what it writes is a rename. D55 settled OQ-16 and settled
// it against deletion: this plugin never removes a file from a repository that is not its
// own. Residue is renamed in place to <path>.retired, which leaves it exactly where the
// user's git already sees it, tracked if it was tracked and ignored if it was ignored, so
// the change lands in their diff rather than behind their back. Nothing moves without
// evidence that we wrote it, nothing is ever overwritten, and nothing ever cleans the
// quarantine: a .retired file belongs to the user from the instant it exists.
//
// Two things this file deliberately does not cover. It is a map of the target project, so
// hooks/version-check.js writing its cache under CLAUDE_PLUGIN_DATA is out of scope: that
// is the one thing the plugin writes outside both itself and the target. And `.claude/`
// itself is not an entry: the plugin creates the directory when it is absent but never
// claims it, the host and the user both own things in there.

'use strict'

const fs = require('fs')
const path = require('path')

const PLUGIN_ROOT = __dirname
const MAP_VERSION = '0.26.0'

// ---------------------------------------------------------------------------
// Constants mirrored from the mechanisms that write them. Every one of these is
// asserted against its source file by --check, so a mechanism that changes its
// markers, its managed entry name or its managed keys without this file changing
// fails the gate instead of silently making the map wrong.
// ---------------------------------------------------------------------------

const HTML_BEGIN = '<!-- major-tom:begin -->'
const HTML_END = '<!-- major-tom:end -->'
const GITIGNORE_BEGIN = '# major-tom:begin'
const GITIGNORE_END = '# major-tom:end'
const LAUNCH_ENTRY_NAME = 'major-tom-dashboard'
const LAUNCHER_PROGRAM = '.claude/server/launcher.js'
const IGNORED_PATHS = ['.claude/worktrees/', '.claude/session/', '.claude/server/']
const SETTINGS_KEYS = [
  ['env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB', '1'],
  ['env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS', '1'],
  ['alwaysThinkingEnabled', true],
]
const SPECIALIST_BUILTIN_TOOLS = ['Read', 'Glob', 'Grep']

// The quarantine suffix (D55). One constant, because two modes have to agree on it or the
// remedy creates a defect: --quarantine renames onto it, and --verify has to recognise what
// --quarantine left behind, both to report it and to keep it out of the UNEXPECTED sweep of
// a directory the plugin owns whole. A suffix rather than a new location on purpose: moving
// the file elsewhere would change whether git tracks it, and choosing that for someone is
// not the plugin's to choose.
const RETIRED_SUFFIX = '.retired'

// ---------------------------------------------------------------------------
// The entry shape.
//
// id            Stable name of the artifact, never its path. A path can move; a
//               transition entry that named a path could not tell a move from a
//               deletion plus a creation, which is the whole reason transitions are
//               declared rather than diffed. Everything that refers to an artifact
//               refers to this id.
// paths         Ordered candidate paths, relative to the target repo root, with
//               <persistence.root> resolved from the target's own config. Almost every
//               entry has exactly one. The settings file has two because the merge
//               script's file choice is a policy, not a path: the first that exists is
//               the artifact, and when none exists the last is the one that gets
//               created. With a single path both halves of that rule coincide.
// kind          config | knowledge | mechanism-state | generated. What the artifact is
//               for. Where two apply, the section-11 split wins over the rest: the
//               launcher is copied from the plugin and is therefore generated, but it
//               is mechanism state, and that is the fact that decides whether it is
//               tracked, whether it may be recreated and whether losing it matters.
// writtenBy     The mechanism that writes it, named concretely enough to go and read.
//               A report that says something is missing is useless without it.
// tracked       tracked | ignored | not-decided. Three values, not two, because the
//               plugin only decided two of the three: D40 tracks the config and the
//               knowledge bundle on purpose and ignores the three mechanism-state
//               paths. It never decided anything about CLAUDE.md, launch.json, the
//               settings file or an installed agent, and saying "tracked" there would
//               be a guess dressed as a declaration.
// shared        True when the plugin merges into a file it does not own. This is the
//               field any future deletion has to rest on: a shared artifact can never
//               be removed whole, only the managed part of it, and the map has to know
//               which is which before the question in OQ-16 can even be asked.
// ownsContents  Directories only. True when everything inside belongs to the plugin,
//               which is what lets --verify report a file the map does not declare.
//               False for .claude/agents/ (the user has agents of their own), for the
//               knowledge areas (the user writes knowledge there) and for
//               .claude/worktrees/ (its contents are git worktrees the map does not
//               enumerate).
// instance      single | set | per-config. A set is a glob: zero or more files, each of
//               which must satisfy the evidence. A per-config entry expands to one file
//               per matching config value, so a project with no specialists produces no
//               entries rather than a false absence.
// required      always | conditional | optional. Whether absence is a defect. A
//               conditional entry carries `when`, and where the condition is mechanical
//               it carries `condition` so --verify decides instead of the reader.
// evidence      How the artifact is proved to be ours. An array of predicates, all of
//               which must hold. This is what separates a verifiable map from a list of
//               guesses: without it, --verify can only say a path exists, which is the
//               same answer for our file and for a stranger's file at the same path,
//               and no deletion could ever rest on that. Where nothing inside an
//               artifact can prove authorship, the predicate is `none` and it carries
//               the reason, so the map states the limit rather than hiding it.
// since         The plugin version from which this entry is what the plugin writes.
// note          One line, only where the entry needs one.
// ---------------------------------------------------------------------------

const MAP = [
  {
    id: 'config',
    paths: ['.claude/major-tom.json'],
    kind: 'config',
    writtenBy: 'workflows/onboard.js, Execute step 1; onboard.completedAt and specialists restamped by Finalize step 1',
    tracked: 'tracked',
    shared: false,
    instance: 'single',
    required: 'always',
    evidence: [
      { type: 'json-key', key: 'schemaVersion', value: 1 },
      { type: 'json-key', key: 'onboard.pluginVersion' },
    ],
    since: '0.9.0',
    note: 'The single source of truth every plugin surface reads (D1, D3). Its own presence is what makes a repository onboarded.',
  },
  {
    id: 'knowledge-root',
    paths: ['<persistence.root>/'],
    kind: 'knowledge',
    writtenBy: 'workflows/onboard.js, Execute step 2; also created by skills/think/scripts/record-intent.js before any onboard runs',
    tracked: 'tracked',
    shared: false,
    ownsContents: false,
    instance: 'single',
    required: 'always',
    evidence: [{ type: 'directory' }],
    since: '0.9.0',
    note: 'The OKF v0.2 bundle root (D2, D28). Tracked on purpose: it is knowledge versioned alongside the code.',
  },
  {
    id: 'knowledge-area-memories',
    paths: ['<persistence.root>/memories/'],
    kind: 'knowledge',
    writtenBy: 'workflows/onboard.js, Execute step 2',
    tracked: 'tracked',
    shared: false,
    ownsContents: false,
    instance: 'single',
    required: 'always',
    evidence: [{ type: 'directory' }],
    since: '0.9.0',
  },
  {
    id: 'knowledge-area-docs',
    paths: ['<persistence.root>/docs/'],
    kind: 'knowledge',
    writtenBy: 'workflows/onboard.js, Execute step 2',
    tracked: 'tracked',
    shared: false,
    ownsContents: false,
    instance: 'single',
    required: 'always',
    evidence: [{ type: 'directory' }],
    since: '0.9.0',
  },
  {
    id: 'knowledge-area-runs',
    paths: ['<persistence.root>/runs/'],
    kind: 'knowledge',
    writtenBy: 'workflows/onboard.js, Execute step 2; also created by skills/think/scripts/record-intent.js',
    tracked: 'tracked',
    shared: false,
    ownsContents: false,
    instance: 'single',
    required: 'always',
    evidence: [{ type: 'directory' }],
    since: '0.9.0',
  },
  {
    id: 'knowledge-area-monitors',
    paths: ['<persistence.root>/monitors/'],
    kind: 'knowledge',
    writtenBy: 'workflows/onboard.js, Execute step 2',
    tracked: 'tracked',
    shared: false,
    ownsContents: false,
    instance: 'single',
    required: 'always',
    evidence: [{ type: 'directory' }],
    since: '0.9.0',
  },
  {
    id: 'knowledge-area-logs',
    paths: ['<persistence.root>/logs/'],
    kind: 'knowledge',
    writtenBy: 'workflows/onboard.js, Execute step 2',
    tracked: 'tracked',
    shared: false,
    ownsContents: false,
    instance: 'single',
    required: 'always',
    evidence: [{ type: 'directory' }],
    since: '0.9.0',
  },
  {
    id: 'knowledge-area-gitkeep',
    paths: ['<persistence.root>/*/.gitkeep'],
    kind: 'knowledge',
    writtenBy: 'workflows/onboard.js, Execute step 2',
    tracked: 'tracked',
    shared: false,
    instance: 'set',
    required: 'optional',
    evidence: [
      {
        type: 'none',
        why: 'A .gitkeep is an empty file whose name is a universal git convention, not ours. Nothing in it or about it distinguishes one the onboard wrote from one the user wrote, and the map says so rather than claiming a proof it does not have.',
      },
    ],
    since: '0.9.0',
    note: 'Present exactly while an area directory is empty. An area that holds files needs none, and its absence is never a defect.',
  },
  {
    id: 'bundle-index',
    paths: ['<persistence.root>/index.md'],
    kind: 'knowledge',
    writtenBy: 'workflows/onboard.js, Execute step 3; created and appended to by skills/think/scripts/record-intent.js; appended to by Finalize step 5',
    tracked: 'tracked',
    shared: false,
    instance: 'single',
    required: 'always',
    evidence: [{ type: 'frontmatter', key: 'okf_version', value: '0.2' }],
    since: '0.9.0',
    note: 'The reserved bundle index (D28). The map proves the file is an OKF bundle index; it does not prove the index describes the bundle, which no predicate short of walking the whole bundle could.',
  },
  {
    id: 'run-record-onboard',
    paths: ['<persistence.root>/runs/onboard-*.md'],
    kind: 'knowledge',
    writtenBy: 'workflows/onboard.js, Finalize step 4',
    tracked: 'tracked',
    shared: false,
    instance: 'set',
    required: 'always',
    minimum: 1,
    evidence: [
      { type: 'frontmatter', key: 'type', value: 'run' },
      { type: 'pattern', source: 'by:\\s*major-tom-onboard', flags: '' },
    ],
    since: '0.9.0',
    note: 'One per onboard run. Re-onboarding adds a record, never replaces one.',
  },
  {
    id: 'intents-log',
    paths: ['<persistence.root>/runs/intents.log'],
    kind: 'knowledge',
    writtenBy: 'skills/think/scripts/record-intent.js, trivial and task tiers',
    tracked: 'tracked',
    shared: false,
    instance: 'single',
    required: 'conditional',
    when: 'at least one trivial or task intent has been recorded in this repository',
    evidence: [
      { type: 'pattern', source: '^\\d{4}-\\d{2}-\\d{2}T[^\\t]*\\t(trivial|task|substantive)\\t', flags: '' },
    ],
    since: '0.16.0',
    note: 'The evidence is the D41 column order, timestamp then tier, which is what tells the file apart from any other log at that path. Pre-D41 five-field lines are left on disk and never migrated, and they still match.',
  },
  {
    id: 'intents-dir',
    paths: ['<persistence.root>/runs/intents/'],
    kind: 'knowledge',
    writtenBy: 'skills/think/scripts/record-intent.js, substantive tier',
    tracked: 'tracked',
    shared: false,
    ownsContents: false,
    instance: 'single',
    required: 'conditional',
    when: 'at least one substantive intent has been recorded in this repository',
    evidence: [{ type: 'directory' }],
    since: '0.16.0',
  },
  {
    id: 'intent-concept',
    paths: ['<persistence.root>/runs/intents/*.md'],
    kind: 'knowledge',
    writtenBy: 'skills/think/scripts/record-intent.js, substantive tier',
    tracked: 'tracked',
    shared: false,
    instance: 'set',
    required: 'conditional',
    when: 'at least one substantive intent has been recorded in this repository',
    evidence: [{ type: 'frontmatter', key: 'type', value: 'intent' }],
    since: '0.16.0',
  },
  {
    id: 'agents-context',
    paths: ['AGENTS.md'],
    kind: 'generated',
    writtenBy: 'workflows/onboard.js, Execute render step, through templates/render.js apply from templates/context.md.tpl',
    tracked: 'not-decided',
    shared: true,
    instance: 'single',
    required: 'always',
    evidence: [{ type: 'markers', begin: HTML_BEGIN, end: HTML_END }],
    since: '0.9.0',
    note: 'Shared: only the managed block is ours (D26, D29). Content outside the markers belongs to the project and is never touched.',
  },
  {
    id: 'claude-context',
    paths: ['CLAUDE.md'],
    kind: 'generated',
    writtenBy: 'workflows/onboard.js, Execute render step, through templates/render.js apply from templates/claude.md.tpl',
    tracked: 'not-decided',
    shared: true,
    instance: 'single',
    required: 'always',
    evidence: [
      { type: 'markers', begin: HTML_BEGIN, end: HTML_END },
      { type: 'pattern', source: '@AGENTS\\.md', flags: '' },
    ],
    since: '0.9.0',
    note: 'The thin wrapper of D26: the managed block imports AGENTS.md and carries nothing else.',
  },
  {
    id: 'agents-dir',
    paths: ['.claude/agents/'],
    kind: 'generated',
    writtenBy: 'agents/agent-installer.md, driven by the Execute install step',
    tracked: 'not-decided',
    shared: true,
    ownsContents: false,
    instance: 'single',
    required: 'conditional',
    when: 'the config lists at least one specialist',
    condition: { configPath: 'specialists', nonEmpty: true },
    evidence: [{ type: 'directory' }],
    since: '0.9.0',
    note: 'Shared: the project may keep its own agents here, and the plugin installs only what the config names.',
  },
  {
    id: 'specialist-agent',
    paths: ['.claude/agents/<specialist.name>.md'],
    kind: 'generated',
    writtenBy: 'agents/agent-installer.md, driven by the Execute install step',
    tracked: 'not-decided',
    shared: false,
    instance: 'per-config',
    from: 'specialists',
    required: 'always',
    evidence: [{ type: 'frontmatter', key: 'name', value: '<specialist.name>' }],
    since: '0.9.0',
    note: 'The body is byte identical to a third-party download by D24, so nothing inside it can prove we wrote it. What proves it is ours is that the config names it and it sits where the config predicts; the frontmatter name is the check that the file at that path is the agent the config claims. Since 0.24.0 the tools line is derived by us and is a second proof, which the specialist-tools transition uses.',
  },
  {
    id: 'launch-config',
    paths: ['.claude/launch.json'],
    kind: 'config',
    writtenBy: 'templates/launch-merge.js, run by the Execute writer step 5',
    tracked: 'not-decided',
    shared: true,
    instance: 'single',
    required: 'always',
    evidence: [{ type: 'json-array-entry', key: 'configurations', nameField: 'name', name: LAUNCH_ENTRY_NAME }],
    since: '0.13.1',
    note: 'Shared: the managed entry named major-tom-dashboard is ours and is rewritten whole on every onboard; every other configuration and every unknown field is preserved (D32). The evidence checks the entry exists, not that its fields are current, because an entry written by an older plugin is still ours: that is what the launch-entry transition is for.',
  },
  {
    id: 'settings',
    paths: ['.claude/settings.local.json', '.claude/settings.json'],
    kind: 'config',
    writtenBy: 'templates/settings-merge.js, run by the Execute writer step 6',
    tracked: 'not-decided',
    shared: true,
    instance: 'single',
    required: 'always',
    evidence: SETTINGS_KEYS.map(([key, value]) => ({ type: 'json-key', key, value })),
    since: '0.15.0',
    note: 'Two paths because the file choice is the script\'s policy (D37): settings.local.json when the project has one, else settings.json, else a fresh settings.json. Shared: only the three managed keys are ours, every other key and every other env entry is preserved.',
  },
  {
    id: 'gitignore-block',
    paths: ['.gitignore'],
    kind: 'config',
    writtenBy: 'templates/gitignore-merge.js, run by the Execute writer step 7',
    tracked: 'not-decided',
    shared: true,
    instance: 'single',
    required: 'always',
    evidence: [{ type: 'markers', begin: GITIGNORE_BEGIN, end: GITIGNORE_END, contains: IGNORED_PATHS }],
    since: '0.16.0',
    note: 'Shared: the block between the markers is ours and is rewritten whole; every other line is preserved byte for byte, duplicates of our entries included (D40).',
  },
  {
    id: 'server-dir',
    paths: ['.claude/server/'],
    kind: 'mechanism-state',
    writtenBy: 'workflows/onboard.js, Execute writer step 4',
    tracked: 'ignored',
    shared: false,
    ownsContents: true,
    instance: 'single',
    required: 'always',
    evidence: [{ type: 'directory' }],
    since: '0.13.1',
    note: 'The plugin owns everything in here, which is what lets --verify report a stranger file, and is how the retired dashboard-server.js copy is found.',
  },
  {
    id: 'launcher',
    paths: ['.claude/server/launcher.js'],
    kind: 'mechanism-state',
    writtenBy: 'workflows/onboard.js, Execute writer step 4, a byte for byte copy of the plugin\'s app/launcher.js',
    tracked: 'ignored',
    shared: false,
    instance: 'single',
    required: 'always',
    evidence: [{ type: 'byte-identical', source: 'app/launcher.js' }],
    since: '0.20.0',
    note: 'The strongest evidence in the map, and the only entry that has it: the file takes no substitution of any kind (D44 as implemented by D48), so a byte difference means it is not the launcher this plugin ships.',
  },
  {
    id: 'session-dir',
    paths: ['.claude/session/'],
    kind: 'mechanism-state',
    writtenBy: 'skills/think/scripts/record-intent.js',
    tracked: 'ignored',
    shared: false,
    ownsContents: true,
    instance: 'single',
    required: 'conditional',
    when: 'an intent has been recorded since the last clone; the directory is gitignored and does not survive one',
    evidence: [{ type: 'directory' }],
    since: '0.16.0',
  },
  {
    id: 'session-record',
    paths: ['.claude/session/*.json'],
    kind: 'mechanism-state',
    writtenBy: 'skills/think/scripts/record-intent.js, read by hooks/think-gate.js',
    tracked: 'ignored',
    shared: false,
    instance: 'set',
    required: 'conditional',
    when: 'an intent has been recorded since the last clone',
    evidence: [{ type: 'json-key', key: 'intentRecorded' }],
    since: '0.16.0',
    note: 'One file per session, mutated in place. Explicitly not a source for the timeline (D41).',
  },
  {
    id: 'worktrees-dir',
    paths: ['.claude/worktrees/'],
    kind: 'mechanism-state',
    writtenBy: 'agents/vcs-operator.md, on delegated work (D38)',
    tracked: 'ignored',
    shared: false,
    ownsContents: false,
    instance: 'single',
    required: 'optional',
    evidence: [{ type: 'directory' }],
    since: '0.16.0',
    note: 'Its contents are git worktrees created one per task and removed on an explicit instruction, so the map declares the directory and never enumerates what is in it. That is why it does not own its contents: a file in there is git\'s, not the plugin\'s.',
  },
]

// ---------------------------------------------------------------------------
// Transitions.
//
// Why these are declared and not derived. Comparing the map at version A against
// the map at version B tells you a path is in one and not the other. It cannot tell
// a file that moved from a file deleted plus a file created, and those migrate in
// opposite ways: one is a rename, the other is a deletion the plugin is not allowed
// to perform plus a write it is. The map declares state; a transition declares what
// happened. A diff of states is not a substitute for either.
//
// What does not belong here. An artifact that is simply absent is a --verify concern,
// not a transition: --verify already reports it, and re-running the onboard restores
// it. A transition exists for what --verify cannot see, which is exactly three
// species:
//
//   residue  Something an older version wrote that this version does not. --verify
//            sees a file it never declared, and in an owned directory it does report
//            it, but the map alone cannot say it was once ours. The remedy is a
//            quarantine, performed by --quarantine and by nothing else (D55).
//   value    A value inside a file we own is wrong under the current design and the
//            right value is derivable. The file is still ours, so --verify must not
//            call it unrecognised; re-running the onboard rewrites it.
//   gap      The current design requires something an older version never wrote, and
//            the right value is not derivable from anything on disk. It needs the
//            interview, which means a human.
//
// since     A config whose onboard.pluginVersion is BELOW this needs the transition.
// detect    Whether it actually applies to this repository. The version alone
//           over-reports: a project onboarded at 0.19.0 that never installed a
//           specialist has no specialist frontmatter to correct. Detection is a
//           computation over the target and cannot be a literal, so it lives here
//           beside the declaration rather than somewhere it could drift from it.
// evidence  Residue only, and every residue must carry it: --check refuses one that does
//           not. It is read exactly as an entry's evidence is, an array of predicates all
//           of which must hold, evaluated by the one checkEvidence below and by no second
//           evaluator, because a second evaluator would be a second definition of what
//           "ours" means. It exists because a residue is the only thing anything here
//           writes to: --quarantine renames it, the path has not been written by this
//           plugin for several versions, and a stranger's file can be sitting there under
//           the same name. Detection says a path is occupied; evidence says by whom, and
//           only the second one may authorise a move. When it fails, the honest act is to
//           report and stop, which is what both --plan and --quarantine do.
// remedy    quarantine | rewrite | interview. What closes the transition.
// remedyBy  The mechanism that performs the remedy, named concretely enough to run.
// ---------------------------------------------------------------------------

const TRANSITIONS = [
  {
    id: 'dashboard-artifact',
    species: 'residue',
    since: '0.20.0',
    decision: 'D43, implemented by D48',
    subject: { path: '<persistence.root>/dashboard.html' },
    describe:
      'The dashboard was a snapshot embedded in a file written at onboard time. It is a served application now and no dashboard artifact is written anywhere in the target project, so a copy left in the persistence root is stale data in a place that should hold only knowledge.',
    // Both predicates are traits of the file this path actually held: the dashboard template
    // retired in 88edb9a, written into the target by `render.js inject`, which replaced the
    // island content and left every other byte of the template alone. They are read off that
    // commit, never off the dashboard the plugin ships today, which is a different file.
    //
    // The title separates the artifact from an unrelated dashboard.html. That is a common
    // enough filename for a project to keep one of its own in a knowledge root, and a
    // stranger's page is precisely what must never be moved.
    //
    // The island separates it from the dashboard this plugin ships today, which is the file
    // a user is most likely to have copied to this path by hand and which carries the very
    // same title. Today's page fetches its data from the server and has no island at all;
    // the retired one could not exist without one, because inject refused any source that
    // lacked it. The tag is matched with the same shape inject used to find it, on the id
    // attribute rather than on a whole literal tag, so an injected copy is recognised
    // whatever attribute order its source carried.
    evidence: [
      { type: 'pattern', source: '<title>Major Tom dashboard</title>', flags: '' },
      { type: 'pattern', source: '<script[^>]*id="major-tom-data"[^>]*>', flags: '' },
    ],
    remedy: 'quarantine',
    remedyBy:
      'node migration.js --quarantine, which renames the file found above in place, adding the ' +
      RETIRED_SUFFIX +
      ' suffix, and never deletes it (D55); from that instant the file is the user\'s and nothing here touches it again',
    detect(ctx) {
      const target = ctx.resolve('<persistence.root>/dashboard.html')
      return exists(path.join(ctx.repo, target)) ? [target] : []
    },
  },
  {
    id: 'server-copy',
    species: 'residue',
    since: '0.20.0',
    decision: 'D44 point 2, implemented by D48',
    subject: { path: '.claude/server/dashboard-server.js' },
    describe:
      'A copy of the dashboard server used to be written into the target project, where it aged silently every time the plugin was updated. It was replaced by launcher.js, which resolves the installed plugin at run time; the old copy still runs and still serves the version it was copied at.',
    // Both predicates are traits of the file this path actually held: the plugin's
    // templates/dashboard-server.js as it stood before a8a6b1f, copied into the target
    // verbatim with no substitution of any kind, so every byte of that commit is a byte of
    // the artifact.
    //
    // The header line is the file's own identity line. It names the plugin, names D31 and
    // states the zero-dependency constraint in one sentence that no other file carries; it
    // is anchored to the start of a line so a document merely quoting it does not match.
    //
    // The listen banner separates it from the server this plugin ships today, which is the
    // file a user is most likely to have copied into .claude/server/ by hand. Today's
    // app/server.js prints the address it actually bound and the repository it reads,
    // `(reading ${repoRoot})`; the retired copy printed a hardcoded localhost and the single
    // dashboard file it was serving, `(serving ${target})`. One line, and the two files
    // cannot both match it.
    evidence: [
      { type: 'pattern', source: '^// Static server for the Major Tom dashboard \\(D31\\)\\. Node, no dependencies\\.$', flags: 'm' },
      { type: 'pattern', source: 'major-tom dashboard on http://localhost:\\$\\{port\\} \\(serving \\$\\{target\\}\\)', flags: '' },
    ],
    remedy: 'quarantine',
    remedyBy:
      'node migration.js --quarantine, which renames the file found above in place, adding the ' +
      RETIRED_SUFFIX +
      ' suffix, and never deletes it (D55); from that instant the file is the user\'s and nothing here touches it again',
    detect(ctx) {
      const target = '.claude/server/dashboard-server.js'
      return exists(path.join(ctx.repo, target)) ? [target] : []
    },
  },
  {
    id: 'mcp-server-name',
    species: 'value',
    since: '0.22.0',
    decision: 'D50',
    subject: { entry: 'config', key: 'mcp' },
    describe:
      'The required MCP server is named codebase-memory-mcp, the key it actually registers under. A config written before the correction lists codebase-memory, which no longer validates and which the agent tool policy of D52 turns into an mcp__codebase-memory__* grant that silently grants nothing.',
    remedy: 'rewrite',
    remedyBy: 're-run /major-tom:onboard, which rewrites the config; the corrected value is codebase-memory-mcp',
    detect(ctx) {
      const list = Array.isArray(ctx.config.mcp) ? ctx.config.mcp : []
      return list.indexOf('codebase-memory') === -1 ? [] : ['mcp lists codebase-memory, expected codebase-memory-mcp']
    },
  },
  {
    id: 'launch-entry',
    species: 'value',
    since: '0.20.0',
    decision: 'D44 point 2, implemented by D48',
    subject: { entry: 'launch-config', key: 'configurations[major-tom-dashboard]' },
    describe:
      'The managed launch.json entry pointed at the repo-local server copy and carried the dashboard path in args. It points at ' +
      LAUNCHER_PROGRAM +
      ' with empty args now. The entry is still ours, which is why --verify accepts it and only --plan reports it.',
    remedy: 'rewrite',
    remedyBy: 're-run /major-tom:onboard: templates/launch-merge.js rewrites the managed entry whole',
    detect(ctx) {
      const doc = readJson(path.join(ctx.repo, '.claude', 'launch.json'))
      if (!isObject(doc) || !Array.isArray(doc.configurations)) return []
      const entry = doc.configurations.find((c) => isObject(c) && c.name === LAUNCH_ENTRY_NAME)
      if (!entry) return []
      const found = []
      if (entry.program !== LAUNCHER_PROGRAM) found.push('program is ' + JSON.stringify(entry.program) + ', expected ' + JSON.stringify(LAUNCHER_PROGRAM))
      if (Array.isArray(entry.args) && entry.args.length > 0) found.push('args carries ' + entry.args.length + ' value(s), expected none')
      return found
    },
  },
  {
    id: 'specialist-tools',
    species: 'value',
    since: '0.24.0',
    decision: 'D52, amending D24',
    subject: { entry: 'specialist-agent', key: 'tools' },
    describe:
      'An installed specialist used to keep the frontmatter the upstream shipped, so it could hold Write, Edit or Bash because a source that has never decided anything about this repository asked for them. The plugin derives the field now: the read-only built-ins plus one mcp__<server>__* per server in this project\'s mcp list, in that order.',
    remedy: 'rewrite',
    remedyBy: 're-run /major-tom:onboard, which reinstalls each configured specialist under the current tool policy',
    detect(ctx) {
      const expected = derivedSpecialistTools(ctx.config)
      const found = []
      for (const specialist of configSpecialists(ctx.config)) {
        const rel = '.claude/agents/' + specialist + '.md'
        const full = path.join(ctx.repo, rel)
        if (!exists(full)) continue
        const front = frontmatter(readText(full))
        const actual = front && typeof front.tools === 'string' ? front.tools.trim() : null
        if (actual !== expected) {
          found.push(rel + ' declares ' + (actual === null ? 'no tools field' : JSON.stringify(actual)) + ', the policy derives ' + JSON.stringify(expected))
        }
      }
      return found
    },
  },
  {
    id: 'snapshot-block',
    species: 'gap',
    since: '0.21.0',
    decision: 'D49, implementing D45',
    subject: { entry: 'config', key: 'snapshot' },
    describe:
      'The dashboard window became a project setting with a required snapshot block, days and limit. A config written before it has no block at all, and snapshot.js refuses a config without one, so the dashboard does not come up. The two numbers are the project\'s choice within 1 to 365 and 50 to 500; nothing on disk says what this project wants, so nothing can derive them.',
    remedy: 'interview',
    remedyBy: 're-run /major-tom:onboard: the interview asks both questions from the schema descriptions, which carry the range and the proposed default',
    detect(ctx) {
      return isObject(ctx.config.snapshot) ? [] : ['config carries no snapshot block']
    },
  },
]

// ---------------------------------------------------------------------------
// Required plugin assets.
//
// What must exist under the plugin root for an onboard to run. Both consumers derive
// their list from here: the blocked report in workflows/onboard.js and check 4 of
// agents/onboard-check.md, which each carried a hand-written copy until D54 and had
// already drifted apart once.
//
// `need` records why an asset is on the list, and the two answers are not the same
// thing. An `onboard` asset is read or executed by the onboard itself. A `dashboard`
// asset is not: it is what makes the dashboard the onboard configures actually work,
// because the launcher it writes requires app/server.js in the plugin it resolves.
// Both block the onboard today, as they have since D23, and whether a dashboard asset
// should is a question this file records rather than answers.
// ---------------------------------------------------------------------------

const PLUGIN_ASSETS = [
  { path: 'config.schema.json', need: 'onboard', why: 'the interview walks it and both validation steps validate against it (D3)' },
  { path: 'migration.js', need: 'onboard', why: 'this file: Finalize verifies the target against it, and onboard-check derives this very list from it. Its presence is already proven by the command that printed this list' },
  { path: 'templates/context.md.tpl', need: 'onboard', why: 'the AGENTS.md source (D26)' },
  { path: 'templates/claude.md.tpl', need: 'onboard', why: 'the CLAUDE.md wrapper source (D26)' },
  { path: 'templates/render.js', need: 'onboard', why: 'the canonical renderer, never re-implemented by an agent (D29)' },
  { path: 'templates/launch-merge.js', need: 'onboard', why: 'writes the managed launch.json entry (D32)' },
  { path: 'templates/settings-merge.js', need: 'onboard', why: 'writes the session defaults (D37)' },
  { path: 'templates/gitignore-merge.js', need: 'onboard', why: 'writes the mechanism-state ignore block (D40)' },
  { path: 'app/launcher.js', need: 'onboard', why: 'copied byte for byte into .claude/server/ (D44 point 2)' },
  { path: 'app/server.js', need: 'dashboard', why: 'what the launcher resolves and starts; a plugin without it is never picked as a candidate' },
  { path: 'app/dashboard.html', need: 'dashboard', why: 'the one page the server serves (D34, D44 point 7)' },
  { path: 'app/snapshot.js', need: 'dashboard', why: 'the whole snapshot computation the server calls (D47)' },
  { path: 'app/vendor/js-yaml.cjs.js', need: 'dashboard', why: 'the vendored parser snapshot.js requires (D44 point 4)' },
]

// ---------------------------------------------------------------------------
// Small helpers. Zero dependencies, so everything here is deliberately narrow: it
// reads what the map declares and nothing more.
// ---------------------------------------------------------------------------

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exists(target) {
  try {
    fs.statSync(target)
    return true
  } catch (err) {
    return false
  }
}

function isDirectory(target) {
  try {
    return fs.statSync(target).isDirectory()
  } catch (err) {
    return false
  }
}

function readText(target) {
  try {
    return fs.readFileSync(target, 'utf8')
  } catch (err) {
    return null
  }
}

function readJson(target) {
  const raw = readText(target)
  if (raw === null) return null
  try {
    return JSON.parse(raw)
  } catch (err) {
    return null
  }
}

function dig(value, dotted) {
  let cursor = value
  for (const part of dotted.split('.')) {
    if (!isObject(cursor)) return undefined
    cursor = cursor[part]
  }
  return cursor
}

// A line scanner, not a YAML parser: the map ships with no dependencies and the
// frontmatter it reads is the frontmatter this plugin writes, which is flat scalars.
// An unterminated block returns null rather than a partial object.
function frontmatter(text) {
  if (typeof text !== 'string') return null
  const lines = text.split('\n')
  if (lines.length === 0 || lines[0].trim() !== '---') return null
  const out = {}
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '---') return out
    const match = /^([A-Za-z0-9_.-]+):\s*(.*)$/.exec(lines[i])
    if (match) out[match[1]] = match[2].trim()
  }
  return null
}

function parseVersion(value) {
  if (typeof value !== 'string') return null
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(value.trim())
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

// Returns true when left < right. Numeric field by field, never a string comparison:
// this project's own lineage carries 0.9.0 and 0.20.0, which a string compare orders
// backwards, and every transition below would then fire in reverse.
function isBelow(leftValue, rightValue) {
  const left = parseVersion(leftValue)
  const right = parseVersion(rightValue)
  if (left === null || right === null) return false
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return left[i] < right[i]
  }
  return false
}

function configSpecialists(config) {
  const list = Array.isArray(config.specialists) ? config.specialists : []
  return list.filter((s) => isObject(s) && typeof s.name === 'string' && s.name !== '').map((s) => s.name)
}

function derivedSpecialistTools(config) {
  const servers = Array.isArray(config.mcp) ? config.mcp.filter((s) => typeof s === 'string' && s !== '') : []
  return SPECIALIST_BUILTIN_TOOLS.concat(servers.map((s) => 'mcp__' + s + '__*')).join(', ')
}

// Path resolution. Two placeholders exist and no more: <persistence.root>, which comes
// from the target's own config, and <specialist.name>, which only a per-config entry
// carries and which is substituted when that entry expands.
function makeResolver(config) {
  const root = dig(config, 'persistence.root')
  if (typeof root !== 'string' || root === '') {
    throw new Error('the target config carries no persistence.root; the map cannot resolve its paths')
  }
  return function resolve(pattern) {
    return pattern.split('<persistence.root>').join(root)
  }
}

// Glob expansion over a single starred segment, which is all any entry uses. A missing
// directory yields no matches rather than an error: an entry that is not there is the
// caller's business to judge, not this function's.
function expandGlob(repoRoot, pattern) {
  const segments = pattern.replace(/\/$/, '').split('/')
  const starIndex = segments.findIndex((s) => s.indexOf('*') !== -1)
  if (starIndex === -1) return [pattern]
  const prefix = segments.slice(0, starIndex)
  const suffix = segments.slice(starIndex + 1)
  const dir = path.join(repoRoot, ...prefix)
  if (!isDirectory(dir)) return []
  const literal = segments[starIndex]
  const re = new RegExp('^' + literal.split('*').map(escapeRegExp).join('[^/]*') + '$')
  const out = []
  for (const name of fs.readdirSync(dir).sort()) {
    if (!re.test(name)) continue
    const candidate = prefix.concat([name], suffix).join('/')
    if (exists(path.join(repoRoot, candidate))) out.push(candidate)
  }
  return out
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ---------------------------------------------------------------------------
// Evidence. Each predicate answers with null when it holds and with a sentence when
// it does not, so a failure always says what was looked for and never only that
// something failed.
// ---------------------------------------------------------------------------

function checkEvidence(predicate, fullPath, context) {
  switch (predicate.type) {
    case 'none':
      return null
    case 'directory':
      return isDirectory(fullPath) ? null : 'not a directory'
    case 'json-key': {
      const doc = readJson(fullPath)
      if (doc === null) return 'does not parse as JSON'
      const value = dig(doc, predicate.key)
      if (value === undefined) return 'carries no ' + predicate.key
      if ('value' in predicate && value !== predicate.value) {
        return predicate.key + ' is ' + JSON.stringify(value) + ', expected ' + JSON.stringify(predicate.value)
      }
      return null
    }
    case 'json-array-entry': {
      const doc = readJson(fullPath)
      if (doc === null) return 'does not parse as JSON'
      const list = dig(doc, predicate.key)
      if (!Array.isArray(list)) return 'carries no ' + predicate.key + ' array'
      const hit = list.some((item) => isObject(item) && item[predicate.nameField] === predicate.name)
      return hit ? null : 'carries no ' + predicate.key + ' entry named ' + predicate.name
    }
    case 'markers': {
      const text = readText(fullPath)
      if (text === null) return 'cannot be read'
      const begin = text.indexOf(predicate.begin)
      const end = text.indexOf(predicate.end)
      if (begin === -1 || end === -1) return 'carries no ' + predicate.begin + ' / ' + predicate.end + ' marker pair'
      if (end < begin) return 'carries its end marker before its begin marker'
      if (Array.isArray(predicate.contains)) {
        const block = text.slice(begin, end)
        const absent = predicate.contains.filter((needle) => block.indexOf(needle) === -1)
        if (absent.length > 0) return 'managed block is missing ' + absent.join(', ')
      }
      return null
    }
    case 'frontmatter': {
      const front = frontmatter(readText(fullPath))
      if (front === null) return 'carries no closed YAML frontmatter block'
      const wanted = typeof predicate.value === 'string' ? substitute(predicate.value, context) : undefined
      if (!(predicate.key in front)) return 'frontmatter carries no ' + predicate.key
      if (wanted !== undefined && front[predicate.key] !== wanted) {
        return 'frontmatter ' + predicate.key + ' is ' + JSON.stringify(front[predicate.key]) + ', expected ' + JSON.stringify(wanted)
      }
      return null
    }
    case 'pattern': {
      const text = readText(fullPath)
      if (text === null) return 'cannot be read'
      return new RegExp(predicate.source, predicate.flags || '').test(text) ? null : 'does not match /' + predicate.source + '/'
    }
    case 'byte-identical': {
      const source = path.join(PLUGIN_ROOT, predicate.source)
      let left
      let right
      try {
        left = fs.readFileSync(fullPath)
        right = fs.readFileSync(source)
      } catch (err) {
        return 'cannot be compared against the plugin\'s ' + predicate.source + ' (' + err.message + ')'
      }
      return left.equals(right) ? null : 'differs from the plugin\'s ' + predicate.source
    }
    default:
      return 'unknown evidence predicate ' + predicate.type
  }
}

function substitute(value, context) {
  let out = value
  if (context && typeof context.specialistName === 'string') {
    out = out.split('<specialist.name>').join(context.specialistName)
  }
  return out
}

// The one place a list of predicates becomes a list of reasons. Map entries and residue
// transitions both come through here, so "the evidence holds" means exactly the same thing
// for a file --verify calls ours and for a file --quarantine is about to rename. Empty means
// every predicate held; a residue with no predicates at all cannot reach this function,
// because --check refuses to let one exist.
function evidenceFailures(predicates, fullPath, context) {
  return (predicates || [])
    .map((predicate) => checkEvidence(predicate, fullPath, context))
    .filter((failure) => failure !== null)
}

// ---------------------------------------------------------------------------
// Entry resolution: from a declaration to the concrete paths in one repository.
// ---------------------------------------------------------------------------

function resolveEntry(entry, ctx) {
  if (entry.instance === 'per-config' && entry.from === 'specialists') {
    return configSpecialists(ctx.config).map((name) => ({
      path: ctx.resolve(entry.paths[0]).split('<specialist.name>').join(name),
      context: { specialistName: name },
    }))
  }
  if (entry.instance === 'set') {
    return expandGlob(ctx.repo, ctx.resolve(entry.paths[0])).map((p) => ({ path: p, context: null }))
  }
  const candidates = entry.paths.map((p) => ctx.resolve(p).replace(/\/$/, ''))
  const present = candidates.find((p) => exists(path.join(ctx.repo, p)))
  return [{ path: present || candidates[candidates.length - 1], context: null, absent: present === undefined }]
}

function conditionHolds(entry, config) {
  if (!entry.condition) return null
  const value = dig(config, entry.condition.configPath)
  if (entry.condition.nonEmpty) return Array.isArray(value) && value.length > 0
  return null
}

// ---------------------------------------------------------------------------
// --verify
// ---------------------------------------------------------------------------

function verify(repo) {
  const config = readJson(path.join(repo, '.claude', 'major-tom.json'))
  if (config === null) {
    console.error('verify: ' + repo + ' carries no readable .claude/major-tom.json, so it is not an onboarded project')
    return 1
  }
  let resolve
  try {
    resolve = makeResolver(config)
  } catch (err) {
    console.error('verify: ' + err.message)
    return 1
  }
  const ctx = { repo, config, resolve }

  const counts = { ok: 0, absent: 0, missing: 0, unrecognised: 0, unexpected: 0, retired: 0, quarantined: 0 }
  const declared = new Set()

  // Every declared residue path and the quarantined form of it, resolved once and before
  // any loop runs. The quarantined form has to be known by the time the owned-directory
  // sweep starts: .claude/server/ owns its contents, so a dashboard-server.js.retired left
  // there would be reported UNEXPECTED on every run for the rest of the project's life, and
  // a remedy that installs a permanent new problem is not a remedy.
  const residuePaths = TRANSITIONS.filter((t) => t.species === 'residue').map((t) => ({
    transition: t,
    path: ctx.resolve(t.subject.path),
  }))
  const quarantinedPaths = new Set(residuePaths.map((r) => r.path + RETIRED_SUFFIX))

  for (const entry of MAP) {
    const instances = resolveEntry(entry, ctx)

    if (entry.instance === 'set' || entry.instance === 'per-config') {
      // A per-config entry has no minimum of its own: the config list is the condition,
      // so a project that configured no specialists is complete with no specialist file.
      const minimum = entry.instance === 'per-config' ? 0 : entry.required === 'always' ? entry.minimum || 1 : 0
      if (instances.length < minimum) {
        counts.missing += 1
        report('MISSING', ctx.resolve(entry.paths[0]), entry, 'no file matches, and the map requires at least ' + minimum)
        continue
      }
      if (instances.length === 0) {
        counts.absent += 1
        const reason = entry.instance === 'per-config' ? 'the config lists no ' + entry.from : absenceReason(entry, config)
        report('absent', ctx.resolve(entry.paths[0]), entry, reason)
        continue
      }
    }

    for (const instance of instances) {
      declared.add(instance.path)
      const full = path.join(repo, instance.path)
      if (!exists(full)) {
        const decided = conditionHolds(entry, config)
        if (entry.required === 'always' || decided === true) {
          counts.missing += 1
          report('MISSING', instance.path, entry, null)
        } else {
          counts.absent += 1
          report('absent', instance.path, entry, absenceReason(entry, config))
        }
        continue
      }
      const failures = evidenceFailures(entry.evidence, full, instance.context)
      if (failures.length > 0) {
        counts.unrecognised += 1
        report('UNRECOGNISED', instance.path, entry, failures.join('; '))
      } else {
        counts.ok += 1
        report('ok', instance.path, entry, null)
      }
    }
  }

  // Directories the plugin owns whole. This is the only place --verify can name a file
  // it never declared, and it is why ownsContents exists.
  for (const entry of MAP) {
    if (!entry.ownsContents) continue
    const dir = path.join(repo, ctx.resolve(entry.paths[0]).replace(/\/$/, ''))
    if (!isDirectory(dir)) continue
    for (const name of fs.readdirSync(dir).sort()) {
      const rel = ctx.resolve(entry.paths[0]).replace(/\/$/, '') + '/' + name
      if (declared.has(rel)) continue
      // The quarantine this tool itself performed is not a stranger file. Reporting it here
      // would punish the user for taking the remedy, and it is reported once below with what
      // it actually is.
      if (quarantinedPaths.has(rel)) continue
      counts.unexpected += 1
      console.log(pad('UNEXPECTED') + rel + '  -- the plugin owns ' + entry.paths[0] + ' whole and the map does not declare this')
    }
  }

  // Retired paths are checked whatever version wrote this project: a residue is residue
  // regardless of what the config claims, and the config can be wrong or hand-edited.
  //
  // The two states are reported independently, never as alternatives, because both can be
  // true at once: that is exactly the repository where --quarantine already ran, found the
  // destination taken and refused to overwrite it. Residue still present stays a problem
  // whatever else sits beside it and whether or not the user declined the quarantine (D55
  // point 5); the map reports the state of the repository, and reporting that the user
  // declined is the onboard's job, not the map's.
  for (const { transition, path: target } of residuePaths) {
    if (exists(path.join(repo, target))) {
      counts.retired += 1
      console.log(pad('RETIRED') + target + '  -- written by a plugin before ' + transition.since + ', retired by ' + transition.decision + '; run --plan for what it means')
    }
    const retired = target + RETIRED_SUFFIX
    if (exists(path.join(repo, retired))) {
      counts.quarantined += 1
      console.log(pad('quarantined') + retired + '  -- residue moved aside by --quarantine (D55). Yours from that instant: nothing here reads it, rewrites it or removes it')
    }
  }

  console.log(
    'verify: ' +
      counts.ok +
      ' ok, ' +
      counts.absent +
      ' absent, ' +
      counts.missing +
      ' missing, ' +
      counts.unrecognised +
      ' unrecognised, ' +
      counts.unexpected +
      ' unexpected, ' +
      counts.retired +
      ' retired, ' +
      counts.quarantined +
      ' quarantined'
  )
  const problems = counts.missing + counts.unrecognised + counts.unexpected + counts.retired
  return problems === 0 ? 0 : 1
}

// Statuses that name a problem are uppercase and statuses that do not are lowercase, so a
// reader and a grep both find the problems without reading the summary line. The rule has no
// exceptions: `grep '^[A-Z]'` over --verify's output means exactly "the problems" and nothing
// else, which is why `quarantined` is lowercase here beside `ok` and `absent`.
//
// The same word is uppercase in --quarantine's output, and that is not an inconsistency to be
// tidied away in either direction. The two outputs are not the same kind of sentence. --verify
// reports a state it observed in a repository, and this state is not a problem. --quarantine
// reports an action it just performed on somebody's file, and every line of that output is an
// action, which is why all of them are uppercase there and none of them is a status. An action
// performed is not a status observed; whoever "fixes" one of these to match the other will
// break the grep contract on one side or lose the emphasis on the other.
function report(status, target, entry, detail) {
  const suffix = detail ? '  -- ' + detail : ''
  console.log(pad(status) + target + '  [' + entry.id + ', ' + entry.kind + ', ' + entry.tracked + ']' + suffix)
}

function pad(label) {
  const width = 14
  return label + ' '.repeat(Math.max(1, width - label.length))
}

function absenceReason(entry, config) {
  if (entry.required === 'optional') return 'optional'
  if (entry.required === 'conditional') {
    const decided = conditionHolds(entry, config)
    if (decided === false) return 'conditional, and the condition does not hold: ' + entry.when
    return 'conditional: ' + entry.when
  }
  return null
}

// ---------------------------------------------------------------------------
// --assets
// ---------------------------------------------------------------------------

function assets() {
  for (const asset of PLUGIN_ASSETS) console.log(asset.path)
  return 0
}

// ---------------------------------------------------------------------------
// --check. The map does not lie about the plugin itself.
//
// Three families of lie are possible and each is checked. The map can name a plugin
// file that is not there. The map can contradict itself, by pointing a transition at
// an entry id that does not exist or by using a placeholder nothing resolves. And the
// map can contradict a mechanism, by declaring a marker, a managed entry name or a
// managed key that the script writing it no longer uses; that last family is the one
// documentation cannot catch, and it is the reason this gate is worth having.
// ---------------------------------------------------------------------------

// The declaration-time checks on one predicate, as opposed to the run-time evaluation in
// checkEvidence. Entries and residue transitions share them because they share the
// evaluator: a predicate that cannot be trusted inside an entry that only reports certainly
// cannot be trusted inside the one transition that gets acted on.
function predicateProblems(ownerId, predicate) {
  const problems = []
  if (predicate.type === 'byte-identical' && !exists(path.join(PLUGIN_ROOT, predicate.source))) {
    problems.push(ownerId + ': byte-identical evidence names a plugin file that is not there, ' + predicate.source)
  }
  if (predicate.type === 'none' && !predicate.why) {
    problems.push(ownerId + ': evidence none must say why no proof is available')
  }
  if (predicate.type === 'pattern') {
    try {
      new RegExp(predicate.source, predicate.flags || '')
    } catch (err) {
      problems.push(ownerId + ': evidence pattern does not compile, ' + err.message)
    }
  }
  return problems
}

function check() {
  const problems = []

  for (const asset of PLUGIN_ASSETS) {
    if (!exists(path.join(PLUGIN_ROOT, asset.path))) {
      problems.push('required asset missing from the plugin: ' + asset.path)
    }
  }

  const ids = new Set()
  for (const entry of MAP) {
    if (ids.has(entry.id)) problems.push('duplicate map entry id: ' + entry.id)
    ids.add(entry.id)
    if (!Array.isArray(entry.paths) || entry.paths.length === 0) problems.push(entry.id + ': no paths')
    if (!Array.isArray(entry.evidence) || entry.evidence.length === 0) problems.push(entry.id + ': no evidence')
    if (['config', 'knowledge', 'mechanism-state', 'generated'].indexOf(entry.kind) === -1) {
      problems.push(entry.id + ': unknown kind ' + entry.kind)
    }
    if (['tracked', 'ignored', 'not-decided'].indexOf(entry.tracked) === -1) {
      problems.push(entry.id + ': unknown tracked value ' + entry.tracked)
    }
    if (['always', 'conditional', 'optional'].indexOf(entry.required) === -1) {
      problems.push(entry.id + ': unknown required value ' + entry.required)
    }
    if (entry.required === 'conditional' && !entry.when) problems.push(entry.id + ': conditional with no stated condition')
    if (parseVersion(entry.since) === null) problems.push(entry.id + ': since is not a version')
    for (const p of entry.paths) {
      const placeholders = p.match(/<[^>]+>/g) || []
      for (const placeholder of placeholders) {
        if (placeholder !== '<persistence.root>' && placeholder !== '<specialist.name>') {
          problems.push(entry.id + ': unknown placeholder ' + placeholder)
        }
      }
      const starred = p.replace(/\/$/, '').split('/').filter((s) => s.indexOf('*') !== -1)
      if (starred.length > 1) problems.push(entry.id + ': more than one starred path segment, which expandGlob does not support')
      if (starred.length > 0 && entry.instance !== 'set') problems.push(entry.id + ': starred path on a non-set entry')
    }
    if (Array.isArray(entry.evidence)) {
      for (const predicate of entry.evidence) problems.push(...predicateProblems(entry.id, predicate))
    }
  }

  const transitionIds = new Set()
  for (const transition of TRANSITIONS) {
    if (transitionIds.has(transition.id)) problems.push('duplicate transition id: ' + transition.id)
    transitionIds.add(transition.id)
    if (['residue', 'value', 'gap'].indexOf(transition.species) === -1) {
      problems.push(transition.id + ': unknown species ' + transition.species)
    }
    if (parseVersion(transition.since) === null) problems.push(transition.id + ': since is not a version')
    if (typeof transition.detect !== 'function') problems.push(transition.id + ': no detect')
    if (transition.subject.entry && !ids.has(transition.subject.entry)) {
      problems.push(transition.id + ': subject names an entry that is not in the map, ' + transition.subject.entry)
    }
    if (transition.species === 'residue' && !transition.subject.path) {
      problems.push(transition.id + ': a residue must name the path it left behind')
    }
    if (transition.species !== 'residue' && transition.subject.path) {
      problems.push(transition.id + ': only a residue names a path; a value or a gap names the entry it lives in')
    }
    if (transition.species === 'residue') {
      // The invariant D55 rests on. A residue is the only thing --quarantine acts on, and it
      // acts by writing; a residue with no evidence would let the one writing mode move a
      // file on nothing but a path match, which is the exact act D55 point 2 forbids. The
      // gate lives here so that adding a residue in some future version without also
      // declaring what proves it is ours fails the pre-commit check rather than reaching a
      // user's repository.
      if (!Array.isArray(transition.evidence) || transition.evidence.length === 0) {
        problems.push(transition.id + ': a residue must declare non-empty evidence that the file is ours; --quarantine never moves a path without it')
      } else {
        for (const predicate of transition.evidence) problems.push(...predicateProblems(transition.id, predicate))
        // `none` is an honest answer for a map entry, which only reports what it found. It
        // is not an answer here: an artifact nothing can prove is ours is precisely the one
        // that must never be renamed.
        if (transition.evidence.some((predicate) => predicate.type === 'none')) {
          problems.push(transition.id + ': evidence none proves nothing, and a residue is the one thing that gets moved on its evidence')
        }
      }
      if (['quarantine'].indexOf(transition.remedy) === -1) {
        problems.push(transition.id + ': a residue is remedied by quarantine and by nothing else (D55), not by ' + JSON.stringify(transition.remedy))
      }
    } else if (transition.evidence) {
      problems.push(transition.id + ': only a residue carries evidence; a value or a gap lives inside a file the map already proves through its entry')
    }
  }

  // The map against the mechanisms. Each of these reads the file that actually writes
  // the thing and asserts the literal the map declares still appears in it.
  const agreements = [
    ['templates/render.js', [HTML_BEGIN, HTML_END]],
    ['templates/gitignore-merge.js', [GITIGNORE_BEGIN, GITIGNORE_END].concat(IGNORED_PATHS)],
    ['templates/launch-merge.js', [LAUNCH_ENTRY_NAME, LAUNCHER_PROGRAM]],
    ['templates/settings-merge.js', SETTINGS_KEYS.map(([key]) => key.split('.').pop())],
    ['templates/claude.md.tpl', [HTML_BEGIN, HTML_END]],
    ['templates/context.md.tpl', [HTML_BEGIN, HTML_END]],
    ['agents/agent-installer.md', SPECIALIST_BUILTIN_TOOLS],
  ]
  for (const [rel, needles] of agreements) {
    const text = readText(path.join(PLUGIN_ROOT, rel))
    if (text === null) {
      problems.push('cannot read ' + rel + ' to check the map agrees with it')
      continue
    }
    for (const needle of needles) {
      if (text.indexOf(needle) === -1) {
        problems.push(rel + ' no longer carries ' + JSON.stringify(needle) + ', which the map declares')
      }
    }
  }

  // The ignore block and the map must agree on exactly which paths are ignored, in both
  // directions: a path the block ignores that no entry declares means the map is
  // incomplete, and an entry claiming ignored that the block does not list means the
  // map is wrong.
  const ignoredByMap = MAP.filter((e) => e.tracked === 'ignored').map((e) => e.paths[0])
  for (const declaredPath of IGNORED_PATHS) {
    if (!ignoredByMap.some((p) => p === declaredPath || p.indexOf(declaredPath) === 0)) {
      problems.push('the ignore block lists ' + declaredPath + ' and no map entry declares it')
    }
  }
  for (const entryPath of ignoredByMap) {
    if (!IGNORED_PATHS.some((p) => entryPath === p || entryPath.indexOf(p) === 0)) {
      problems.push('map entry ' + entryPath + ' claims ignored and the ignore block does not cover it')
    }
  }

  if (problems.length > 0) {
    for (const problem of problems) console.error('migration.js --check: ' + problem)
    console.error(problems.length + ' problem(s). The map disagrees with the plugin it describes.')
    return 1
  }
  console.log('artifact map consistent: ' + MAP.length + ' entries, ' + TRANSITIONS.length + ' transitions, ' + PLUGIN_ASSETS.length + ' required assets')
  return 0
}

// ---------------------------------------------------------------------------
// --plan. Reports. Writes nothing, deletes nothing, and calls nothing that could.
// ---------------------------------------------------------------------------

function plan(repo) {
  const config = readJson(path.join(repo, '.claude', 'major-tom.json'))
  if (config === null) {
    console.error('plan: ' + repo + ' carries no readable .claude/major-tom.json, so there is nothing to migrate')
    return 1
  }
  let resolve
  try {
    resolve = makeResolver(config)
  } catch (err) {
    console.error('plan: ' + err.message)
    return 1
  }
  const onboardedAt = dig(config, 'onboard.pluginVersion')
  const ctx = { repo, config, resolve }

  console.log('plan: onboarded by ' + (onboardedAt || 'an unrecorded version') + ', map at ' + MAP_VERSION)

  let applies = 0
  let clear = 0
  let skipped = 0

  for (const transition of TRANSITIONS) {
    const byVersion = onboardedAt === undefined || isBelow(onboardedAt, transition.since)
    const found = transition.detect(ctx)
    if (!byVersion && found.length === 0) {
      skipped += 1
      continue
    }
    if (found.length === 0) {
      clear += 1
      console.log('CLEAR    ' + transition.species + '  ' + transition.id + '  (' + transition.decision + ')  applies to ' + onboardedAt + ' by version, and nothing in this repository carries it')
      continue
    }
    applies += 1
    console.log('APPLIES  ' + transition.species + '  ' + transition.id + '  (' + transition.decision + ', from ' + transition.since + ')')
    // A residue's `found` entries are paths, and a path is not yet a claim of ownership. The
    // remedy line below states what the remedy is in general; only the evidence says whether
    // this repository's file will actually get it, so it is answered per path here rather
    // than left implied. A report that named a remedy for a file nothing will touch would be
    // worse than no report: the user would wait for something that is never going to happen.
    for (const detail of found) {
      if (transition.species !== 'residue') {
        console.log('         found: ' + detail)
        continue
      }
      const failures = evidenceFailures(transition.evidence, path.join(ctx.repo, detail), null)
      if (failures.length === 0) {
        console.log('         found: ' + detail + '  -- the evidence holds, so --quarantine will move this one')
      } else {
        console.log(
          '         found: ' + detail + '  -- the evidence does NOT hold (' + failures.join('; ') + '), so nothing will touch it: it is reported and left exactly where it is'
        )
      }
    }
    console.log('         what: ' + transition.describe)
    console.log('         remedy: ' + transition.remedy + '; ' + transition.remedyBy)
  }

  console.log(
    'plan: ' + applies + ' applies, ' + clear + ' clear, ' + skipped + ' not applicable. Nothing was written, moved or deleted: --plan reports only.'
  )
  return 0
}

// ---------------------------------------------------------------------------
// --quarantine. The only mode that writes, and all it writes is a rename (D55).
//
// Why a rename and not a deletion. OQ-16 asked whether this plugin may delete a file it once
// wrote in someone else's repository, and the answer is no, permanently. The plugin cannot
// know what a user did with that file since it was written, and a deletion is the one act
// that leaves them nothing to look at afterwards. A rename in place costs the same, keeps
// the bytes, and is visible in the same diff the user was going to read anyway.
//
// Why in place and not into a folder of our own. A quarantine directory would be a new
// artifact the map would then have to declare, own and eventually explain, and moving the
// file into it would silently change whether git tracks it: a tracked knowledge file would
// vanish from the index, an ignored mechanism file could reappear in it. Suffixing the name
// where it already sits changes neither.
//
// Three answers and no fourth. The evidence holds and the destination is free, so the file
// moves. The evidence does not hold, so nothing is touched and the reason is printed: a path
// match is not proof, and acting on one would make this mode capable of moving a stranger's
// file. The destination exists, so nothing is touched either, because overwriting is
// destroying by another name and there is no argument for it that a deletion would not also
// pass. None of the three is a failure of this command, so the exit status stays 0; only an
// I/O error the filesystem reports is a failure, because then the mode did not do what it
// said it did.
//
// What this mode never does. It never removes a .retired file, never inspects one, never
// re-runs a quarantine that already happened and never cleans up after itself (D55 point 4).
// From the instant that file exists it is the user's, and a tool that tidied it away would
// be a deletion wearing a delay.
//
// Every label printed here is uppercase, and that does not contradict --verify's rule that
// uppercase means a problem. See the note above report(): --verify prints states it observed
// and only some of them are problems, so the case carries information there. Every line here
// is an action this command just took on somebody's file, which is the whole reason to print
// it at all, so there is nothing for the case to distinguish and nothing to lower.
// ---------------------------------------------------------------------------

function quarantine(repo) {
  const config = readJson(path.join(repo, '.claude', 'major-tom.json'))
  if (config === null) {
    console.error('quarantine: ' + repo + ' carries no readable .claude/major-tom.json, so it is not an onboarded project and nothing here may touch it')
    return 1
  }
  let resolve
  try {
    resolve = makeResolver(config)
  } catch (err) {
    console.error('quarantine: ' + err.message)
    return 1
  }
  const ctx = { repo, config, resolve }

  let moved = 0
  let skipped = 0
  let failed = 0

  for (const transition of TRANSITIONS) {
    if (transition.species !== 'residue') continue
    // Detection is over the repository and never over the recorded version, exactly as in
    // --plan: a residue is residue whatever the config claims, and a config can be
    // hand-edited or restamped by a later onboard without the file ever going away.
    for (const target of transition.detect(ctx)) {
      const from = path.join(repo, target)
      const to = from + RETIRED_SUFFIX
      const relTo = target + RETIRED_SUFFIX

      const failures = evidenceFailures(transition.evidence, from, null)
      if (failures.length > 0) {
        skipped += 1
        console.log(pad('SKIPPED') + target + '  -- the evidence that this is ours does not hold (' + failures.join('; ') + '), so it stays exactly where it is')
        continue
      }
      if (exists(to)) {
        skipped += 1
        console.log(pad('SKIPPED') + target + '  -- ' + relTo + ' already exists; nothing is ever overwritten')
        continue
      }
      try {
        fs.renameSync(from, to)
      } catch (err) {
        failed += 1
        console.error(pad('FAILED') + target + '  -- ' + err.message)
        continue
      }
      moved += 1
      console.log(pad('QUARANTINED') + target + ' -> ' + relTo)
    }
  }

  console.log(
    'quarantine: ' +
      moved +
      ' quarantined, ' +
      skipped +
      ' skipped, ' +
      failed +
      ' failed. Nothing was deleted and nothing was overwritten: a ' +
      RETIRED_SUFFIX +
      ' file is yours from the instant it exists, and no mode here ever reads, rewrites or removes one (D55).'
  )
  return failed === 0 ? 0 : 1
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function usage() {
  console.error('usage: node migration.js --verify [repo] | --assets | --check | --plan [repo] | --quarantine [repo]')
  return 1
}

function main(argv) {
  const mode = argv[0]
  const target = argv[1] ? path.resolve(argv[1]) : process.cwd()
  if (mode === '--verify') return verify(target)
  if (mode === '--plan') return plan(target)
  if (mode === '--quarantine') return quarantine(target)
  if (mode === '--assets') return assets()
  if (mode === '--check') return check()
  return usage()
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)))
}

module.exports = { MAP, TRANSITIONS, PLUGIN_ASSETS, MAP_VERSION }
