#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const childProcess = require('child_process');

const PLUGIN_NAME = 'major-tom';
const CACHE_FILE_NAME = 'version-check.json';
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MARKETPLACE_URL =
  'https://raw.githubusercontent.com/websublime/major-tom/main/.claude-plugin/marketplace.json';
const REFRESH_TIMEOUT_MS = 10000;
const REFRESH_MAX_BYTES = 512 * 1024;
const MAX_REMEMBERED_PROJECTS = 50;

// ---------------------------------------------------------------------------
// Failure posture: every path out of this hook is exit 0. A non-zero exit
// discards stdout, and a version notice may never break or delay a session.
// ---------------------------------------------------------------------------

function silent() {
  process.exit(0);
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    return null;
  }
}

function writeJsonFile(filePath, value) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporaryPath = filePath + '.' + process.pid + '.tmp';
    fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2) + '\n', 'utf8');
    fs.renameSync(temporaryPath, filePath);
    return true;
  } catch (err) {
    return false;
  }
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Semver comparison. String comparison gets 0.9.0 against 0.17.0 backwards,
// which would fire every notice in reverse, so versions are parsed into
// numeric parts and compared field by field.
// ---------------------------------------------------------------------------

const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

function parseVersion(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const match = VERSION_PATTERN.exec(value.trim());
  if (!match) {
    return null;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] === undefined ? [] : match[4].split('.'),
  };
}

function compareIdentifiers(left, right) {
  const leftIsNumeric = /^\d+$/.test(left);
  const rightIsNumeric = /^\d+$/.test(right);
  if (leftIsNumeric && rightIsNumeric) {
    const a = Number(left);
    const b = Number(right);
    if (a === b) {
      return 0;
    }
    return a < b ? -1 : 1;
  }
  if (leftIsNumeric) {
    return -1;
  }
  if (rightIsNumeric) {
    return 1;
  }
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function comparePrerelease(left, right) {
  if (left.length === 0 && right.length === 0) {
    return 0;
  }
  if (left.length === 0) {
    return 1;
  }
  if (right.length === 0) {
    return -1;
  }
  const shared = Math.min(left.length, right.length);
  for (let index = 0; index < shared; index += 1) {
    const outcome = compareIdentifiers(left[index], right[index]);
    if (outcome !== 0) {
      return outcome;
    }
  }
  if (left.length === right.length) {
    return 0;
  }
  return left.length < right.length ? -1 : 1;
}

// Returns -1, 0 or 1, and null when either side is not a parseable version.
function compareVersions(leftValue, rightValue) {
  const left = parseVersion(leftValue);
  const right = parseVersion(rightValue);
  if (left === null || right === null) {
    return null;
  }
  const fields = ['major', 'minor', 'patch'];
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    if (left[field] !== right[field]) {
      return left[field] < right[field] ? -1 : 1;
    }
  }
  return comparePrerelease(left.prerelease, right.prerelease);
}

function isGreaterThan(leftValue, rightValue) {
  return compareVersions(leftValue, rightValue) === 1;
}

// ---------------------------------------------------------------------------
// Cache. Lives under CLAUDE_PLUGIN_DATA. Holds the last known published
// version, when it was fetched, and which notices were already delivered.
// ---------------------------------------------------------------------------

function resolveCacheFile() {
  const dataDir = process.env.CLAUDE_PLUGIN_DATA;
  if (typeof dataDir !== 'string' || dataDir.trim() === '') {
    return null;
  }
  return path.join(dataDir, CACHE_FILE_NAME);
}

function readCache(cacheFile) {
  const raw = readJsonFile(cacheFile);
  return isPlainObject(raw) ? raw : {};
}

function isCacheFresh(cache) {
  const checkedAt = Date.parse(cache.checkedAt);
  if (Number.isNaN(checkedAt)) {
    return false;
  }
  const age = Date.now() - checkedAt;
  return age >= 0 && age < CACHE_MAX_AGE_MS;
}

// ---------------------------------------------------------------------------
// Refresh. Runs only in a detached child of this same script. The session
// never waits for it and never observes its outcome.
// ---------------------------------------------------------------------------

