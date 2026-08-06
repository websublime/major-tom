#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');

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

function block(message) {
  process.stderr.write(message + '\n');
  process.exit(2);
}

function resolveRecorderScriptPath() {
  const expected = path.join(__dirname, '..', 'skills', 'think', 'scripts', 'record-intent.js');
  try {
    return fs.realpathSync(expected);
  } catch (err) {
    return path.resolve(expected);
  }
}

const FORBIDDEN_CHAIN_PATTERN = /[;&|`\n]|\$\(/;

function isExemptRecorderInvocation(command, recorderScriptPath) {
  if (typeof command !== 'string') {
    return false;
  }

  const trimmed = command.trim();

  let remainder = null;
  const withNodePrefix = 'node ' + recorderScriptPath;
  if (trimmed.startsWith(withNodePrefix)) {
    remainder = trimmed.slice(withNodePrefix.length);
  } else if (trimmed.startsWith(recorderScriptPath)) {
    remainder = trimmed.slice(recorderScriptPath.length);
  }

  if (remainder === null) {
    return false;
  }

  return !FORBIDDEN_CHAIN_PATTERN.test(remainder);
}

drainStdin((raw) => {
  let input;
  try {
    input = JSON.parse(raw);
  } catch (err) {
    input = {};
  }

  const sessionId = input.session_id;
  const promptId = input.prompt_id;
  const toolName = input.tool_name || 'this tool';
  const cwd = input.cwd || process.cwd();
  const toolInput = input.tool_input || {};

  const gateInstruction =
    'Invoke the `think` skill before proceeding with this ' +
    toolName +
    ' call. The skill records an intent for the current prompt before mutating anything.';

  if (toolName === 'Bash' && isExemptRecorderInvocation(toolInput.command, resolveRecorderScriptPath())) {
    process.exit(0);
    return;
  }

  if (!sessionId) {
    block('Blocked: no session_id was available to check for a recorded intent. ' + gateInstruction);
    return;
  }

  const sessionFile = path.join(cwd, '.claude', 'session', sessionId + '.json');

  let record = null;
  if (fs.existsSync(sessionFile)) {
    try {
      record = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
    } catch (err) {
      record = null;
    }
  }

  if (!record) {
    block('Blocked: no intent record exists yet for this session. ' + gateInstruction);
    return;
  }

  if (record.promptId !== promptId) {
    block(
      'Blocked: the recorded intent is stale, it belongs to a different prompt than the current one. ' +
        gateInstruction
    );
    return;
  }

  if (record.intentRecorded !== true) {
    block('Blocked: the intent record for this prompt is not marked recorded. ' + gateInstruction);
    return;
  }

  process.exit(0);
});
