#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');

const VALID_TIERS = ['trivial', 'task', 'substantive'];

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--session') {
      args.session = argv[i + 1];
      i += 1;
    } else if (token === '--prompt') {
      args.prompt = argv[i + 1];
      i += 1;
    } else if (token === '--tier') {
      args.tier = argv[i + 1];
      i += 1;
    } else if (token === '--type') {
      args.type = argv[i + 1];
      i += 1;
    } else if (token === '--summary') {
      args.summary = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

function fail(message) {
  process.stderr.write(message + '\n');
  process.exit(1);
}

function slugify(text) {
  const slug = String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return slug || 'intent';
}

function filesystemSafeTimestamp(date) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

// Column order: timestamp, tier, type, promptId, summary.
function appendIntentLog(root, timestamp, tier, type, promptId, summary) {
  const runsDir = path.join(root, '.knowledge', 'runs');
  ensureDir(runsDir);
  const logPath = path.join(runsDir, 'intents.log');
  const line = [timestamp, tier, type, promptId, summary].join('\t') + '\n';
  fs.appendFileSync(logPath, line, 'utf8');
  return logPath;
}

function writeIntentConcept(root, timestamp, tier, type, promptId, summary) {
  const intentsDir = path.join(root, '.knowledge', 'runs', 'intents');
  ensureDir(intentsDir);

  const fsTimestamp = filesystemSafeTimestamp(new Date(timestamp));
  const slug = slugify(summary);
  const fileName = fsTimestamp + '-' + slug + '.md';
  const filePath = path.join(intentsDir, fileName);
  const relativePath = 'runs/intents/' + fileName;

  const frontmatterLines = ['---', 'type: intent'];
  if (promptId) {
    frontmatterLines.push('prompt_id: ' + promptId);
  }
  frontmatterLines.push('tier: ' + tier);
  frontmatterLines.push('request_type: ' + type);
  frontmatterLines.push('recorded_at: ' + timestamp);
  frontmatterLines.push('---');

  const content = frontmatterLines.join('\n') + '\n\n' + summary + '\n';
  fs.writeFileSync(filePath, content, 'utf8');

  appendIndexLine(root, relativePath, tier, promptId, summary);

  return filePath;
}

function appendIndexLine(root, relativePath, tier, promptId, summary) {
  const knowledgeDir = path.join(root, '.knowledge');
  ensureDir(knowledgeDir);
  const indexPath = path.join(knowledgeDir, 'index.md');

  const indexLine =
    '- ' + relativePath + ' type=intent prompt_id=' + (promptId || '') + ' summary="' + summary + '"';

  if (!fs.existsSync(indexPath)) {
    const content = ['---', 'okf_version: 0.2', '---', '', '## runs', '', indexLine, ''].join('\n');
    fs.writeFileSync(indexPath, content, 'utf8');
    return;
  }

  const existing = fs.readFileSync(indexPath, 'utf8');
  const lines = existing.split('\n');

  const runsHeadingIndex = lines.findIndex((line) => line.trim() === '## runs');

  if (runsHeadingIndex === -1) {
    const trimmed = existing.replace(/\n+$/, '');
    const updated = trimmed + '\n\n## runs\n\n' + indexLine + '\n';
    fs.writeFileSync(indexPath, updated, 'utf8');
    return;
  }

  let insertAt = lines.length;
  for (let i = runsHeadingIndex + 1; i < lines.length; i += 1) {
    if (lines[i].trim().startsWith('## ')) {
      insertAt = i;
      break;
    }
  }

  while (insertAt > runsHeadingIndex + 1 && lines[insertAt - 1].trim() === '') {
    insertAt -= 1;
  }

  lines.splice(insertAt, 0, indexLine);
  fs.writeFileSync(indexPath, lines.join('\n'), 'utf8');
}

function writeSessionRecord(root, sessionId, promptId, tier, type, timestamp) {
  const sessionDir = path.join(root, '.claude', 'session');
  ensureDir(sessionDir);
  const sessionPath = path.join(sessionDir, sessionId + '.json');
  const record = {
    promptId: promptId,
    intentRecorded: true,
    tier: tier,
    type: type,
    recordedAt: timestamp,
  };
  fs.writeFileSync(sessionPath, JSON.stringify(record), 'utf8');
  return sessionPath;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.session) {
    fail('Missing required --session <id>');
  }
  if (args.prompt === undefined) {
    fail('Missing required --prompt <id>');
  }
  if (!args.tier || VALID_TIERS.indexOf(args.tier) === -1) {
    fail('Missing or invalid --tier, must be one of: ' + VALID_TIERS.join(', '));
  }
  if (!args.type) {
    fail('Missing required --type <value> (a free-form, non-empty string)');
  }
  if (!args.summary) {
    fail('Missing required --summary "<text>"');
  }

  const root = process.cwd();
  const timestamp = new Date().toISOString();

  if (args.tier === 'trivial' || args.tier === 'task') {
    appendIntentLog(root, timestamp, args.tier, args.type, args.prompt, args.summary);
  } else {
    writeIntentConcept(root, timestamp, args.tier, args.type, args.prompt, args.summary);
  }

  writeSessionRecord(root, args.session, args.prompt, args.tier, args.type, timestamp);

  process.exit(0);
}

main();
