// Tests for "apostil pr-hook": what the PostToolUse hook of Claude Code (matcher Bash) prints after a command, as the CLI runs it with the JSON on standard input.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { test } from 'node:test';
import { setLinks } from '../shared/apostil-link';
import { tempFolder } from '../shared/test-repo';
import { prHookCommand, prHookText } from './pr-hook';

const URL = 'https://github.com/made-up/library/pull/42';
const input = (command: string, response: unknown): string => JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command }, tool_response: response });
const opened = input('gh pr create --title "Reminders" --body "Adds reminders"', { stdout: `Creating pull request for made-up/reminders into main\n${URL}\n`, stderr: '', interrupted: false });

test('apostil pr-hook: after a gh pr create that printed a pull request address, the JSON that PostToolUse reads with the number; nothing after a failed one, another command, bad JSON or with the links off', () => {
  const store = tempFolder('apostil-store-');
  const said = JSON.parse(prHookCommand(opened, {}, store) ?? 'null');
  assert.deepEqual(said, { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: prHookText('42') } });
  assert.equal(said.hookSpecificOutput.additionalContext, 'You opened pull request #42. Describe it now with the skill apostil-describe-change, as that skill says, before you end the turn. Its writer and checker subagents run on Haiku at xhigh effort.');
  // The response as a plain string, and the command inside a longer one.
  assert.match(prHookCommand(input('git push -u origin HEAD && gh pr create --fill', URL), {}, store) ?? '', /pull request #42\./);

  const failed = input('gh pr create --fill', { stdout: '', stderr: `a pull request for branch "made-up/reminders" into branch "main" already exists:\n${URL}\n`, interrupted: false });
  const nothing = [
    failed, // the address is only in the error
    input('gh pr create --fill', { stdout: '', stderr: 'gh: not logged in', interrupted: false }),
    input('gh pr view 42', { stdout: URL, stderr: '' }), // another command
    input('echo gh pr create', { stdout: 'no address here' }),
    JSON.stringify({ tool_name: 'Edit', tool_input: { command: 'gh pr create' }, tool_response: { stdout: URL } }), // another tool
    '', 'not json', '{', 'null', '[]', '"gh pr create"', // bad input
  ];
  for (const one of nothing) assert.equal(prHookCommand(one, {}, store), undefined, one);

  assert.equal(prHookCommand(opened, { APOSTIL_NO_LINKS: '1' }, store), undefined); // the links and nudges are off
  setLinks(false, store);
  assert.equal(prHookCommand(opened, {}, store), undefined);
  setLinks(true, store);
  assert.ok(prHookCommand(opened, {}, store));
});

test('the command apostil pr-hook ends with code 0 and prints the JSON or nothing, also with no input at all', () => {
  const home = tempFolder('apostil-store-');
  const run = (stdin: string) => spawnSync(process.execPath, [join(__dirname, 'cli.js'), 'pr-hook'], { input: stdin, encoding: 'utf8', env: { ...process.env, APOSTIL_HOME: home }, timeout: 10_000 });
  const done = run(opened);
  assert.deepEqual([done.status, done.stderr], [0, '']);
  assert.equal(JSON.parse(done.stdout).hookSpecificOutput.hookEventName, 'PostToolUse');
  for (const bad of ['', 'not json', input('ls', { stdout: 'a' })]) assert.deepEqual([run(bad).status, run(bad).stdout], [0, ''], bad);
});
