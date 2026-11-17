// Tests for the states of a remark, its thread, the inbox and the open command.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { reviewContext } from '../shared/context';
import { Store, threadsOf } from '../shared/store';
import { makeTestRepo, runApostil, tempFolder, testChangeFile } from '../shared/test-repo';
import { runHasNoPerson, sentRemarks, waitForRemarks } from './inbox';
import { openCommand } from './open-in-app';
import { saveDraft } from './save';

const target = { kind: 'part', part: 'app', label: 'Part "App"' } as const;

test('a remark walks through its states, the context leaves out done and closed, a run keeps its session, and a running remark whose process is gone is stale', () => {
  const store = new Store(tempFolder('apostil-home-'));
  const repo = makeTestRepo();
  const { changeId } = saveDraft(store, repo.folder, testChangeFile());
  const [one, two, three] = [1, 2, 3].map((n) => store.addRemark(changeId!, target, `Remark ${n}`));
  const state = (id: number) => store.remarks(changeId!).find((remark) => remark.id === id)!;
  assert.equal(state(one).state, 'open');
  store.sendRemark(one, { app: 'claude-code', kind: 'current' });
  assert.deepEqual([state(one).state, state(one).to], ['sent', { app: 'claude-code', kind: 'current' }]);
  store.startRemarkRun(one, { pid: 1, startedAt: 'now' });
  assert.deepEqual([state(one).state, state(one).run?.pid], ['running', 1]);
  store.reopenRemark(one);
  assert.deepEqual([state(one).state, state(one).run], ['open', undefined]);
  assert.equal(store.answerRemark(two, 'Done it.')?.state, 'done');
  assert.equal(state(two).answer, 'Done it.');
  assert.equal(store.answerRemark(999, 'x'), undefined);
  store.closeRemark(three);
  assert.deepEqual(store.remarks(changeId!, true).map((remark) => remark.id), [one, two]); // closed is not unsent
  assert.deepEqual(reviewContext(store, repo.folder).remarks.map((remark) => [remark.id, remark.state]), [[one, 'open']]);

  // A run keeps its session on the remark, also after the run ended; a remark with no run yet gets one for it.
  const ran = store.addRemark(changeId!, target, 'Look at it. @claude-new');
  store.startRemarkRun(ran, { pid: 1, startedAt: 'x' });
  store.setRunSession(ran, 'run-7');
  store.answerRemark(ran, 'Done.');
  assert.deepEqual(state(ran).run, { pid: 1, startedAt: 'x', session: 'run-7' });
  const other = store.addRemark(changeId!, target, 'A remark with no run yet.');
  store.setRunSession(other, 'run-8');
  assert.equal(state(other).run?.session, 'run-8');

  // staleRuns finds a running remark whose process is gone.
  const alive = store.addRemark(changeId!, target, 'Alive');
  const gone = store.addRemark(changeId!, target, 'Gone');
  const ended = spawnSync('true'); // a process that has ended
  store.startRemarkRun(alive, { pid: process.pid, startedAt: 'now' });
  store.startRemarkRun(gone, { pid: ended.pid, startedAt: 'now' });
  assert.deepEqual(store.staleRuns(changeId!).map((remark) => remark.id), [gone]);
  store.close();
  repo.remove();
});

test('a thread groups its remarks in order, Resolve and Reopen move the whole thread, and a reply is sent to the agent with the earlier comments and answers of its thread', async () => {
  const store = new Store(tempFolder('apostil-home-'));
  const repo = makeTestRepo();
  const { changeId } = saveDraft(store, repo.folder, testChangeFile(), { app: 'claude-code', session: 's1' });
  const first = store.addRemark(changeId!, target, 'First');
  const other = store.addRemark(changeId!, target, 'Other');
  const reply = store.addRemark(changeId!, target, 'Reply to first', first);
  const texts = (threads: { text: string }[][]) => threads.map((thread) => thread.map((remark) => remark.text));
  assert.deepEqual(texts(threadsOf(store.remarks(changeId!))), [['First', 'Reply to first'], ['Other']]);
  assert.deepEqual(store.threadOf(reply).map((remark) => remark.id), [first, reply]);
  store.answerRemark(first, 'Answered.');
  store.closeThread(reply);
  assert.deepEqual(store.threadOf(first).map((remark) => remark.state), ['closed', 'closed']);
  assert.equal(store.remarks(changeId!).find((remark) => remark.id === other)?.state, 'open');
  store.reopenThread(first);
  assert.deepEqual(store.threadOf(first).map((remark) => remark.state), ['done', 'open']); // the answered remark is done again

  const asked = store.addRemark(changeId!, target, 'Is the card tested?');
  store.answerRemark(asked, 'Added a test for a full list.');
  const again = store.addRemark(changeId!, target, 'And for an empty list?', asked);
  store.closeThread(first);
  store.closeRemark(other);
  store.sendRemark(again);
  const woken = await waitForRemarks(store, { session: 's1', folder: repo.folder, pid: 4444, timeoutSeconds: 0, now: () => 0, sleep: async () => {} });
  assert.equal(woken.code, 2);
  assert.match(woken.text!, new RegExp(`- remark ${again} \\(part app\\): And for an empty list\\?\n  earlier in this thread:\n  owner: Is the card tested\\?\n  agent: Added a test for a full list\\.`));
  store.reopenRemark(again);
  const [inContext] = reviewContext(store, repo.folder).remarks;
  assert.deepEqual([inContext.id, inContext.earlier], [again, [{ from: 'owner', text: 'Is the card tested?' }, { from: 'agent', text: 'Added a test for a full list.' }]]);
  store.close();
  repo.remove();
});

