// Tests for the agent of a change and for the pull-request states.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { agentFromEnv, BILLING, claudeDefaultMode, claudeRunMode, codexDefaultSandbox, INSTALL, installedApps, isOptionProblem, isSignInProblem, mergeAgent, runFix, runProblem, UPDATE, newestLine, newRunCommand, openSessionCommand, resumeCommand, sessionLink, sessionName, SIGN_IN } from './agents';
import { tempFolder } from './test-repo';
import { pullRequestsFromJson, stateOf, type RawPullRequest } from './pull-requests';

test('the agent comes from a Claude Code environment, merging puts single fields over the stored agent with a new app dropping the old session, and the apps whose program is on the path are listed in the order that @ offers them', () => {
  assert.equal(agentFromEnv({}), undefined);
  assert.deepEqual(agentFromEnv({ CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 's1', CLAUDE_CODE_USER_EMAIL: 'a@b.c' }),
    { app: 'claude-code', session: 's1', hostSession: undefined, account: 'a@b.c' });
  assert.equal(agentFromEnv({ CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 's1', CLAUDE_CODE_HOST_SESSION_ID: 'local_1' })?.hostSession, 'local_1');

  // Merging puts single fields over the stored agent, and a new app drops the old session.
  const stored = { app: 'claude-code', session: 's1', account: 'a' };
  assert.deepEqual(mergeAgent(stored, {}), stored);
  assert.deepEqual(mergeAgent(stored, { account: 'b' }), { app: 'claude-code', session: 's1', account: 'b' });
  assert.deepEqual(mergeAgent(stored, { app: 'codex', session: 't1' }), { app: 'codex', session: 't1' });
  assert.equal(mergeAgent(undefined, { session: 'x' }), undefined);

  // InstalledApps lists the apps whose program is on the path, in the order that @ offers them.
  const [one, two] = [tempFolder('apostil-path-'), tempFolder('apostil-path-')];
  const program = (folder: string, name: string, mode: number) => { writeFileSync(join(folder, name), '#!/bin/sh\n'); chmodSync(join(folder, name), mode); };
  program(one, 'agy', 0o755);
  program(two, 'claude', 0o755);
  program(two, 'codex', 0o644); // not executable
  mkdirSync(join(one, 'opencode')); // a folder, not a program
  assert.deepEqual(installedApps([one, two].join(delimiter)), ['claude-code', 'antigravity']);
  assert.deepEqual(installedApps(''), []);
});

