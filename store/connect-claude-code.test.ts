// Tests for the hook that connects Claude Code: what is added to a settings file, what stays, and what Git lists.

import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { git } from '../shared/git';
import { makeTestRepo, runApostil, tempFolder } from '../shared/test-repo';
import { addAllowRules, addWaitHook, removeWaitHook, settingsFile } from './connect-claude-code';

const read = (file: string) => JSON.parse(readFileSync(file, 'utf8'));
const commands = (settings: any, event: string): string[] => settings.hooks[event].flatMap((group: any) => group.hooks.map((hook: any) => hook.command));

test('the hook goes into an empty settings file as the page about it shows it, a second time adds nothing, what a settings file holds stays, and a file in another form is not changed', () => {
  const empty = join(tempFolder('apostil-settings-'), '.claude', 'settings.json');
  assert.deepEqual(addWaitHook(empty), { file: empty, added: true });
  const page = readFileSync(join(__dirname, '..', '..', 'skills', 'connect-claude-code.md'), 'utf8');
  assert.deepEqual(read(empty), JSON.parse(/```json\n([\s\S]*?)```/.exec(page)![1]));
  assert.deepEqual(addWaitHook(empty), { file: empty, added: false });
  assert.deepEqual(commands(read(empty), 'Stop'), ['apostil inbox --wait']);

  const file = join(tempFolder('apostil-settings-'), 'settings.json');
  writeFileSync(file, JSON.stringify({ permissions: { allow: ['Bash(npm test)'] }, hooks: { Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }] } }));
  assert.equal(addWaitHook(file).added, true);
  const settings = read(file);
  assert.deepEqual(settings.permissions, { allow: ['Bash(npm test)'] });
  assert.deepEqual(commands(settings, 'Stop'), ['say done', 'apostil inbox --wait']);
  assert.deepEqual(commands(settings, 'SessionStart'), ['apostil inbox --wait']);
  for (const text of ['not json', '[]', '{ "hooks": { "Stop": "x" } }']) {
    writeFileSync(file, text);
    const result = addWaitHook(file);
    assert.equal(result.added, false);
    assert.match(result.problem ?? '', /Nothing was changed/);
    assert.equal(readFileSync(file, 'utf8'), text);
  }
});

test('taking the hook out keeps a hook of the person that stands in the same group', () => {
  const file = join(tempFolder('apostil-settings-'), 'settings.json');
  const mine = { type: 'command', command: 'say done' };
  writeFileSync(file, JSON.stringify({ hooks: { Stop: [{ hooks: [mine, { type: 'command', command: 'apostil inbox --wait' }] }], SessionStart: [{ hooks: [{ type: 'command', command: 'apostil inbox --wait' }] }] } }));
  assert.equal(removeWaitHook(file), true);
  assert.deepEqual(read(file), { hooks: { Stop: [{ hooks: [mine] }] } });
});

test('apostil connect: for the repo the hook goes into its own settings file, which Git does not list as new; for every repo with --all-repos into the settings of the person', () => {
  const repo = makeTestRepo();
  const home = tempFolder('apostil-user-');
  mkdirSync(join(home, '.claude'));
  writeFileSync(join(home, '.claude', 'settings.json'), '{ "model": "made-up" }');
  const apostil = (...args: string[]) => runApostil(['connect', ...args, '--folder', repo.folder], { env: { HOME: home, APOSTIL_HOME: tempFolder('apostil-home-') } });
  const file = settingsFile(repo.folder);
  assert.equal(file, join(repo.folder, '.claude', 'settings.local.json'));
  const before = git(repo.folder, 'status', '--porcelain');
  const first = JSON.parse(apostil().stdout);
  assert.deepEqual([first.file, first.added], [file, true]);
  assert.match(first.note, /not yet seen working in a session with a person/);
  assert.deepEqual(commands(read(file), 'SessionStart'), ['apostil inbox --wait']);
  assert.equal(git(repo.folder, 'status', '--porcelain'), before);

  const all = apostil('--all-repos');
  assert.deepEqual([all.status, JSON.parse(all.stdout).file], [0, join(home, '.claude', 'settings.json')]);
  assert.equal(read(join(home, '.claude', 'settings.json')).model, 'made-up');
  assert.equal(JSON.parse(apostil('--all-repos').stdout).added, false);
  writeFileSync(join(home, '.claude', 'settings.json'), 'broken');
  assert.equal(apostil('--all-repos').status, 1);
  repo.remove();
});

test('rules that allow commands go into the permissions of a settings file of Claude Code, each once, and everything else stays', () => {
  const file = join(tempFolder('apostil-settings-'), '.claude', 'settings.local.json');
  assert.deepEqual(addAllowRules(file, ['Bash(git ls-files *)']).added, ['Bash(git ls-files *)']);
  assert.deepEqual(read(file), { permissions: { allow: ['Bash(git ls-files *)'] } });
  writeFileSync(file, JSON.stringify({ model: 'opus', permissions: { allow: ['Read'], deny: ['WebFetch'] }, hooks: { Stop: [] } }));
  assert.deepEqual(addAllowRules(file, ['Read', 'Bash(apostil *)']).added, ['Bash(apostil *)']);
  assert.deepEqual(read(file), { model: 'opus', permissions: { allow: ['Read', 'Bash(apostil *)'], deny: ['WebFetch'] }, hooks: { Stop: [] } });
  assert.deepEqual(addAllowRules(file, ['Read']).added, []);
  writeFileSync(file, 'not json');
  assert.match(addAllowRules(file, ['Read']).problem ?? '', /is not in the form of a settings file of Claude Code\. Nothing was changed\./);
  assert.equal(readFileSync(file, 'utf8'), 'not json');
});