test('answer, remarks and resolve work through the command line, an unknown id gives exit code 1, and the inbox reads the hook JSON from standard input', () => {
  const repo = makeTestRepo();
  const home = tempFolder('apostil-home-');
  const apostil = (...args: string[]) => runApostil([...args, '--folder', repo.folder], { env: { APOSTIL_HOME: home, CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 's9' } });
  const draft = join(tempFolder('apostil-draft-'), 'draft.json');
  writeFileSync(draft, JSON.stringify(testChangeFile()));
  const saved = JSON.parse(apostil('save', draft).stdout);
  const store = new Store(home);
  const id = store.addRemark(saved.changeId, target, 'Why return 0?');
  assert.equal(store.getChange(saved.changeId)?.agent?.session, 's9'); // the save took the agent from the environment

  const context = JSON.parse(apostil('context').stdout);
  assert.deepEqual([context.remarks[0].id, context.remarks[0].state], [id, 'open']);
  const answered = apostil('answer', String(id), 'Returns', '0 on purpose.');
  assert.equal(answered.status, 0);
  assert.equal(JSON.parse(answered.stdout).answer, 'Returns 0 on purpose.');
  const listed = JSON.parse(apostil('remarks').stdout);
  assert.deepEqual([listed[0].state, listed[0].answer], ['done', 'Returns 0 on purpose.']);
  assert.equal(JSON.parse(apostil('context').stdout).remarks.length, 0);
  assert.equal(apostil('answer', '999', 'x').status, 1);

  // resolve closes the thread and stores who closed it; Reopen clears it; the owner who resolves is no agent.
  const first = store.addRemark(saved.changeId, target, 'Return 1.');
  const reply = store.addRemark(saved.changeId, target, 'And log it.', first);
  const resolved = apostil('resolve', String(reply));
  assert.equal(resolved.status, 0);
  assert.deepEqual(JSON.parse(resolved.stdout).map((remark: { state: string; closedBy: string }) => [remark.state, remark.closedBy]), [['closed', 'claude-code'], ['closed', 'claude-code']]);
  assert.equal(JSON.parse(apostil('resolve', String(first), '--agent', 'codex').stdout)[0].closedBy, 'codex');
  assert.equal(apostil('resolve', '999').status, 1);
  store.reopenThread(first);
  assert.deepEqual(store.threadOf(first).map((remark) => [remark.state, remark.closedBy]), [['open', undefined], ['open', undefined]]);
  store.closeThread(first);
  assert.equal(store.threadOf(first)[0].closedBy, undefined);
  store.sendRemark(id);
  store.close();

  // The hook JSON comes on standard input, so the inbox runs as the real program. With nothing sent and a timeout of 0 it ends quietly;
  // in a run with no person the wait ends at once, even with a long timeout (runHasNoPerson has each sign).
  const hook = (env: Record<string, string>, ...args: string[]) => spawnSync(process.execPath, [join(__dirname, 'cli.js'), 'inbox', ...args], {
    encoding: 'utf8', timeout: 5000, input: JSON.stringify({ session_id: 's9', cwd: repo.folder }), env: { ...process.env, APOSTIL_HOME: home, ...env },
  });
  assert.equal(JSON.parse(hook({}).stdout).length, 0); // the remark is done, not sent
  const waited = hook({}, '--wait', '--timeout', '0');
  assert.deepEqual([waited.status, waited.stdout], [0, '']);
  const quiet = hook({ APOSTIL_NO_WAIT: '1' }, '--wait', '--timeout', '30');
  assert.deepEqual([quiet.status, quiet.stdout, quiet.stderr], [0, '', '']);
  repo.remove();
});