test('the link, the resume command, the command of a new session and the command that continues a session in a terminal, for each app; a run edits files without switching all prompts off', () => {
  assert.equal(sessionLink({ app: 'claude-code', hostSession: 'local_1' }), 'claude://claude.ai/epitaxy/local_1');
  assert.equal(sessionLink({ app: 'claude-code', session: 's1' }), undefined);
  assert.equal(sessionLink({ app: 'codex', session: 't1' }), 'codex://threads/t1');
  assert.equal(sessionLink({ app: 'antigravity', session: 'c1' }), undefined);

  const claude = resumeCommand({ app: 'claude-code', session: 's1' }, 'Do it')!;
  assert.deepEqual(claude.slice(0, 4), ['claude', '-p', '--resume', 's1']);
  assert.deepEqual(claude.slice(-4), ['--permission-mode', 'acceptEdits', '--allowedTools', 'Bash(apostil *)']);
  assert.ok(!claude.some((word) => word.includes('dangerously')));
  // Codex may write in the folder of the change and in the folder of the store, where its answer goes; nothing switches its sandbox off.
  const codex = resumeCommand({ app: 'codex', session: 't1' }, 'Do it', { store: '/home/me/.apostil' })!;
  assert.deepEqual(codex, ['codex', 'exec', 'resume', 't1', 'Do it', '--json', '-c', 'sandbox_mode="workspace-write"', '-c', 'sandbox_workspace_write.writable_roots=["/home/me/.apostil"]']);
  assert.ok(!codex.some((word) => word.includes('dangerously')));
  assert.deepEqual(resumeCommand({ app: 'antigravity', session: 'c1' }, 'Do it'), ['agy', '-p', 'Do it', '--conversation', 'c1']);
  assert.equal(resumeCommand({ app: 'opencode', session: 'o1' }, 'Do it'), undefined);
  assert.equal(resumeCommand({ app: 'claude-code' }, 'Do it'), undefined);

  // NewRunCommand starts a new session of each app with a prompt, and edits files without switching all prompts off.
  assert.deepEqual(newRunCommand('claude-code', 'Do it'), ['claude', '-p', 'Do it', '--output-format', 'json', '--permission-mode', 'acceptEdits', '--allowedTools', 'Bash(apostil *)']);
  assert.deepEqual(newRunCommand('codex', 'Do it'), ['codex', 'exec', 'Do it', '--json', '-c', 'sandbox_mode="workspace-write"']);
  assert.deepEqual(newRunCommand('codex', 'Do it', { store: '/home/me/.apostil' })?.slice(-2), ['-c', 'sandbox_workspace_write.writable_roots=["/home/me/.apostil"]']);
  // The model that the owner set in Apostil goes to Codex only, for a new session and for a continued one; with none set, Codex keeps its own.
  assert.deepEqual(newRunCommand('codex', 'Do it', { codexModel: 'model-a' })?.slice(-2), ['-c', 'model="model-a"']);
  assert.deepEqual(resumeCommand({ app: 'codex', session: 't1' }, 'Do it', { codexModel: 'model-a' })?.slice(-2), ['-c', 'model="model-a"']);
  assert.ok(!newRunCommand('codex', 'Do it')?.some((word) => word.startsWith('model=')));
  assert.deepEqual(newRunCommand('claude-code', 'Do it', { codexModel: 'model-a' }), newRunCommand('claude-code', 'Do it'));
  assert.deepEqual(newRunCommand('antigravity', 'Do it'), ['agy', '-p', 'Do it', '--mode', 'accept-edits']);
  assert.deepEqual(newRunCommand('opencode', 'Do it'), ['opencode', 'run', 'Do it']);
  assert.equal(newRunCommand('other', 'Do it'), undefined);

  // The command that continues a session in a terminal, for each app.
  assert.deepEqual(openSessionCommand('claude-code', 's1'), ['claude', '--resume', 's1']);
  assert.deepEqual(openSessionCommand('codex', 't1'), ['codex', 'resume', 't1']);
  assert.equal(openSessionCommand('antigravity', 'a1'), undefined);
  assert.equal(openSessionCommand('opencode', 'o1'), undefined);
});

const pr = (changes: Partial<RawPullRequest>): RawPullRequest => ({
  number: 1, title: 't', url: 'u', state: 'OPEN', isDraft: false, reviewDecision: '', mergeable: 'MERGEABLE', statusCheckRollup: [], ...changes,
});
const run = (conclusion: string, name = 'ci', startedAt = '1'): RawPullRequest['statusCheckRollup'][number] => ({ name, startedAt, status: 'COMPLETED', conclusion });

