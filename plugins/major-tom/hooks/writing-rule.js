#!/usr/bin/env node

'use strict';

const WRITING_RULE = 'WRITING RULE (read before composing a reply): Write in plain, clear language. Every word must be literally TRUE: no metaphors, no figurative or vivid phrasing, no cleverness. Name things by what they DO, not by project code; put codes (H-5, D-061, P-24) in parentheses after a plain description. Tables and bulleted lists are fine and welcome: the requirement is clarity of language, not absence of structure. Default to short. If a result is uncertain or its evidence was compromised, say so first rather than after. END EVERY RESPONSE with a clear statement of what is happening now, what you need from the operator, or what happens next. STATUS REPORTS rebuild context from zero: the operator reads between other work and has NOT memorized the conversation. Name every file by filename plus a plain description of what it is, say what each change DOES, and never write phrases like the fix, the changes, the six files, the catch-all branch, or any shorthand coined earlier as if it were shared vocabulary. Structure long reports as: what happened, what we are doing, what happens next. SCOPE: this governs what you write to the operator in conversation.';

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

drainStdin((raw) => {
  let input;
  try {
    input = JSON.parse(raw);
  } catch (err) {
    input = {};
  }

  const sessionId = input.session_id;
  const promptId = input.prompt_id;

  const sessionContextParts = ['session_id=' + sessionId];
  if (promptId !== undefined && promptId !== null && promptId !== '') {
    sessionContextParts.push('prompt_id=' + promptId);
  }
  const sessionContext = '[SESSION CONTEXT] ' + sessionContextParts.join(' ');

  const output = {
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: WRITING_RULE + '\n\n' + sessionContext,
    },
  };
  process.stdout.write(JSON.stringify(output));
  process.exit(0);
});
