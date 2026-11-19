// Tests for "apostil setup": the skills (and no hook) for one repo or for all repos, a second run, an older copy, a folder of someone else, and --undo.
// Each test gives setup a home folder and a path of its own.

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { git } from '../shared/git';
import { makeTestRepo, runApostil, tempFolder, testMachine } from '../shared/test-repo';
import { connectClaudeCode } from './connect-claude-code';
import { hasOlderCopy, NEXT_STEP, setup, skillNames, someAppSeesSkills, thisInstall, VERSION_FILE } from './setup';

const install = thisInstall();
const names = skillNames(install);

const words = (lines: string[]): string[] => lines.filter(Boolean).map((line) => line.split(' ')[0]);
const status = (folder: string): string => git(folder, 'status', '--porcelain', '--untracked-files=all');
const exclude = (folder: string): string => readFileSync(join(folder, '.git', 'info', 'exclude'), 'utf8');

test('setup for a repo: the skills that ship with the install for each app that is there, none for an app that is not, no hook, Git shows no change, and a second run does no harm', () => {
  assert.deepEqual(names, ['apostil-describe-change', 'apostil-map-repo', 'apostil-read-diagrams', 'apostil-report-issue', 'apostil-review-remarks', 'apostil-uninstall']);
  const repo = makeTestRepo();
  const machine = testMachine({ claude: 'command', codex: 'folder' });
  const before = status(repo.folder);
  const { lines, ok } = setup({ install, machine, repo: repo.folder });
  assert.equal(ok, true);
  assert.deepEqual(words(lines), [...Array(names.length * 2).fill('added'), 'skipped', 'Now']);
  assert.equal(lines.at(-1), NEXT_STEP);
  for (const folder of ['.claude/skills', '.agents/skills']) {
    for (const name of names) {
      assert.equal(readFileSync(join(repo.folder, folder, name, 'SKILL.md'), 'utf8'), readFileSync(join(install.skills, name, 'SKILL.md'), 'utf8'));
      assert.equal(readFileSync(join(repo.folder, folder, name, VERSION_FILE), 'utf8').trim(), install.version);
    }
  }
  assert.equal(existsSync(join(repo.folder, '.claude', 'settings.local.json')), false); // setup adds no hook
  assert.equal(status(repo.folder), before);
  assert.deepEqual(readdirSync(machine.home).sort(), ['.apostil', '.codex']); // in the home folder only the record of the store
  assert.deepEqual(JSON.parse(readFileSync(join(machine.home, '.apostil', 'repos-set-up.json'), 'utf8')), [repo.folder]);

  // A second run does no harm: everything is there, and the exclude file gets no line twice.
  const kept = exclude(repo.folder);
  const again = setup({ install, machine, repo: repo.folder });
  assert.deepEqual(words(again.lines), [...Array(names.length * 2).fill('there'), 'skipped', 'Now']);
  assert.equal(exclude(repo.folder), kept);
  assert.equal(status(repo.folder), before);

  // With Claude Code only, Codex only, Antigravity only, or no app.
  const claudeOnly = makeTestRepo();
  const claude = setup({ install, machine: testMachine({ claude: 'folder' }), repo: claudeOnly.folder });
  assert.deepEqual(words(claude.lines), [...Array(names.length).fill('added'), 'skipped', 'skipped', 'Now']);
  assert.equal(existsSync(join(claudeOnly.folder, '.agents')), false);
  const codexOnly = makeTestRepo();
  const codex = setup({ install, machine: testMachine({ codex: 'command' }), repo: codexOnly.folder });
  assert.deepEqual(words(codex.lines), ['skipped', ...Array(names.length).fill('added'), 'skipped', 'Now']);
  assert.equal(existsSync(join(codexOnly.folder, '.claude')), false); // no skills and no hook for Claude Code
  const agyOnly = makeTestRepo();
  const agy = setup({ install, machine: testMachine({ agy: 'command' }), repo: agyOnly.folder });
  assert.deepEqual(words(agy.lines), ['skipped', 'skipped', ...Array(names.length).fill('added'), 'Now']);
  assert.equal(existsSync(join(agyOnly.folder, '.agents', 'skills', 'apostil-map-repo', 'SKILL.md')), true);
  assert.equal(status(agyOnly.folder), '');
  const none = makeTestRepo();
  const nothing = setup({ install, machine: testMachine(), repo: none.folder });
  assert.equal(nothing.ok, false);
  assert.deepEqual(words(nothing.lines), ['skipped', 'skipped', 'skipped', 'missing']);
  assert.equal(status(none.folder), '');
  for (const one of [repo, claudeOnly, codexOnly, agyOnly, none]) one.remove();
});