test('stateOf gives one state for each fixture; only the newest run of a check counts, statuses of other products count one by one, and the pull requests come newest first', () => {
  assert.equal(stateOf(pr({ state: 'MERGED', isDraft: true })), 'merged');
  assert.equal(stateOf(pr({ state: 'CLOSED' })), 'closed');
  assert.equal(stateOf(pr({ isDraft: true })), 'draft');
  assert.equal(stateOf(pr({ statusCheckRollup: [run('FAILURE')], mergeable: 'CONFLICTING' })), 'checks failing');
  assert.equal(stateOf(pr({ mergeable: 'CONFLICTING' })), 'conflicts');
  assert.equal(stateOf(pr({ reviewDecision: 'CHANGES_REQUESTED' })), 'changes requested');
  assert.equal(stateOf(pr({ reviewDecision: 'REVIEW_REQUIRED' })), 'review needed');
  assert.equal(stateOf(pr({ reviewDecision: 'APPROVED', statusCheckRollup: [run('SUCCESS')] })), 'ready to merge');
  assert.equal(stateOf(pr({ reviewDecision: 'APPROVED' })), 'ready to merge');
  // No review and no check: it waits for a review. A repo that asks for no review: ready when a check ran and all passed.
  assert.equal(stateOf(pr({})), 'review needed');
  assert.equal(stateOf(pr({ statusCheckRollup: [run('SUCCESS')] })), 'ready to merge');
  assert.equal(stateOf(pr({ statusCheckRollup: [run('SUCCESS'), { name: 'slow', status: 'IN_PROGRESS' }] })), 'review needed');
  // Never while GitHub does not know about conflicts.
  assert.equal(stateOf(pr({ reviewDecision: 'APPROVED', mergeable: 'UNKNOWN' })), 'review needed');

  // Only the newest run of a check counts, and the pull requests come newest first.
  const rollup = [run('FAILURE', 'ci', '1'), run('SUCCESS', 'ci', '2'), { name: 'lint', status: 'IN_PROGRESS' }, { state: 'SUCCESS', name: 'ctx' }];
  const list = pullRequestsFromJson(JSON.stringify([pr({ number: 3, statusCheckRollup: rollup }), pr({ number: 7 })]));
  assert.deepEqual(list.map((item) => item.number), [7, 3]);
  assert.deepEqual(list[1].checks, { passed: 2, failed: 0, pending: 1 });

  // Statuses of other products count one by one: each has its own context.
  const raw = { number: 2, title: 'Fees', url: 'https://github.com/made-up/library/pull/2', state: 'OPEN', isDraft: false, reviewDecision: '', mergeable: 'MERGEABLE', statusCheckRollup: [
    { name: 'Lint', workflowName: 'CI', status: 'COMPLETED', conclusion: 'SUCCESS' },
    { name: 'Unit tests', workflowName: 'CI', status: 'COMPLETED', conclusion: 'FAILURE' },
    { context: 'coverage/patch', state: 'FAILURE' },
    { context: 'coverage/project', state: 'SUCCESS' },
    { context: 'preview', state: 'PENDING' },
  ] } as RawPullRequest;
  const [pull] = pullRequestsFromJson(JSON.stringify([raw]));
  assert.deepEqual(pull.checks, { passed: 2, failed: 2, pending: 1 });
});

test('sessionName reads the newest title near the end of a large Claude Code transcript and the name of a Codex thread; newestLine reads the lines of a file from its end in pieces', () => {
  const home = tempFolder('apostil-home-');
  const folder = join(home, '.claude', 'projects', '-made-up-project');
  mkdirSync(folder, { recursive: true });
  const line = (record: object) => `${JSON.stringify(record)}\n`;
  const filler = line({ type: 'assistant', message: { content: 'x'.repeat(2000) } }).repeat(3000); // about 6 MB
  const tail = line({ type: 'user', message: { content: 'a long last line '.repeat(9000) } }); // longer than one piece
  writeFileSync(join(folder, 'made-up-1.jsonl'), line({ type: 'custom-title', customTitle: 'First name', sessionId: 'made-up-1' }) + filler
    + line({ type: 'custom-title', customTitle: 'VS Code repo understanding tool', sessionId: 'made-up-1' }) + tail);
  assert.equal(sessionName({ app: 'claude-code', session: 'made-up-1' }, home), 'VS Code repo understanding tool');
  writeFileSync(join(folder, 'made-up-2.jsonl'), filler);
  assert.equal(sessionName({ app: 'claude-code', session: 'made-up-2' }, home), undefined);
  assert.equal(sessionName({ app: 'claude-code', session: 'missing' }, home), undefined);
  assert.equal(sessionName({ app: 'claude-code', session: '../x' }, home), undefined);

  mkdirSync(join(home, '.codex'));
  writeFileSync(join(home, '.codex', 'session_index.jsonl'), line({ id: 'c1', thread_name: 'Old name', updated_at: '1' })
    + line({ id: 'c2', thread_name: 'Other', updated_at: '2' }) + line({ id: 'c1', thread_name: 'New name', updated_at: '3' }));
  assert.equal(sessionName({ app: 'codex', session: 'c1' }, home), 'New name');
  assert.equal(sessionName({ app: 'codex', session: 'c2' }, home), 'Other');
  assert.equal(sessionName({ app: 'antigravity', session: 'c1' }, home), undefined);

  // NewestLine reads the lines of a file from its end in pieces.
  const path = join(tempFolder(), 'lines.txt');
  writeFileSync(path, Array.from({ length: 50_000 }, (_, index) => `line ${index}`).join('\n'));
  assert.equal(newestLine(path, (text) => (text.endsWith('7') ? text : undefined)), 'line 49997');
  assert.equal(newestLine(path, (text) => (text === 'line 3' ? text : undefined)), 'line 3');
});

