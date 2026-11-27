// Tests for "apostil read-hook": what the PreToolUse hook of Claude Code (matcher Bash) prints before a command, as the CLI runs it with the JSON on standard input.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { test } from 'node:test';
import { READ_HOOK_ALLOW, readHookCommand } from './read-hook';

const input = (command: unknown, tool = 'Bash'): string => JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: { command } });

test('apostil read-hook: the JSON that allows a Bash command that only reads; nothing for another command, another tool or bad input', () => {
  const allowed = readHookCommand(input('for d in a b; do echo "== $d"; ls "$d" | head -3; done'));
  assert.deepEqual(JSON.parse(allowed ?? 'null'), { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', permissionDecisionReason: 'Apostil: the command only reads files' } });
  assert.equal(allowed, JSON.stringify(READ_HOOK_ALLOW));
  for (const nothing of [input('rm -rf x'), input('ls > out.txt'), input('ls', 'Edit'), input(42), '{"tool_name":"Bash"}', '', 'not json', '{', 'null', '[]', '"ls"']) {
    assert.equal(readHookCommand(nothing), undefined, nothing);
  }
});

test('apostil read-hook: the command prints the JSON for a command that reads, nothing for another, and ends with code 0', () => {
  const run = (stdin: string) => spawnSync(process.execPath, [join(__dirname, 'cli.js'), 'read-hook'], { input: stdin, encoding: 'utf8' });
  const reads = run(input('git log --oneline | head -3'));
  assert.equal(reads.status, 0);
  assert.equal(reads.stdout.trim(), JSON.stringify(READ_HOOK_ALLOW));
  const writes = run(input('git push'));
  assert.equal(writes.status, 0);
  assert.equal(writes.stdout, '');
});
