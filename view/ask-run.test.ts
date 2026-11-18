// Tests for the run of words for an agent: what the run gets, and a run that was not allowed a command.

import assert from 'node:assert/strict';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { describeWords } from '../shared/ask';
import { Store } from '../shared/store';
import { makeTestRepo, tempFolder } from '../shared/test-repo';
import { askView, startAsk } from './ask-run';

test('the press starts a new session with the words, its id known at once and the small model; a run that was not allowed a command stopped, and the press is there again', async () => {
  const repo = makeTestRepo();
  const home = tempFolder('apostil-home-');
  const bin = tempFolder('apostil-bin-');
  const got = join(bin, 'arguments.txt');
  // A stand-in claude that keeps its arguments and says that it ended well, with a command that it was not allowed to run.
  writeFileSync(join(bin, 'claude'), `#!/bin/sh\nprintf '%s\\n' "$@" > '${got}'\necho '{"type":"result","is_error":false,"result":"Done","permission_denials":[{"tool_name":"Bash","tool_input":{"command":"gh pr checkout 35"}}]}'\n`);
  chmodSync(join(bin, 'claude'), 0o755);
  const kept = { PATH: process.env.PATH, APOSTIL_HOME: process.env.APOSTIL_HOME };
  Object.assign(process.env, { PATH: `${bin}:${kept.PATH}`, APOSTIL_HOME: home });
  const store = new Store(home);
  const words = describeWords(35);
  try {
    assert.equal(askView(store, repo.folder, words, ['claude-code']).press?.label, 'Describe it with a new Claude Code session');
    const ended = await new Promise<{ problem?: string; denied?: string[] }>((done) => {
      assert.equal(startAsk(store, repo.folder, words, ['claude-code'], { claude: 'haiku' }, () => {}, (problem, facts) => done({ problem, denied: facts?.denied })), true);
      assert.equal(askView(store, repo.folder, words, ['claude-code']).line?.state, 'working');
    });
    const args = readFileSync(got, 'utf8').split('\n');
    const view = askView(store, repo.folder, words, ['claude-code']);
    assert.deepEqual(args.slice(0, 2), ['-p', words]);
    assert.equal(args[args.indexOf('--session-id') + 1], view.line?.tip?.replace('Session ', '')); // the link of the session is there before the run ends
    assert.equal(args[args.indexOf('--model') + 1], 'haiku');
    assert.deepEqual(ended, { problem: 'It ended before it was done.', denied: ['Bash(gh pr *)'] });
    assert.equal(view.line?.state, 'stopped');
    assert.equal(view.press?.label, 'Describe it with a new Claude Code session'); // the session of a run that stopped is not asked again
  } finally {
    store.close();
    Object.assign(process.env, kept);
    if (kept.APOSTIL_HOME === undefined) delete process.env.APOSTIL_HOME;
    repo.remove();
  }
});
