#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');

// D51, gate the roots and release the leaves.
//
// A root is the point where work gets authorized: a workflow invocation, an agent
// launch, or a mutating tool call the main session issues itself. A leaf is anything
// that runs underneath an authorization that was already granted, which is every tool
// call made from inside an agent. Gating both gates one decision twice, and that is
// what made read-only calls inside sub-agents fail while the workflow that spawned
// them ran ungated (D51 defects 2 and 3).
//
// Tools gated here. The matcher in hooks.json must stay in sync with this set.
const GATED_TOOLS = ['Bash', 'Edit', 'Write', 'Agent', 'Workflow', 'Skill'];

// Skill is gated, deliberately, and the `think` skill is exempted by name.
//
// Why gate it at all: a Skill call whose name is `<plugin>:<workflow>` is an
// alternative route into the same workflow execution as the Workflow tool (probe
// finding, D51), and nothing in the payload distinguishes that call from an ordinary
// skill invocation. Leaving Skill out would leave the root of defect 3 open through a
// second door while the Workflow door is shut.
//
// Why the exemption is required: the block message tells the user to invoke `think`,
// and `think` is what records the intent. Gating it would rebuild the bootstrap
// deadlock OQ-15 records for the recorder's own Bash call. The exemption is by skill
// name, matched on the segment after the plugin prefix, so both `major-tom:think` and
// a bare `think` always pass.
const THINK_SKILL_NAME = 'think';

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

// The exemption must accept exactly one command, the recorder script with its arguments,
// and refuse anything chained, substituted or redirected onto it. The first version
// rejected on a flat character scan, which also rejected the metacharacters that appear
// inside the quoted `--summary` argument: a live run refused the recorder because the
// summary quoted a shell command containing `&&` (D51). That turned the one guaranteed
// escape path into a coin flip, so the scan is now quote-aware and rejects a
// metacharacter only where the shell would actually act on it.
//
// Inside single quotes nothing is active. Inside double quotes the shell still runs
// command substitution, so backticks and `$(` stay unsafe there while `;`, `&`, `|`,
// `<`, `>` and a newline do not. An unterminated quote is refused: the command is
// malformed and its real parse is not knowable here.
function hasActiveShellMetacharacter(text) {
  let state = 'plain';

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (state === 'plain') {
      if (ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === "'") {
        state = 'single';
        continue;
      }
      if (ch === '"') {
        state = 'double';
        continue;
      }
      if (ch === '`' || ch === ';' || ch === '&' || ch === '|' || ch === '<' || ch === '>' || ch === '\n') {
        return true;
      }
      if (ch === '$' && text[i + 1] === '(') {
        return true;
      }
      continue;
    }

    if (state === 'single') {
      if (ch === "'") {
        state = 'plain';
      }
      continue;
    }

    // Double quoted.
    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (ch === '"') {
      state = 'plain';
      continue;
    }
    if (ch === '`') {
      return true;
    }
    if (ch === '$' && text[i + 1] === '(') {
      return true;
    }
  }

  return state !== 'plain';
}

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

  return !hasActiveShellMetacharacter(remainder);
}

// A Skill call carries `tool_input.skill`, a Workflow call carries `tool_input.name`
// (probe finding, D51). Both keys are read here so the exemption holds whichever
// route the model takes to the `think` skill.
function invokedName(toolInput) {
  if (!toolInput || typeof toolInput !== 'object') {
    return '';
  }
  const raw = toolInput.skill || toolInput.name;
  return typeof raw === 'string' ? raw.trim() : '';
}

function isThinkSkill(toolInput) {
  const name = invokedName(toolInput);
  if (!name) {
    return false;
  }
  const segments = name.split(':');
  return segments[segments.length - 1] === THINK_SKILL_NAME;
}

