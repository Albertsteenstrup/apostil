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
import { answersChanged, deniedRules, problemFromOutput, sessionFromOutput, startRun, type RunTerminals } from './agent-run';

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

test('a comment to a new session of Claude Code runs in a terminal with its prompt as the first message and a session id of its own, which the remark has at once; its answer ends the run once, and the terminal that closes after it changes nothing; a reply to that session is typed into its open terminal, else resumes it in a new one', () => {
  const repo = makeTestRepo();
  const home = tempFolder('apostil-home-');
  const kept = process.env.APOSTIL_HOME;
  process.env.APOSTIL_HOME = home;
  const store = new Store(home);
  try {
    const remark = store.addRepoRemark(repoId(repo.folder), { kind: 'part', part: 'app', label: 'Part "App"' }, 'Add a test.');
    store.sendRemark(remark, { app: 'claude-code', kind: 'new' });
    const started: { command: string[]; name: string; session: string; closed: (code?: number) => void }[] = [];
    const typed: { session: string; text: string }[] = [];
    let open = true; // the terminal of the session is open in this window
    const terminal: RunTerminals = {
      start: (command, _folder, name, session, closed) => { started.push({ command, name, session, closed }); return { processId: Promise.resolve(undefined) }; },
      type: (session, text) => { if (!open) return undefined; typed.push({ session, text }); return { processId: Promise.resolve(undefined) }; },
    };
    const ends: (string | undefined)[] = [];
    startRun(store, remark, (problem) => ends.push(problem), 'claude-code', repo.folder, {}, 'read and edit', undefined, terminal);
    const [run] = started;
    assert.equal(run.name, 'Apostil comment · Part "App"');
    assert.notEqual(run.command[1], '-p'); // the prompt is the first message of a session that a person can answer
    assert.match(run.command[1], /Add a test\./);
    assert.equal(run.command[run.command.indexOf('--session-id') + 1], run.session);
    assert.deepEqual({ state: store.getRemark(remark)?.state, session: store.getRemark(remark)?.run?.session }, { state: 'running', session: run.session });
    store.answerRemark(remark, 'Done.');
    answersChanged();
    run.closed(0);
    assert.deepEqual(ends, [undefined]);
    assert.equal(store.getRemark(remark)?.state, 'done');
    // A reply that goes on in that session: typed into its open terminal as the next message, and the reply runs in that session until its answer.
    const replyEnds: (string | undefined)[] = [];
    const reply = (text: string): number => {
      const id = store.addRepoRemark(repoId(repo.folder), { kind: 'part', part: 'app', label: 'Part "App"' }, text, remark);
      store.sendRemark(id, { app: 'claude-code', kind: 'session', session: run.session });
      startRun(store, id, (problem) => replyEnds.push(problem), undefined, repo.folder, {}, 'read and edit', undefined, terminal);
      return id;
    };
    const first = reply('Make gemini the same as the others.');
    assert.deepEqual({ session: typed[0]?.session, prompt: /Make gemini the same/.test(typed[0]?.text ?? ''), started: started.length }, { session: run.session, prompt: true, started: 1 });
    assert.deepEqual({ state: store.getRemark(first)?.state, session: store.getRemark(first)?.run?.session }, { state: 'running', session: run.session });
    store.answerRemark(first, 'Done.');
    answersChanged();
    assert.deepEqual(replyEnds, [undefined]);
    // With no open terminal of the session in this window, Claude Code resumes it in a new terminal with the reply as its next message.
    open = false;
    reply('And codex too.');
    assert.deepEqual(started[1]?.command.slice(0, 3), ['claude', '--resume', run.session]);
    assert.match(started[1]?.command[3] ?? '', /And codex too\./);
    assert.equal(started[1]?.session, run.session);
  } finally {
    store.close();
    if (kept === undefined) delete process.env.APOSTIL_HOME;
    else process.env.APOSTIL_HOME = kept;
    repo.remove();
  }
});

test('Antigravity JSON output gives its conversation id, error message, and denied actions', () => {
  assert.equal(sessionFromOutput('{"conversation_id":"agy-conv-1","status":"SUCCESS","response":"OK"}'), 'agy-conv-1');
  assert.equal(problemFromOutput('{"conversation_id":"","status":"ERROR","error":"invalid model selection"}'), 'invalid model selection');
  assert.equal(problemFromOutput('{"conversation_id":"agy-conv-1","status":"SUCCESS","response":"OK"}'), undefined);
  assert.deepEqual(deniedRules('{"conversation_id":"agy-conv-1","status":"SUCCESS","denied_actions":[{"action":"write_file","display_name":"Edit"},{"action":"command","display_name":"Bash"}]}'), ['write_file', 'command']);
});