test('a failed run gets its buttons, the fix first, and each button says what it does: a terminal with the sign-in or the update, the other app, the allowed commands, a page, the output', () => {
  const START = 'Claude Code did not write the map. It said:';
  const labels = (problem: string, has: Parameters<typeof runProblem>[1]) => runProblem(problem, has).buttons.map((button) => button.label).join();
  const deeds = (problem: string, has: Parameters<typeof runProblem>[1]) => runProblem(problem, has).buttons.map((button) => button.deed);
  const claude = { app: 'claude-code', again: true };

  // A session that expired: the sign-in runs in a terminal, and one more question offers "Try again".
  const expired = `${START} Your Claude session has expired. Sign in again to continue (claude auth login).`;
  assert.equal(runProblem(expired, claude).say, `${expired} Its sign-in is missing or has expired. Sign in, then try again.`);
  assert.equal(labels(expired, claude), 'Sign in in a terminal,Try again');
  assert.deepEqual(deeds(expired, claude), [{ do: 'terminal', name: 'Sign in to Claude Code', command: 'claude auth login', thenAgain: true }, { do: 'again' }]);
  assert.deepEqual(deeds(expired, { app: 'claude-code' }), [{ do: 'terminal', name: 'Sign in to Claude Code', command: 'claude auth login', thenAgain: false }]); // no run to start again
  assert.deepEqual(deeds('codex gave no answer. It said: not logged in', { app: 'codex', again: true })[0], { do: 'terminal', name: 'Sign in to Codex', command: 'codex login', thenAgain: true });

  // A Claude Code that does not know an option: the update runs in a terminal.
  const old = `${START} error: unknown option '--permission-mode'`;
  assert.equal(labels(old, claude), 'Update Claude Code,Try again');
  assert.deepEqual(deeds(old, claude)[0], { do: 'terminal', name: 'Update Claude Code', command: 'claude update', thenAgain: false });

  // The usage limit, a busy service, no credit, not installed: the other connected app can do the work at once.
  const limit = `${START} Claude AI usage limit reached. Your limit resets at 5pm.`;
  assert.equal(labels(limit, { ...claude, instead: 'codex' }), 'Use Codex instead,Try again');
  assert.deepEqual(deeds(limit, { ...claude, instead: 'codex' }), [{ do: 'instead' }, { do: 'again' }]);
  assert.equal(labels(limit, claude), 'Try again'); // no other app is connected
  assert.equal(labels(`${START} Credit balance is too low`, { ...claude, instead: 'codex' }), 'Open billing,Use Codex instead,Try again');
  assert.deepEqual(deeds(`${START} Credit balance is too low`, claude)[0], { do: 'page', address: BILLING['claude-code'] });
  assert.equal(labels('could not start claude: spawn claude ENOENT', { ...claude, instead: 'codex' }), 'Install Claude Code,Use Codex instead,Try again');
  assert.deepEqual(deeds('could not start claude: spawn claude ENOENT', claude)[0], { do: 'page', address: INSTALL['claude-code'] });
  assert.equal(labels(`${START} fetch failed`, { ...claude, instead: 'codex' }), 'Try again'); // no network: the other app would not reach its service either

  // "Allow" and "Set up" start the run again by themselves, so they stand alone.
  const denied = `${START} It ended and saved no map.`;
  assert.equal(labels(denied, { ...claude, denied: ['Bash(git ls-files *)'] }), 'Allow and try again');
  assert.deepEqual(deeds(denied, { ...claude, denied: ['Bash(git ls-files *)'] }), [{ do: 'allow' }]);
  assert.deepEqual(deeds(denied, { ...claude, noCommand: true }), [{ do: 'set-up' }]);

  // Codex refused its model: the setting comes first. With no known fix, the output of the program is one click away.
  assert.equal(labels('codex gave no answer. It said: the model gpt-x is not supported', { app: 'codex', again: true }), 'Set the model for Codex,Try again');
  assert.deepEqual(deeds('codex gave no answer. It said: the model gpt-x is not supported', { app: 'codex', again: true })[0], { do: 'model' });
  assert.equal(labels(`${START} something odd`, { ...claude, said: 'a line of output' }), 'Try again,Show the output');
  assert.deepEqual(deeds(`${START} something odd`, { ...claude, said: 'a line of output' })[1], { do: 'output', text: 'a line of output' });
  assert.equal(labels(`${START} something odd`, claude), 'Try again');
});

