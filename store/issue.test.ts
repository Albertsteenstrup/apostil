// Tests for "apostil issue": the guard, the address of a new issue, the two issue forms, and the command with --facts and --open.
// The keys and tokens are made when the test runs, so that no file holds one.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname, userInfo } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { makeTestRepo, tempFolder, testMachine } from '../shared/test-repo';
import { cleanText, HEADINGS, issuesAddress, MAX_ADDRESS, prepareIssue, TEMPLATES, type Facts, type IssueKind } from './issue';
import { thisInstall } from './setup';

const root = join(__dirname, '..', '..');
const cli = join(__dirname, 'cli.js');
const who = { home: '/Users/sam', user: 'sam', computers: ['Sams-Laptop.local', 'Sams-Laptop'] };
const facts: Facts = { apostil: '1.2.3', vscode: '1.145.0', node: '24.22.1', system: 'macOS 15.3 (arm64)', apps: [{ name: 'Claude Code', version: '2.1.0' }], doctor: ['ok       Node 24 or newer.'] };
const fake = (prefix: string, length: number): string => prefix + 'Ab3x'.repeat(20).slice(0, length);

test('the guard replaces the home folder, the user name, the computer name, e-mail addresses and keys, and leaves other text as it is', () => {
  const secrets = [
    fake('ghp_', 36), fake('gho_', 36), fake('github_pat_', 60), fake('sk-ant-api03-', 40), fake('sk-proj-', 40),
    `AKIA${'ABCD2345EFGH6789'}`, fake('xoxb-', 30), fake('AIza', 35), fake(['sk', 'live', ''].join('_'), 24), fake('npm_', 36),
    `${fake('eyJ', 20)}.${fake('eyJ', 30)}.${fake('', 20)}`,
  ];
  const key = ['-----BEGIN OPENSSH PRIVATE KEY-----', fake('', 60), '-----END OPENSSH PRIVATE KEY-----'].join('\n');
  const text = [
    'I ran it in /Users/sam/work/app and in /Users/sam.',
    'Sam wrote this on Sams-Laptop.local, also called sams-laptop.',
    'Mail sam.lee@example.com or sam+issues@mail.example.org.',
    ...secrets.map((secret, at) => `Token ${at}: ${secret}`),
    key,
    'password: hunter2025, GITHUB_TOKEN=abc123def456ghi, api_key = "q1w2e3r4t5y6"',
  ].join('\n');
  const { text: clean, changed } = cleanText(text, who);
  assert.equal(clean, [
    'I ran it in <home>/work/app and in <home>.',
    '<user> wrote this on <computer>, also called <computer>.',
    'Mail <removed> or <removed>.',
    ...secrets.map((_, at) => `Token ${at}: <removed>`),
    '<removed>',
    'password: <removed>, GITHUB_TOKEN=<removed>, api_key = "<removed>"',
  ].join('\n'));
  assert.deepEqual(changed, [
    'a key or token → <removed> (12)',
    'a key or password after its name → <removed> (3)',
    'an e-mail address → <removed> (2)',
    'the home folder → <home> (2)',
    'the name of the computer → <computer> (2)',
    'the user name → <user> (1)',
  ]);
  for (const secret of [...secrets, 'sam.lee', '/Users/sam', 'Laptop']) assert.equal(clean.includes(secret), false, secret);

  // Text that must stay: versions, error text, doctor lines, words such as token and password, a folder that only starts like the home folder.
  const plain = [
    '### What I saw', '```', 'Error: The diagram "flow-1" has no node "start". Exit code 1.', '```',
    'ok       Node 24 or newer (the command runs on 24.22.1, the Node of the editor).',
    'The token expired at 12:00, and the password field was empty. Samples: /Users/samuel/x, the sample, react@18.3.1.',
    'Apostil 0.2.6 on https://github.com/example/app/issues/new?template=x.md, commit 86cda3d.',
  ].join('\n');
  assert.deepEqual(cleanText(plain, who), { text: plain, changed: [] });
  assert.equal(cleanText('another install (~/bin/apostil)', who).text, 'another install (<home>/bin/apostil)'); // the short form of doctor
});