function spawnRefresh() {
  try {
    const child = childProcess.spawn(process.execPath, [__filename, '--refresh'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.on('error', () => {});
    child.unref();
  } catch (err) {
    // A refresh that cannot start simply leaves the cache stale.
  }
}

function extractPublishedVersion(manifest) {
  if (!isPlainObject(manifest)) {
    return null;
  }
  if (Array.isArray(manifest.plugins)) {
    for (let index = 0; index < manifest.plugins.length; index += 1) {
      const entry = manifest.plugins[index];
      if (isPlainObject(entry) && entry.name === PLUGIN_NAME && parseVersion(entry.version)) {
        return entry.version.trim();
      }
    }
  }
  if (isPlainObject(manifest.metadata) && parseVersion(manifest.metadata.version)) {
    return manifest.metadata.version.trim();
  }
  return null;
}

function fetchMarketplaceManifest(callback) {
  let settled = false;
  const settle = (value) => {
    if (settled) {
      return;
    }
    settled = true;
    callback(value);
  };

  let request;
  try {
    request = https.get(
      MARKETPLACE_URL,
      { headers: { 'user-agent': PLUGIN_NAME + '-version-check', accept: 'application/json' } },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          settle(null);
          return;
        }
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
          if (body.length > REFRESH_MAX_BYTES) {
            response.destroy();
            settle(null);
          }
        });
        response.on('end', () => {
          try {
            settle(JSON.parse(body));
          } catch (err) {
            settle(null);
          }
        });
        response.on('error', () => settle(null));
      }
    );
  } catch (err) {
    settle(null);
    return;
  }

  request.setTimeout(REFRESH_TIMEOUT_MS, () => {
    request.destroy();
    settle(null);
  });
  request.on('error', () => settle(null));
}

function runRefresh() {
  const cacheFile = resolveCacheFile();
  if (cacheFile === null) {
    silent();
    return;
  }
  fetchMarketplaceManifest((manifest) => {
    const latestVersion = extractPublishedVersion(manifest);
    if (latestVersion === null) {
      silent();
      return;
    }
    // Re-read so a throttle record written by the session is preserved.
    const cache = readCache(cacheFile);
    cache.latestVersion = latestVersion;
    cache.checkedAt = new Date().toISOString();
    writeJsonFile(cacheFile, cache);
    silent();
  });
}

// ---------------------------------------------------------------------------
// The notice. One message, whichever comparisons fired, written as an
// instruction to the model to relay the substance to the user.
// ---------------------------------------------------------------------------

const NOTICE_PREFIX =
  'MAJOR TOM VERSION NOTICE (relay this to the user at the start of your next reply, then carry on with what they asked): ';
const NOTICE_SUFFIX =
  ' Relay the substance in your own plain words rather than this text verbatim, and do not run any of these commands yourself.';

function composeNotice(state) {
  const parts = [];

  if (state.updateNotice && state.onboardNotice) {
    parts.push(
      'The major-tom plugin installed here is version ' +
        state.installedVersion +
        ', and version ' +
        state.latestVersion +
        ' is published in the marketplace. On top of that, the generated artifacts in this project were written by version ' +
        state.onboardedVersion +
        ', which is older than the installed plugin. Three things need to happen, in this order: (1) run `claude plugin update major-tom`; (2) restart Claude Code, the CLI states that a restart is required for an update to apply; (3) after the restart, run `/major-tom:onboard` again so this project\'s artifacts are regenerated by the new version.'
    );
  } else if (state.updateNotice) {
    parts.push(
      'The major-tom plugin installed here is version ' +
        state.installedVersion +
        ', and version ' +
        state.latestVersion +
        ' is published in the marketplace. Two things need to happen, in this order: (1) run `claude plugin update major-tom`; (2) restart Claude Code, the CLI states that a restart is required for an update to apply.'
    );
  } else if (state.onboardNotice) {
    parts.push(
      'The generated artifacts in this project were written by major-tom version ' +
        state.onboardedVersion +
        ', and the installed plugin is version ' +
        state.installedVersion +
        '. Run `/major-tom:onboard` again so this project\'s artifacts are regenerated by the installed version. The installed plugin itself is current, so there is nothing to update.'
    );
  }

  if (parts.length === 0) {
    return null;
  }
  return NOTICE_PREFIX + parts.join(' ') + NOTICE_SUFFIX;
}

// ---------------------------------------------------------------------------
// Hook entry point.
// ---------------------------------------------------------------------------

function drainStdin(callback) {
  let data = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    data += chunk;
  });
  process.stdin.on('end', () => {
    callback(data);
  });
  process.stdin.on('error', () => {
    callback(data);
  });
  process.stdin.resume();
}