test('a failed run gets the fix that fits it: set up, sign in, install, update, allow, billing, usage limit, a busy service, no network, a busy store, the other app where it helps, or none', () => {
  for (const problem of [
    'Failed to authenticate. API Error: 401 OAuth access token has expired. Re-authenticate to continue.',
    'Invalid API key · Please run /login', 'Not logged in. Run codex login.', 'Error: 401 Unauthorized',
    'Your Claude session has expired. Sign in again to continue (claude auth login).',
  ]) assert.equal(isSignInProblem(problem), true, problem);
  for (const problem of ['The model gpt-9 does not exist.', 'You have hit your usage limit.', 'apostil save: Line 40 is after the end of src/app.py, which has 6 lines.', 'Request timed out after 401 seconds']) {
    assert.equal(isSignInProblem(problem), problem === 'Request timed out after 401 seconds', problem); // a bare 401 counts: the apps name the status of the refusal that way
  }
  assert.deepEqual(Object.keys(SIGN_IN).sort(), ['claude-code', 'codex']);
  assert.equal(SIGN_IN['claude-code'].command, 'claude auth login'); // the command that Claude Code names when its session expired

  // A failed run gets the fix that fits it: set up, sign in, update, allow, or none.
  assert.equal(runFix('claude-code', 'It ended with code 1.', [], true).kind, 'set-up');
  assert.equal(runFix('claude-code', 'Failed to authenticate. API Error: 401').kind, 'sign-in');
  const update = runFix('claude-code', "error: unknown option '--permission-mode'");
  assert.deepEqual(update, { kind: 'update', say: 'This Claude Code does not know an option that Apostil gives it. Update Claude Code, and try again.' });
  assert.equal(UPDATE['claude-code'], 'claude update');
  assert.equal(runFix('codex', "error: unexpected argument '--json'").kind, 'none'); // Apostil knows no update command for Codex
  const allow = runFix('claude-code', 'It ended and saved no map.', ['Bash(git ls-files *)']);
  assert.deepEqual(allow, { kind: 'allow', say: 'Claude Code was not allowed to run Bash(git ls-files *). Allow it in the settings of Claude Code for this repo, and try again.' });
  assert.equal(runFix('claude-code', 'Overloaded').kind, 'busy'); // a busy service: Try again is its fix
  assert.equal(isOptionProblem("error: unknown option '--max-turns 1'"), true);
  assert.equal(isOptionProblem('The model is overloaded'), false);

  // More kinds of failed runs get their fix: install, billing, usage limit, a busy service, no network, a busy store, and the other app where it helps.
  const kind = (problem: string, other?: string) => runFix('claude-code', problem, [], false, other);
  assert.deepEqual(kind('Could not start claude: spawn claude ENOENT', 'codex'), { kind: 'install', say: 'Claude Code is not on the path of VS Code. Install it, and try again. Or use Codex now.' });
  assert.equal(INSTALL['claude-code'], 'https://code.claude.com/docs/en/setup');
  assert.deepEqual(kind('Credit balance is too low'), { kind: 'billing', say: 'The account of Claude Code has no credit left. Add credit, and try again.' });
  assert.equal(BILLING['claude-code'], 'https://console.anthropic.com/settings/billing');
  assert.deepEqual(kind('Claude AI usage limit reached|1763215200', 'codex'), { kind: 'limit', say: 'Claude Code reached its usage limit. Try again when it resets. Or use Codex now.' });
  assert.equal(kind('API Error: 529 Overloaded').kind, 'busy');
  assert.equal(kind('getaddrinfo ENOTFOUND api.anthropic.com').kind, 'network');
  assert.equal(kind('database is locked').kind, 'locked');
  assert.equal(kind('Request timed out after 401 seconds').kind, 'sign-in'); // a bare 401 counts as a refused sign-in before a time-out counts as the network
  assert.equal(kind('apostil save: no such file or directory: notes.json').kind, 'none'); // a missing file of the repo is no missing program
  assert.equal(runFix('codex', "You've hit your usage limit.", [], false, 'claude-code').say, 'Codex reached its usage limit. Try again when it resets. Or use Claude Code now.');
});