test('the inbox finds sent remarks by session, and by branch when no change has the session; --wait exits 2 with the text, a timeout exits 0, a second waiter ends the first, and a run with no person does not wait', async () => {
  const store = new Store(tempFolder('apostil-home-'));
  const repo = makeTestRepo();
  const { changeId } = saveDraft(store, repo.folder, testChangeFile());
  const id = store.addRemark(changeId!, target, 'Look here');
  assert.deepEqual(sentRemarks(store, 's1', repo.folder), []); // not sent yet
  store.sendRemark(id);
  assert.equal(sentRemarks(store, 's1', repo.folder)[0].id, id); // by branch
  saveDraft(store, repo.folder, testChangeFile(), { app: 'claude-code', session: 's1' });
  assert.equal(sentRemarks(store, 's1', tempFolder()).length, 1); // by session, from any folder
  assert.deepEqual(sentRemarks(store, 's2', tempFolder()), []);
  const fresh = store.addRemark(changeId!, target, 'For a new session');
  store.sendRemark(fresh, { app: 'codex', kind: 'new' });
  assert.deepEqual(sentRemarks(store, 's1', repo.folder).map((remark) => remark.id), [id]); // a new session gets its own run, not the waiter
  store.closeRemark(id);
  store.closeRemark(fresh);

  const log = store.addRemark(changeId!, { kind: 'lines', file: 'src/app.py', lines: [5, 6] }, 'Log this.');
  let clock = 0;
  const options = { session: 's1', folder: repo.folder, pid: 1111, timeoutSeconds: 10, now: () => clock, sleep: async (ms: number) => { clock += ms; } };
  const timedOut = await waitForRemarks(store, options);
  assert.deepEqual(timedOut, { code: 0 });
  assert.ok(clock >= 10000);
  assert.deepEqual(store.waiters(), []);
  clock = 0;
  const woken = await waitForRemarks(store, { ...options, sleep: async (ms) => { clock += ms; store.sendRemark(log); } });
  assert.equal(woken.code, 2);
  assert.match(woken.text!, /apostil answer <id>/);
  assert.match(woken.text!, new RegExp(`remark ${log} \\(src/app.py lines 5-6\\): Log this.`));
  const logged = store.remarks(changeId!).find((remark) => remark.id === log)!;
  assert.deepEqual([logged.state, logged.run?.session], ['running', 's1']);
  const first = waitForRemarks(store, { ...options, pid: 2222, sleep: async () => { store.setWaiter('s1', 3333); } }); // another waiter takes over
  assert.deepEqual(await first, { code: 0 });
  assert.equal(store.waiterOf('s1'), 3333);
  assert.deepEqual(store.waiters().map((waiter) => [waiter.session, waiter.pid, waiter.alive]), [['s1', 3333, false]]);

  // runHasNoPerson: each of the three signs, and none.
  assert.equal(runHasNoPerson({}), false);
  assert.equal(runHasNoPerson({ CLAUDE_CODE_SESSION_ATTENDED: '1', CLAUDE_CODE_ENTRYPOINT: 'cli' }), false);
  assert.equal(runHasNoPerson({ APOSTIL_NO_WAIT: '1' }), true);
  assert.equal(runHasNoPerson({ CLAUDE_CODE_SESSION_ATTENDED: '0' }), true);
  assert.equal(runHasNoPerson({ CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' }), true);
  store.close();
  repo.remove();
});

test('apostil . and apostil open <folder> start the app with the folder, a missing folder gives exit code 1, and openCommand uses APOSTIL_APP when set, else VS Code', async () => {
  const bin = tempFolder('apostil-bin-');
  const log = join(bin, 'args.txt');
  const script = join(bin, 'fake-app.sh');
  writeFileSync(script, `#!/bin/sh\necho "$@" >> "${log}"\n`);
  chmodSync(script, 0o755);
  const folder = tempFolder('apostil-open-');
  const env = { APOSTIL_APP: script, APOSTIL_HOME: tempFolder('apostil-home-') };

  const short = runApostil(['.'], { cwd: folder, env });
  assert.equal(short.status, 0);
  assert.deepEqual(JSON.parse(short.stdout), { opened: folder });
  assert.equal(runApostil(['open', folder], { env }).status, 0);
  for (let wait = 0; wait < 500 && !(existsSync(log) && readFileSync(log, 'utf8').split('\n').length > 2); wait++) await new Promise((done) => setTimeout(done, 10));
  assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n'), [folder, folder]);
  assert.equal(runApostil(['open', join(folder, 'nope')], { env }).status, 1);
  assert.equal(runApostil(['nonsense'], { cwd: folder, env }).status, 1);

  assert.deepEqual(openCommand(folder, { APOSTIL_APP: '/x/apostil' }), ['/x/apostil', folder]);
  const code = openCommand(folder, { PATH: '' });
  assert.match(code[0], /Visual Studio Code/);
  assert.ok(code[1].startsWith('--extensionDevelopmentPath='));
  assert.equal(code[2], folder);
  // An installed extension has no build files: it opens the folder in VS Code as it is.
  const installed = openCommand(folder, { PATH: '' }, tempFolder('apostil-installed-'));
  assert.deepEqual(installed.slice(1), [folder]);
});
