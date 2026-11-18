// Tests for words for an agent: which session gets them, the words of the press, the line of their run, and the sessions that the store knows.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { askLine, askPress, askTo, describeWords, type AskRun, type KnownSession } from './ask';
import { Store } from './store';
import { tempFolder, testChangeFile } from './test-repo';

const CHANGE = { app: 'claude-code', session: 'made-up-change-0001', hostSession: 'made-up-host-0001' };
const known = (app: string, session: string | undefined, at: string): KnownSession => ({ agent: { app, ...(session ? { session } : {}) }, at: `2026-11-18T${at}:00Z`, folder: `/made-up/${app}` });

test('the session that words go to: on the page of a change its session, elsewhere the newest that Apostil knows in the repo and that a run can continue, else a new session of the app of the press', () => {
  const installed = ['claude-code', 'codex'];
  // On the page of a change: the session that made the change, as "@claude-current"; a newer known session does not count there.
  const sessions = [known('codex', 'made-up-thread-0002', '10:00')];
  assert.deepEqual(askTo(sessions, installed, 'claude-code', { agent: CHANGE, folder: '/made-up/change' }), { kind: 'current', agent: CHANGE, folder: '/made-up/change', ofChange: true });
  // A session of the change that no run can continue (only its id in the desktop app), or of an app that is not installed: a new session.
  assert.deepEqual(askTo(sessions, installed, 'claude-code', { agent: { app: 'claude-code', hostSession: 'made-up-host-0001' } }), { kind: 'new', app: 'claude-code' });
  assert.deepEqual(askTo(sessions, ['codex'], 'codex', { agent: CHANGE }), { kind: 'new', app: 'codex' });
  // Elsewhere: the newest session that a run can continue, of an installed app; one with no id, or of an app that is not installed, is passed over.
  const many = [known('claude-code', 'made-up-old-0001', '08:00'), known('codex', 'made-up-thread-0002', '09:00'), known('claude-code', undefined, '11:00'), known('opencode', 'made-up-open-0003', '12:00')];
  assert.deepEqual(askTo(many, installed, 'claude-code'), { kind: 'current', agent: { app: 'codex', session: 'made-up-thread-0002' }, folder: '/made-up/codex' });
  // None: a new session of the app that the press of Home starts; no app that can be started: no press, the words stay as text.
  assert.deepEqual(askTo([], installed, 'codex'), { kind: 'new', app: 'codex' });
  assert.deepEqual(askTo([known('codex', 'made-up-thread-0002', '09:00')], [], undefined), undefined);

  // The press is a direct link: it names the session that will describe the pull request, so that nobody is surprised, and gives no words to type.
  assert.equal(describeWords(35), 'Describe pull request #35 for Apostil');
  assert.equal(askPress({ kind: 'new', app: 'claude-code' }).label, 'Describe it with a new Claude Code session');
  assert.equal(askPress({ kind: 'current', agent: CHANGE, ofChange: true }).label, 'Describe it with the session of this change');
  assert.equal(askPress({ kind: 'current', agent: { app: 'codex', session: 'made-up-thread-0002' } }, 'Fines for late books').label, 'Describe it with Codex session "Fines for late books"');
  assert.equal(askPress({ kind: 'current', agent: { app: 'claude-code', session: '1a2b3c4d-0000-4000-8000-00000000cafe' } }).label, 'Describe it with Claude Code session 1a2b3c4d');
  assert.match(askPress({ kind: 'current', agent: { app: 'claude-code', session: '1a2b3c4d-0000-4000-8000-00000000cafe' } }).tip, /newest Claude Code session that Apostil knows in this repo writes the description \(session 1a2b3c4d-0000-4000-8000-00000000cafe\)/);

  // The line after the press: which session writes the description, its state, and where the session opens (in its app, else in a terminal).
  const run: AskRun = { to: 'new', agent: { app: 'claude-code', session: '1a2b3c4d-0000-4000-8000-00000000cafe' }, folder: '/made-up/repo', startedAt: '2026-11-18T12:00:00Z', pid: 1 };
  assert.deepEqual(askLine(run, true), { words: 'Description by a new Claude Code session 1a2b3c4d', state: 'working', tip: 'Session 1a2b3c4d-0000-4000-8000-00000000cafe', opens: 'terminal' });
  assert.equal(askLine({ ...run, endedAt: '2026-11-18T12:05:00Z' }, false).state, 'done');
  assert.equal(askLine({ ...run, endedAt: '2026-11-18T12:05:00Z', problem: 'It ended with code 1.' }, false).state, 'stopped');
  assert.equal(askLine(run, false).state, 'stopped'); // its program is gone with no end: VS Code closed while it ran
  assert.deepEqual(askLine({ ...run, to: 'current', agent: CHANGE }, true, 'Holds on books').words, 'Description by Claude Code session "Holds on books"');
  assert.equal(askLine({ ...run, to: 'current', agent: CHANGE }, true).opens, 'app');
});