function readOnboardedVersion(cwd) {
  if (typeof cwd !== 'string' || cwd.trim() === '') {
    return null;
  }
  const config = readJsonFile(path.join(cwd, '.claude', 'major-tom.json'));
  if (!isPlainObject(config) || !isPlainObject(config.onboard)) {
    return null;
  }
  return parseVersion(config.onboard.pluginVersion) ? config.onboard.pluginVersion.trim() : null;
}

function readInstalledVersion() {
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
  if (typeof pluginRoot !== 'string' || pluginRoot.trim() === '') {
    return null;
  }
  const manifest = readJsonFile(path.join(pluginRoot, '.claude-plugin', 'plugin.json'));
  if (!isPlainObject(manifest) || !parseVersion(manifest.version)) {
    return null;
  }
  return manifest.version.trim();
}

function runHook() {
  drainStdin((raw) => {
    let input;
    try {
      input = JSON.parse(raw);
    } catch (err) {
      input = {};
    }

    const cwd = typeof input.cwd === 'string' && input.cwd !== '' ? input.cwd : process.cwd();

    // A project without a readable config is either not onboarded or not ours.
    const onboardedVersion = readOnboardedVersion(cwd);
    if (onboardedVersion === null) {
      silent();
      return;
    }

    const installedVersion = readInstalledVersion();
    if (installedVersion === null) {
      silent();
      return;
    }

    // Without a cache file there is nowhere to record what was already said,
    // and this notice must not repeat every session. Stay quiet instead.
    const cacheFile = resolveCacheFile();
    if (cacheFile === null) {
      silent();
      return;
    }
    const cache = readCache(cacheFile);
    const notified = isPlainObject(cache.notified) ? cache.notified : {};

    const latestVersion = parseVersion(cache.latestVersion) ? cache.latestVersion.trim() : null;
    const cacheIsStale = !isCacheFresh(cache);

    const state = {
      installedVersion: installedVersion,
      onboardedVersion: onboardedVersion,
      latestVersion: latestVersion,
      onboardNotice: false,
      updateNotice: false,
    };

    // Each notice is keyed by the version pair it reports, so a user who
    // chooses not to act is told once per pair, not once per session. The
    // onboard pair is additionally keyed by project, because the cache is
    // shared across every project this plugin is installed in and one
    // project's notice must not silence another's.
    const onboardedProjects = isPlainObject(notified.onboard) ? notified.onboard : {};
    const projectKey = path.resolve(cwd);
    const onboardKey = installedVersion + ' over ' + onboardedVersion;
    const updateKey = latestVersion === null ? null : latestVersion + ' over ' + installedVersion;

    if (
      isGreaterThan(installedVersion, onboardedVersion) &&
      onboardedProjects[projectKey] !== onboardKey
    ) {
      state.onboardNotice = true;
    }
    if (
      updateKey !== null &&
      isGreaterThan(latestVersion, installedVersion) &&
      notified.update !== updateKey
    ) {
      state.updateNotice = true;
    }

    const notice = composeNotice(state);

    let emit = null;
    if (notice !== null) {
      const nextProjects = {};
      const knownProjects = Object.keys(onboardedProjects).filter(
        (key) => key !== projectKey && typeof onboardedProjects[key] === 'string'
      );
      // Oldest entries fall off first, so the record cannot grow without end.
      const kept = knownProjects.slice(Math.max(0, knownProjects.length - (MAX_REMEMBERED_PROJECTS - 1)));
      for (let index = 0; index < kept.length; index += 1) {
        nextProjects[kept[index]] = onboardedProjects[kept[index]];
      }
      if (state.onboardNotice) {
        nextProjects[projectKey] = onboardKey;
      } else if (typeof onboardedProjects[projectKey] === 'string') {
        nextProjects[projectKey] = onboardedProjects[projectKey];
      }

      const nextNotified = { onboard: nextProjects };
      if (typeof notified.update === 'string') {
        nextNotified.update = notified.update;
      }
      if (state.updateNotice) {
        nextNotified.update = updateKey;
      }
      cache.notified = nextNotified;
      // An unwritable cache would make this notice repeat every session, so
      // the notice is dropped rather than delivered without a throttle.
      if (writeJsonFile(cacheFile, cache)) {
        emit = notice;
      }
    }

    // Spawned last so it cannot race the throttle write above, and detached so
    // the session never waits on the network.
    if (cacheIsStale) {
      spawnRefresh();
    }

    if (emit !== null) {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'SessionStart',
            additionalContext: emit,
          },
        })
      );
    }
    process.exit(0);
  });
}

if (process.argv.indexOf('--refresh') !== -1) {
  runRefresh();
} else {
  runHook();
}