test('a run keeps the default permission mode of Claude Code when a run can work alone in it, read from the repo before the person, and the sandbox of Codex when it is full access, also from its profile', () => {
  const home = tempFolder('apostil-home-');
  const repo = tempFolder('apostil-repo-');
  assert.equal(claudeDefaultMode(repo, home), undefined);
  assert.equal(claudeRunMode(undefined), 'acceptEdits');
  mkdirSync(join(home, '.claude'), { recursive: true });
  writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify({ permissions: { defaultMode: 'auto' } }));
  assert.equal(claudeDefaultMode(repo, home), 'auto');
  mkdirSync(join(repo, '.claude'), { recursive: true });
  writeFileSync(join(repo, '.claude', 'settings.json'), JSON.stringify({ permissions: { defaultMode: 'bypassPermissions' } }));
  assert.equal(claudeDefaultMode(repo, home), 'bypassPermissions');
  writeFileSync(join(repo, '.claude', 'settings.local.json'), JSON.stringify({ permissions: { defaultMode: 'plan' } }));
  assert.equal(claudeDefaultMode(repo, home), 'plan');
  assert.equal(claudeRunMode('plan'), 'acceptEdits'); // a run cannot write its drafts in plan mode, nor ask anybody
  assert.equal(claudeRunMode('manual'), 'acceptEdits');
  assert.equal(claudeRunMode('auto'), 'auto');
  assert.deepEqual(newRunCommand('claude-code', 'Do it', { claudeMode: 'auto' })?.slice(-4), ['--permission-mode', 'auto', '--allowedTools', 'Bash(apostil *)']);
  assert.deepEqual(resumeCommand({ app: 'claude-code', session: 's' }, 'Do it', { claudeMode: 'plan' })?.slice(-4), ['--permission-mode', 'acceptEdits', '--allowedTools', 'Bash(apostil *)']);

  // A run of Codex keeps the sandbox that the person set when it is full access, and the sandbox of its profile.
  {
    const home = tempFolder('apostil-home-');
    assert.equal(codexDefaultSandbox(home, ''), undefined);
    mkdirSync(join(home, '.codex'), { recursive: true });
    writeFileSync(join(home, '.codex', 'config.toml'), 'model = "gpt-5"\nsandbox_mode = "workspace-write"\napproval_policy = "on-request"\n\n[profiles.free]\nsandbox_mode = "danger-full-access"\n');
    assert.equal(codexDefaultSandbox(home, ''), 'workspace-write');
    writeFileSync(join(home, '.codex', 'config.toml'), 'profile = "free"\nsandbox_mode = "workspace-write"\n\n[profiles.free]\nsandbox_mode = "danger-full-access"\n');
    assert.equal(codexDefaultSandbox(home, ''), 'danger-full-access');
    assert.deepEqual(newRunCommand('codex', 'Do it', { store: '/s', codexSandbox: 'danger-full-access' })?.slice(-2), ['-c', 'sandbox_mode="danger-full-access"']);
    assert.deepEqual(newRunCommand('codex', 'Do it', { store: '/s', codexSandbox: 'read-only' })?.slice(-4), ['-c', 'sandbox_mode="workspace-write"', '-c', 'sandbox_workspace_write.writable_roots=["/s"]']);
  }
});