test('the address of a new issue: the title and body encoded, no form and no labels, and a body that is too long is refused', () => {
  const issues = 'https://github.com/example/app/issues';
  const text = '### What I tried\nA & B # C + D 100% "é" in /Users/sam/x\n\n### What I saw\n```\nError: no\n```';
  const issue = prepareIssue({ kind: 'bug', title: 'Home: map & notes', text, facts, who, issues });
  assert.deepEqual(issue.problems, []);
  assert.doesNotMatch(issue.address, /[\s"#é]/); // no raw space, new line, quote, # or é
  assert.equal(issue.address.split('&').length, 2); // & only between the two fields
  const url = new URL(issue.address);
  assert.equal(`${url.origin}${url.pathname}`, `${issues}/new`);
  assert.deepEqual([...url.searchParams.keys()], ['title', 'body']); // no template (GitHub may show the form in place of the body), no labels (an error page for a person who may not add one)
  assert.equal(url.searchParams.get('title'), 'Home: map & notes');
  assert.equal(url.searchParams.get('body'), issue.body);
  assert.ok(issue.body.startsWith('### What I tried\nA & B # C + D 100% "é" in <home>/x\n'), issue.body);
  assert.match(issue.body, /\n### Facts\n\n- Apostil 1\.2\.3\n- VS Code 1\.145\.0\n- Node 24\.22\.1\n- macOS 15\.3 \(arm64\)\n- Agent apps: Claude Code 2\.1\.0\n/);
  assert.deepEqual(issue.changed, ['the home folder → <home> (1)']);

  // With no text, the headings of its kind stand empty above the facts.
  const empty = prepareIssue({ kind: 'feedback', title: '', text: '', facts, who, issues });
  assert.equal(new URL(empty.address).searchParams.get('template'), null);
  assert.ok(empty.body.startsWith('<!-- Leave out names, paths, the names of repos and branches, code and keys. -->\n\n### What I used Apostil for\n\n### What helped\n\n### What was in my way\n\n### What I missed\n\n### Facts\n'), empty.body);

  const long = prepareIssue({ kind: 'bug', title: 'Long', text: 'é'.repeat(MAX_ADDRESS / 6), facts, who, issues }); // é is 6 characters in the address
  assert.ok(long.address.length > MAX_ADDRESS);
  assert.match(long.problems[0], /too long for GitHub's address: \d+ characters, at most 8000\. Shorten the body/);
  assert.equal(issuesAddress(root), JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).bugs.url);
});

test('the two issue forms have the headings of the skill in the same order, and the label of their kind', () => {
  const skill = readFileSync(join(root, 'skills', 'apostil-report-issue', 'SKILL.md'), 'utf8');
  for (const kind of Object.keys(TEMPLATES) as IssueKind[]) {
    const form = readFileSync(join(root, '.github', 'ISSUE_TEMPLATE', TEMPLATES[kind]), 'utf8');
    assert.match(form, new RegExp(`^labels: ${kind}$`, 'm'));
    assert.deepEqual([...form.matchAll(/^### (.+)$/gm)].map((match) => match[1]), [...HEADINGS[kind], 'Facts']);
    assert.ok(skill.includes([...HEADINGS[kind], 'Facts'].join(' · ')), `the skill lists the headings of ${kind}`);
  }
});

test('apostil issue: --facts holds no home path and no user name, and --open opens the page of the repo of package.json', () => {
  const repo = makeTestRepo();
  const machine = testMachine();
  const ownBin = join(machine.home, 'bin'); // an apostil of another install in the home folder: doctor names its path
  mkdirSync(ownBin);
  for (const [name, script] of [['apostil', 'exit 0'], ['claude', 'echo "2.1.0 (Claude Code)"']]) {
    writeFileSync(join(ownBin, name), `#!/bin/sh\n${script}\n`);
    chmodSync(join(ownBin, name), 0o755);
  }
  const opened = join(tempFolder('apostil-browser-'), 'address');
  const browser = join(machine.path, 'browser');
  writeFileSync(browser, `#!/bin/sh\nprintf '%s' "$1" > '${opened}'\n`);
  chmodSync(browser, 0o755);
  const env = { ...process.env, HOME: machine.home, PATH: `${ownBin}:${machine.path}:/usr/bin:/bin`, APOSTIL_HOME: tempFolder('apostil-store-'), APOSTIL_BROWSER: browser, TERM_PROGRAM: '' };
  const apostil = (args: string[], input = '') => spawnSync(process.execPath, [cli, 'issue', ...args], { cwd: repo.folder, encoding: 'utf8', env, input });

  const run = apostil(['--facts']);
  assert.equal(run.status, 0, run.stdout + run.stderr);
  const got = JSON.parse(run.stdout) as Facts;
  assert.equal(got.apostil, thisInstall().version);
  assert.deepEqual(got.apps, [{ name: 'Claude Code', version: '2.1.0' }]);
  assert.ok(got.doctor.some((line) => line.includes('another install (<home>/bin/apostil)')), got.doctor.join('\n'));
  for (const secret of [machine.home, userInfo().username, hostname()]) assert.equal(run.stdout.includes(secret), false, secret);

  const sent = apostil(['--kind', 'bug', '--title', 'Notes: a note on the wrong lines', '--open'], `### What I tried\nOpened ${join(machine.home, 'work')}.\n`);
  assert.equal(sent.status, 0, sent.stdout + sent.stderr);
  for (let wait = 0; wait < 100 && !existsSync(opened); wait++) spawnSync('sleep', ['0.05']);
  const url = new URL(readFileSync(opened, 'utf8'));
  assert.equal(`${url.origin}${url.pathname}`, `${issuesAddress(root)}/new`);
  assert.equal(url.searchParams.get('title'), 'Notes: a note on the wrong lines');
  assert.ok(url.searchParams.get('body')?.startsWith('### What I tried\nOpened <home>/work.\n\n### Facts\n'));
  assert.equal(JSON.parse(sent.stdout).body, url.searchParams.get('body'));
  assert.equal(apostil(['--kind', 'other', '--title', 'x']).status, 1);
  repo.remove();
});

test('the guard keeps text that is not private: an SSH remote, the line after "pwd", and a common account name outside paths', () => {
  const plain = 'git@github.com:example/app.git fails\n$ pwd\n/opt/tools/app\nThe dev server and the test run.';
  assert.equal(cleanText(plain, { ...who, user: 'dev' }).text, plain);
  assert.equal(cleanText('/home/dev/app and dev@box', { home: '/home/dev', user: 'dev', computers: [] }).text, '<home>/app and <user>@box');
  assert.equal(cleanText('see file:///Users/sam%20x/a', { ...who, home: '/Users/sam x' }).text, 'see file://<home>/a');
  const gitlab = ['glpat', 'x'.repeat(24)].join('-');
  assert.equal(cleanText(`token ${gitlab} and https://me:secret@example.org/x`, who).text, 'token <removed> and https://<removed>@example.org/x');
});

test('a text far over the limit is refused before the guard reads it', () => {
  const issue = prepareIssue({ kind: 'bug', title: 'Long', text: 'a'.repeat(5 * MAX_ADDRESS), facts, who, issues: 'https://github.com/example/app/issues' });
  assert.equal(issue.address, '');
  assert.match(issue.problems[0], /too long/);
});