test('the store knows the sessions of a repo, from its changes and from the runs that Apostil started, and a run of words to a new session counts as a run that Apostil started', () => {
  const store = new Store(tempFolder('apostil-home-'));
  try {
    const file = testChangeFile();
    const checks = { filesInNoPart: [], filesInTwoParts: [], filesNotChanged: [], generated: [], badNotes: [] };
    const change = store.saveChange({ repoId: 'repo-a', folder: '/made-up/a', branch: 'holds', base: 'b', head: 'h', file, checks, agent: CHANGE });
    store.saveChange({ repoId: 'repo-b', folder: '/made-up/b', branch: 'other', base: 'b', head: 'h', file, checks, agent: { app: 'codex', session: 'made-up-other-repo' } });
    // A comment that continued the session of the change keeps its id in the desktop app; one to a new session has only its own id.
    const current = store.addRemark(change, { kind: 'part', part: 'p' }, 'Why?');
    store.sendRemark(current, { app: 'claude-code', kind: 'current' });
    store.startRemarkRun(current, { session: CHANGE.session, startedAt: '2026-11-18T09:00:00Z' });
    const fresh = store.addRemark(change, { kind: 'part', part: 'p' }, 'And this?');
    store.sendRemark(fresh, { app: 'codex', kind: 'new' });
    store.startRemarkRun(fresh, { startedAt: '2026-11-18T10:00:00Z' });
    store.setRunSession(fresh, 'made-up-thread-0004');
    // The newest session: the change is saved with the time of now, so this run starts a minute after now, whenever the test runs.
    store.setAskRun('repo-a', describeWords(35), { to: 'new', agent: { app: 'claude-code', session: 'made-up-ask-0005' }, folder: '/made-up/a', startedAt: new Date(Date.now() + 60_000).toISOString() });

    const sessions = store.knownSessions('repo-a', '/made-up/open');
    assert.deepEqual(sessions.map((one) => [one.agent.app, one.agent.session, one.agent.hostSession, one.folder]), [
      ['claude-code', CHANGE.session, CHANGE.hostSession, '/made-up/a'],
      ['claude-code', CHANGE.session, CHANGE.hostSession, '/made-up/a'],
      ['codex', 'made-up-thread-0004', undefined, '/made-up/a'],
      ['claude-code', 'made-up-ask-0005', undefined, '/made-up/a'],
    ]);
    assert.deepEqual(askTo(sessions, ['claude-code', 'codex'], 'codex'), { kind: 'current', agent: { app: 'claude-code', session: 'made-up-ask-0005' }, folder: '/made-up/a' });
    assert.deepEqual(store.askRun('repo-a', describeWords(35))?.agent.session, 'made-up-ask-0005');
    assert.deepEqual(store.startedRuns().filter((run) => run.repoId === 'repo-a').map((run) => run.app).sort(), ['claude-code', 'codex']);
  } finally {
    store.close();
  }
});
