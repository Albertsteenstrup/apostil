// Tests for the run of a comment: a run that ends with no answer gives the comment back.

import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkChangeFile } from '../shared/checks';
import { baseOf, currentBranch, headCommit, repoId } from '../shared/git';
import { Store } from '../shared/store';
import { makeTestRepo, tempFolder, testChangeFile } from '../shared/test-repo';
import { sentRemarks } from '../store/inbox';
import { startRun } from './agent-run';

test('a run of the session of a change keeps the permission mode that the person set as default for Claude Code; when it ends with no answer, the comment is open again and the reason says so', async () => {
  const repo = makeTestRepo();
  const home = tempFolder('apostil-home-');
  const bin = tempFolder('apostil-bin-');
  const got = join(bin, 'arguments.txt');
  writeFileSync(join(bin, 'claude'), `#!/bin/sh\nprintf '%s\\n' "$@" > '${got}'\nexit 0\n`); // a stand-in that keeps its arguments and answers nothing
  chmodSync(join(bin, 'claude'), 0o755);
  const kept = { PATH: process.env.PATH, APOSTIL_HOME: process.env.APOSTIL_HOME };
  Object.assign(process.env, { PATH: `${bin}:${kept.PATH}`, APOSTIL_HOME: home });
  const store = new Store(home);
  try {
    // The person set auto mode as the default of Claude Code for this repo: the run keeps it.
    mkdirSync(join(repo.folder, '.claude'));
    writeFileSync(join(repo.folder, '.claude', 'settings.local.json'), JSON.stringify({ permissions: { defaultMode: 'auto' } }));
    const base = baseOf(repo.folder, currentBranch(repo.folder));
    const change = store.saveChange({ repoId: repoId(repo.folder), folder: repo.folder, branch: currentBranch(repo.folder), base, head: headCommit(repo.folder), file: testChangeFile(), checks: checkChangeFile(repo.folder, base, testChangeFile()), agent: { app: 'claude-code', session: 'stand-in-session' } });
    const remark = store.addRemark(change, { kind: 'part', part: 'app', label: 'Part "App"' }, 'This run ends with no answer.');
    store.sendRemark(remark);
    const said = await new Promise<string | undefined>((done) => {
      startRun(store, remark, done);
      assert.equal(store.getRemark(remark)?.state, 'running');
    });
    assert.equal(said, 'claude ended with no answer.');
    assert.match(readFileSync(got, 'utf8'), /^-p\n--resume\nstand-in-session\n[^]*\n--permission-mode\nauto\n/); // the session of the change, and the mode of the person
    assert.equal(store.getRemark(remark)?.state, 'open');
  } finally {
    store.close();
    Object.assign(process.env, kept);
    if (kept.APOSTIL_HOME === undefined) delete process.env.APOSTIL_HOME;
    repo.remove();
  }
});

test('a comment sent to another session that Apostil knows in the repo continues that session, not the session of the change, with the effort of the picker and its own model; the run keeps it, and the inbox of the session of the change leaves the comment out', async () => {
  const repo = makeTestRepo();
  const home = tempFolder('apostil-home-');
  const bin = tempFolder('apostil-bin-');
  const got = join(bin, 'arguments.txt');
  // A stand-in claude that keeps its arguments and answers as a session does.
  writeFileSync(join(bin, 'claude'), `#!/bin/sh\nprintf '%s\\n' "$@" > '${got}'\necho '{"type":"result","is_error":false,"result":"Done","session_id":"made-up-known-0002"}'\n`);
  chmodSync(join(bin, 'claude'), 0o755);
  const kept = { PATH: process.env.PATH, APOSTIL_HOME: process.env.APOSTIL_HOME };
  Object.assign(process.env, { PATH: `${bin}:${kept.PATH}`, APOSTIL_HOME: home });
  const store = new Store(home);
  try {
    const base = baseOf(repo.folder, currentBranch(repo.folder));
    const change = store.saveChange({ repoId: repoId(repo.folder), folder: repo.folder, branch: currentBranch(repo.folder), base, head: headCommit(repo.folder), file: testChangeFile(), checks: checkChangeFile(repo.folder, base, testChangeFile()), agent: { app: 'claude-code', session: 'made-up-change-0001' } });
    const remark = store.addRemark(change, { kind: 'part', part: 'app', label: 'Part "App"' }, 'Is the empty list tested?');
    store.sendRemark(remark, { app: 'claude-code', kind: 'session', session: 'made-up-known-0002', name: 'Tests for holds', effort: 'xhigh' });
    assert.deepEqual(sentRemarks(store, 'made-up-change-0001', repo.folder), []); // the session of the change does not take it
    await new Promise<string | undefined>((done) => {
      startRun(store, remark, done);
      assert.equal(store.getRemark(remark)?.run?.session, 'made-up-known-0002'); // the run works in that session
    });
    const args = readFileSync(got, 'utf8').split('\n');
    assert.deepEqual(args.slice(0, 3), ['-p', '--resume', 'made-up-known-0002']);
    assert.equal(args.includes('--model'), false); // a continued session keeps its own model: he did not choose another
    assert.equal(args[args.indexOf('--effort') + 1], 'xhigh'); // the effort that the picker sent
  } finally {
    store.close();
    Object.assign(process.env, kept);
    if (kept.APOSTIL_HOME === undefined) delete process.env.APOSTIL_HOME;
    repo.remove();
  }
});
