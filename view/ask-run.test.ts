// Tests for the run of words for an agent: what the run gets, a run that was not allowed a command, and the run for a pull request whose branch is not checked out.

import assert from 'node:assert/strict';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { describeWords } from '../shared/ask';
import { git, repoId } from '../shared/git';
import { Store } from '../shared/store';
import { madeUpAgentHome, makePullRepo, makeTestRepo, tempFolder, testChangeFile } from '../shared/test-repo';
import { WRITER_AGENT } from '../shared/agents';
import { askView, ON_BRANCH, startAsk } from './ask-run';
import { pageData } from './page-data';

test('the press starts a new session with the words, its id known at once, led by the second smallest model with the smallest as its writers, at the most effort; a run that was not allowed a command stopped, and the press is there again', async () => {
  const repo = makeTestRepo();
  const home = tempFolder('apostil-home-');
  const bin = tempFolder('apostil-bin-');
  const got = join(bin, 'arguments.txt');
  // A stand-in claude that keeps its arguments and says that it ended well, with a command that it was not allowed to run.
  writeFileSync(join(bin, 'claude'), `#!/bin/sh\nprintf '%s\\n' "$@" > '${got}'\necho '{"type":"result","is_error":false,"result":"Done","permission_denials":[{"tool_name":"Bash","tool_input":{"command":"gh pr checkout 35"}}]}'\n`);
  chmodSync(join(bin, 'claude'), 0o755);
  const kept = { PATH: process.env.PATH, APOSTIL_HOME: process.env.APOSTIL_HOME, APOSTIL_AGENT_HOME: process.env.APOSTIL_AGENT_HOME };
  Object.assign(process.env, { PATH: `${bin}:${kept.PATH}`, APOSTIL_HOME: home, APOSTIL_AGENT_HOME: madeUpAgentHome() }); // made-up catalogs, never the real ones
  const store = new Store(home);
  const words = describeWords(35);
  try {
    const before = askView(store, repo.folder, words, ['claude-code']);
    assert.deepEqual([before.press?.label, before.team?.lead, before.team?.writer, before.team?.effort], ['Describe it with a new Claude Code session', 'sonnet', 'haiku', 'medium']);
    let done: (end: { problem?: string; denied?: string[] }) => void = () => {};
    const ending = new Promise<{ problem?: string; denied?: string[] }>((resolve) => { done = resolve; });
    assert.equal(await startAsk(store, repo.folder, words, ['claude-code'], { claude: 'haiku' }, () => {}, (problem, facts) => done({ problem, denied: facts?.denied })), true);
    assert.equal(askView(store, repo.folder, words, ['claude-code']).line?.state, 'working');
    const ended = await ending;
    const args = readFileSync(got, 'utf8').split('\n');
    const view = askView(store, repo.folder, words, ['claude-code']);
    assert.deepEqual(args.slice(0, 2), ['-p', `${words}. You lead on Sonnet 5.5 at medium effort: you start, check and correct the writers, and you write no part yourself. Start every writer and checker subagent on Haiku 5.5 at medium effort: start each one as the agent ${WRITER_AGENT}, which runs on that model at that effort, and give it no model of your own.`]);
    assert.equal(args[args.indexOf('--session-id') + 1], view.line?.tip?.replace('Session ', '')); // the link of the session is there before the run ends
    assert.equal(args[args.indexOf('--model') + 1], 'sonnet'); // the lead, though the setting says haiku
    assert.equal(args[args.indexOf('--effort') + 1], 'medium'); // a description draws diagrams: medium effort by default
    assert.deepEqual(JSON.parse(args[args.indexOf('--agents') + 1])[WRITER_AGENT].model, 'haiku');
    assert.deepEqual(ended, { problem: 'It ended before it was done.', denied: ['Bash(gh pr *)'] });
    assert.equal(view.line?.state, 'stopped');
    assert.equal(view.press?.label, 'Describe it with a new Claude Code session'); // the session of a run that stopped is not asked again
  } finally {
    store.close();
    Object.assign(process.env, kept);
    if (kept.APOSTIL_HOME === undefined) delete process.env.APOSTIL_HOME;
    if (kept.APOSTIL_AGENT_HOME === undefined) delete process.env.APOSTIL_AGENT_HOME;
    repo.remove();
  }
});