// Defect 1: the session record was resolved from the payload's `cwd` alone, which
// follows the shell. A Bash call that did `cd` into a subdirectory moved the lookup
// away from the record, so every later call was blocked, including the `cd` that would
// undo it. `CLAUDE_PROJECT_DIR` is present in the hook's environment and stays pinned
// to the project directory across a `cd` (probe finding, D51), so it is the anchor.
//
// Both locations are checked, not just the anchor, because the recorder script writes
// its record relative to its own `process.cwd()`. If the shell had already moved when
// the intent was recorded, the record sits under the payload `cwd` instead. Reading
// both accepts either without loosening what counts as a valid record.
function candidateRoots(payloadCwd) {
  const roots = [];
  const projectDir = process.env.CLAUDE_PROJECT_DIR;

  if (typeof projectDir === 'string' && projectDir.trim() !== '') {
    roots.push(path.resolve(projectDir.trim()));
  }
  if (typeof payloadCwd === 'string' && payloadCwd.trim() !== '') {
    const resolved = path.resolve(payloadCwd.trim());
    if (roots.indexOf(resolved) === -1) {
      roots.push(resolved);
    }
  }
  if (roots.length === 0) {
    roots.push(path.resolve(process.cwd()));
  }

  return roots;
}

function readRecord(root, sessionId) {
  const sessionFile = path.join(root, '.claude', 'session', sessionId + '.json');
  if (!fs.existsSync(sessionFile)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
  } catch (err) {
    return null;
  }
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
  const toolInput = input.tool_input || {};

  // Leaf release. A sub-agent's tool calls carry `agent_id` and `agent_type`, which
  // main-session calls do not (probe finding, D51). The presence of `agent_id` means
  // this call runs under an agent whose own launch went through this gate, so the
  // authorization is already recorded and re-asking for it here is what silently
  // degraded the onboard's check agent into inferring results it could not verify.
  const agentId = input.agent_id;
  if (typeof agentId === 'string' && agentId.trim() !== '') {
    process.exit(0);
    return;
  }

  if (GATED_TOOLS.indexOf(toolName) === -1) {
    process.exit(0);
    return;
  }

  // The two unconditional escape paths, both of which must stay open at all times:
  // invoking the `think` skill, and the one Bash command that skill runs to record the
  // intent. Together they guarantee that a blocked session always has a way out from
  // inside the session, which is what defect 1 lacked.
  if (toolName === 'Skill' && isThinkSkill(toolInput)) {
    process.exit(0);
    return;
  }

  if (toolName === 'Bash' && isExemptRecorderInvocation(toolInput.command, resolveRecorderScriptPath())) {
    process.exit(0);
    return;
  }

  const gateInstruction =
    'Invoke the `think` skill before proceeding with this ' +
    toolName +
    ' call. The skill records an intent for the current prompt before mutating anything. ' +
    'The `think` skill and its recorder command are never blocked, so this is always ' +
    'possible from inside the current session.';

  // Fail closed on missing information, deliberately (D51). A gate that passes when it
  // cannot find what it is checking is not a gate, and every missing-information case
  // here is recoverable without leaving the session, because the two escape paths above
  // are exempted before any of these checks run.
  if (!sessionId) {
    block('Blocked: no session_id was available to check for a recorded intent. ' + gateInstruction);
    return;
  }

  const roots = candidateRoots(input.cwd);

  let sawRecord = false;
  let sawStale = false;

  for (let i = 0; i < roots.length; i += 1) {
    const record = readRecord(roots[i], sessionId);
    if (!record) {
      continue;
    }
    sawRecord = true;
    if (record.promptId !== promptId) {
      sawStale = true;
      continue;
    }
    if (record.intentRecorded !== true) {
      continue;
    }
    process.exit(0);
    return;
  }

  if (!sawRecord) {
    block('Blocked: no intent record exists yet for this session. ' + gateInstruction);
    return;
  }

  if (sawStale) {
    block(
      'Blocked: the recorded intent is stale, it belongs to a different prompt than the current one. ' +
        gateInstruction
    );
    return;
  }

  block('Blocked: the intent record for this prompt is not marked recorded. ' + gateInstruction);
});