test('setup for a repo keeps the draft files out of the list of new files, and --undo takes away what setup added and nothing else', () => {
  const repo = makeTestRepo();
  const machine = testMachine({ claude: 'command', codex: 'command' });
  const foreign = join(repo.folder, '.agents', 'skills', 'apostil-map-repo');
  mkdirSync(foreign, { recursive: true });
  writeFileSync(join(foreign, 'SKILL.md'), 'mine');
  mkdirSync(join(repo.folder, '.claude'));
  writeFileSync(join(repo.folder, '.claude', 'settings.local.json'), '{ "permissions": { "allow": ["Bash(ls)"] } }');
  writeFileSync(join(repo.folder, '.git', 'info', 'exclude'), '# mine\n.claude/settings.local.json\n.agents/skills/apostil-map-repo/\n');
  const before = { status: status(repo.folder), exclude: exclude(repo.folder) };

  setup({ install, machine, repo: repo.folder });
  connectClaudeCode(repo.folder, machine.home); // setup adds no hook; this one is from an earlier version
  const { lines } = setup({ install, machine, repo: repo.folder, undo: true });
  assert.deepEqual(words(lines), [...names.map(() => 'removed'), ...names.map((name) => (name === 'apostil-map-repo' ? 'left' : 'removed')), 'removed']);
  assert.deepEqual(JSON.parse(readFileSync(join(repo.folder, '.claude', 'settings.local.json'), 'utf8')), { permissions: { allow: ['Bash(ls)'] } });
  assert.equal(readFileSync(join(foreign, 'SKILL.md'), 'utf8'), 'mine');
  assert.equal(existsSync(join(repo.folder, '.claude', 'skills')), false);
  assert.equal(status(repo.folder), before.status);
  assert.equal(exclude(repo.folder), before.exclude);
  assert.deepEqual(setup({ install, machine, repo: repo.folder, undo: true }).lines, ['left     .agents/skills/apostil-map-repo: Apostil did not put it there, so it stays as it is.'.replace('.agents', join(repo.folder, '.agents'))]);

  // In a repo where setup made every folder, the draft files stay out of the list of new files, and undo leaves the repo as it was.
  const clean = makeTestRepo();
  const cleanBefore = exclude(clean.folder);
  setup({ install, machine, repo: clean.folder });
  const drafts = ['apostil-draft.json', 'apostil-points-app.json', 'apostil-points.json', 'apostil-map.json', 'apostil-diagram-one.json', 'apostil-notes-utils-1.json'];
  for (const name of drafts) writeFileSync(join(clean.folder, name), '{}');
  assert.equal(status(clean.folder), '');
  setup({ install, machine, repo: clean.folder });
  assert.equal(exclude(clean.folder).split('\n').filter((text) => text === '/apostil-draft.json').length, 1);
  setup({ install, machine, repo: clean.folder, undo: true });
  assert.equal(exclude(clean.folder), cleanBefore);
  assert.equal(status(clean.folder).split('\n').length, drafts.length);
  assert.equal(existsSync(join(clean.folder, '.claude')), false);
  assert.equal(existsSync(join(clean.folder, '.agents')), false);
  assert.equal(exclude(clean.folder).includes('apostil'), false);
  assert.equal(exclude(clean.folder).includes('.claude'), false);
  repo.remove();
  clean.remove();
});