test('the press of a pull request whose branch is not checked out names a new session, not a known one on main; its run starts in a folder on the head branch, which is gone when the run ends, the branch stays, and the page of the pull request then shows the description', async () => {
  const repo = makePullRepo();
  const home = tempFolder('apostil-home-');
  const bin = tempFolder('apostil-bin-');
  const got = join(bin, 'where.txt');
  // A stand-in claude that keeps the folder that it runs in, the branch there and its words, and says that it ended well.
  writeFileSync(join(bin, 'claude'), `#!/bin/sh\npwd -P > '${got}'\ngit branch --show-current >> '${got}'\nprintf '%s\\n' "$2" >> '${got}'\necho '{"type":"result","is_error":false,"result":"Done"}'\n`);
  chmodSync(join(bin, 'claude'), 0o755);
  const kept = { PATH: process.env.PATH, APOSTIL_HOME: process.env.APOSTIL_HOME };
  Object.assign(process.env, { PATH: `${bin}:${kept.PATH}`, APOSTIL_HOME: home });
  const store = new Store(home);
  const words = describeWords(repo.number);
  try {
    // A session that Apostil knows in the open folder, which is on main: a run of it would describe main.
    const checks = { filesInNoPart: [], filesInTwoParts: [], filesNotChanged: [], generated: [], badNotes: [] };
    store.saveChange({ repoId: repoId(repo.folder), folder: repo.folder, branch: 'main', base: repo.base, head: repo.base, file: testChangeFile(), checks, agent: { app: 'claude-code', session: 'made-up-main-0001' } });
    const pull = { number: repo.number, branch: repo.branch, head: repo.head, base: repo.base, remote: 'origin' };
    assert.equal(askView(store, repo.folder, words, ['claude-code'], { pull }).press?.label, 'Describe it with a new Claude Code session');

    let done: (problem?: string) => void = () => {};
    const ending = new Promise<string | undefined>((resolve) => { done = resolve; });
    assert.equal(await startAsk(store, repo.folder, words, ['claude-code'], {}, () => {}, (problem) => done(problem), { pull }), true);
    const run = store.askRun(repoId(repo.folder), words);
    assert.equal(await ending, undefined);
    const [folder, branch, prompt] = readFileSync(got, 'utf8').split('\n');
    assert.equal(branch, repo.branch); // the run works on the head branch of the pull request
    assert.ok(prompt.startsWith(`${words}. ${ON_BRANCH} You lead on `), prompt); // then the models of the lead and the writers
    assert.equal(folder, run?.folder);
    assert.notEqual(folder, repo.folder);
    assert.equal(existsSync(folder), false); // the worktree that Apostil made is gone after the run
    assert.equal(git(repo.folder, 'rev-parse', `refs/heads/${repo.branch}`), repo.head); // the branch that it made stays

    // What the run saved, in the folder that is gone now: the page of the pull request shows it, read from the commits in the open folder.
    const file = { format: 1 as const, title: 'Reminders before a book is due', reason: 'Members forget the day.', parts: [{ id: 'remind', name: 'Remind', files: ['src/reminders.py'] }], links: [] };
    const id = store.saveChange({ repoId: repoId(repo.folder), folder, branch: repo.branch, base: repo.base, head: repo.head, file, checks, agent: run?.agent });
    const page = pageData(store, id, repo.folder);
    assert.equal(page?.title, 'Reminders before a book is due');
    assert.deepEqual(page?.files.map((one) => [one.path, one.added]), [['src/reminders.py', 2]]);
  } finally {
    store.close();
    Object.assign(process.env, kept);
    if (kept.APOSTIL_HOME === undefined) delete process.env.APOSTIL_HOME;
    repo.remove();
  }
});