test('an older copy is brought up to date, a folder that Apostil did not put there stays, and the list asks whether an app sees the skills and whether an older copy is there', () => {
  const repo = makeTestRepo();
  const machine = testMachine({ claude: 'folder' });
  setup({ install, machine, repo: repo.folder });
  const old = join(repo.folder, '.claude', 'skills', 'apostil-describe-change');
  writeFileSync(join(old, VERSION_FILE), '0.0.1\n');
  writeFileSync(join(old, 'gone.md'), 'a file of the old version');
  const foreign = join(repo.folder, '.claude', 'skills', 'apostil-read-diagrams');
  rmSync(join(foreign, VERSION_FILE)); // with no version file, the folder is someone else's
  writeFileSync(join(foreign, 'SKILL.md'), 'mine');
  const { lines } = setup({ install, machine, repo: repo.folder });
  assert.ok(lines.includes(`updated  Claude Code: the skill apostil-describe-change in ${join(repo.folder, '.claude', 'skills')} (was 0.0.1)`), lines.join('\n'));
  assert.ok(lines.some((line) => line.startsWith('left') && line.includes('apostil-read-diagrams') && line.includes('Apostil did not put it there')));
  assert.equal(existsSync(join(old, 'gone.md')), false);
  assert.equal(readFileSync(join(old, VERSION_FILE), 'utf8').trim(), install.version);
  assert.equal(readFileSync(join(foreign, 'SKILL.md'), 'utf8'), 'mine');

  // What the list and VS Code ask: does an app see the skills, and is a copy of an older version there.
  const other = makeTestRepo();
  const codex = testMachine({ codex: 'command' });
  assert.equal(someAppSeesSkills(install, codex, other.folder), false);
  setup({ install, machine: codex });
  assert.equal(someAppSeesSkills(install, codex, other.folder), true); // for all repos counts for this repo too
  assert.equal(someAppSeesSkills(install, testMachine(), other.folder), false); // no app on the machine
  assert.equal(hasOlderCopy(install, codex), false);
  writeFileSync(join(codex.home, '.agents', 'skills', 'apostil-read-diagrams', VERSION_FILE), '0.0.1\n');
  assert.equal(hasOlderCopy(install, codex), true);
  assert.equal(hasOlderCopy(install, codex, other.folder), false);
  repo.remove();
  other.remove();
});

test('setup --all puts the skills, and no hook, into the home folder and leaves the repo alone', () => {
  const machine = testMachine({ claude: 'command', codex: 'command', agy: 'command' });
  mkdirSync(join(machine.home, '.claude'));
  writeFileSync(join(machine.home, '.claude', 'settings.json'), '{ "model": "made-up" }');
  const { lines, ok } = setup({ install, machine });
  assert.equal(ok, true);
  assert.ok(lines.includes(`added    Claude Code: the skill apostil-map-repo in ~/.claude/skills`), lines.join('\n'));
  assert.ok(lines.includes(`added    Codex: the skill apostil-map-repo in ~/.agents/skills`));
  assert.ok(lines.includes(`added    Antigravity: the skill apostil-map-repo in ~/.gemini/config/skills`));
  assert.equal(lines.some((one) => one.includes('hook')), false);
  assert.deepEqual(JSON.parse(readFileSync(join(machine.home, '.claude', 'settings.json'), 'utf8')), { model: 'made-up' });
  connectClaudeCode(undefined, machine.home); // a hook from an earlier version, or from the step of its own

  const undone = setup({ install, machine, undo: true });
  assert.deepEqual(words(undone.lines), Array(names.length * 3 + 1).fill('removed')); // the skills of all three apps and the hook
  assert.deepEqual(JSON.parse(readFileSync(join(machine.home, '.claude', 'settings.json'), 'utf8')), { model: 'made-up' });
  assert.deepEqual(readdirSync(machine.home).sort(), ['.claude']);
  assert.deepEqual(readdirSync(join(machine.home, '.claude')), ['settings.json']);
});

test('apostil setup and apostil --version on the command line', () => {
  const repo = makeTestRepo();
  const machine = testMachine({ claude: 'command' });
  const env = { HOME: machine.home, PATH: `${machine.path}:/usr/bin:/bin`, APOSTIL_HOME: tempFolder('apostil-store-') };
  const apostil = (...args: string[]) => runApostil(args, { cwd: repo.folder, env });
  const done = apostil('setup');
  assert.equal(done.status, 0, done.stdout + done.stderr);
  assert.match(done.stdout, /added    Claude Code: the skill apostil-describe-change in .*\.claude\/skills/);
  assert.equal(done.stdout.trim().split('\n').at(-1), NEXT_STEP);
  assert.equal(apostil('--version').stdout.trim(), install.version);
  const home = runApostil(['setup'], { cwd: machine.home, env });
  assert.equal(home.status, 1);
  assert.match(home.stdout, /not in a Git repo/);
  assert.equal(apostil('setup', '--undo').status, 0);
  assert.equal(existsSync(join(repo.folder, '.claude')), false);
  repo.remove();
});
