// Tests for links of the file system: a link is one path, and no command reads through it.
// Also the skills of setup when .claude/skills is a link to another folder of the repo.

import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { git } from '../shared/git';
import { Store } from '../shared/store';
import { makeTestRepo, tempFolder, testChangeFile, testMachine } from '../shared/test-repo';
import { mapMaterial } from './map-material';
import { changeMaterial } from './material';
import { checkDraft, saveDraft } from './save';
import { setup, skillNames, thisInstall } from './setup';

const status = (folder: string): string => git(folder, 'status', '--porcelain', '--untracked-files=all');

/** The test repo with a tracked link to a folder, and then a link to a folder and a link to a file that Git does not track. All three sit in a folder, so the map material lists them among its largest files. */
function repoWithLinks() {
  const repo = makeTestRepo();
  mkdirSync(join(repo.folder, 'tools'));
  symlinkSync('../src', join(repo.folder, 'tools', 'tracked-link'));
  repo.commit('a tracked link to a folder');
  symlinkSync('../src', join(repo.folder, 'tools', 'folder-link'));
  symlinkSync('../src/app.py', join(repo.folder, 'tools', 'file-link'));
  return repo;
}

test('material, map-material, check and save work in a repo with links to a folder and a file, tracked or not, and setup works when .claude/skills is a link', () => {
  const store = new Store(tempFolder('apostil-home-'));
  const repo = repoWithLinks();

  const material = changeMaterial(store, repo.folder);
  const files = Object.fromEntries(material.files.map((file) => [file.path, file]));
  assert.equal(files['tools/tracked-link'].added, 1); // one line: the path that it points at, as Git keeps a link
  assert.equal(files['tools/folder-link'].added, 1);
  assert.equal(files['tools/file-link'].added, 1);

  const map = mapMaterial(store, repo.folder);
  const tools = map.folders.find((folder) => folder.path === 'tools/');
  assert.deepEqual(tools?.largest.map((file) => file.lines), [1, 1, 1]);

  const draft = { ...testChangeFile(), parts: [...testChangeFile().parts, { id: 'links', name: 'Links', files: ['tools/tracked-link', 'tools/folder-link', 'tools/file-link'] }] };
  const checked = checkDraft(repo.folder, draft, repo.base);
  assert.deepEqual(checked.problems, []);
  assert.deepEqual(checked.checks?.filesInNoPart, []);
  assert.equal(saveDraft(store, repo.folder, draft).saved, true);
  store.close();
  repo.remove();

  // Setup keeps its copies out of Git when .claude/skills is a tracked link to another folder of the repo, and --undo takes the lines away.
  const skills = makeTestRepo();
  mkdirSync(join(skills.folder, 'agent', 'skills'), { recursive: true });
  skills.write('agent/skills/README.md', 'Our own skills.\n');
  mkdirSync(join(skills.folder, '.claude'));
  symlinkSync('../agent/skills', join(skills.folder, '.claude', 'skills'));
  skills.commit('skills in a folder of their own');
  const exclude = join(skills.folder, '.git', 'info', 'exclude');
  const before = readFileSync(exclude, 'utf8');
  const install = thisInstall();
  setup({ install, machine: testMachine({ claude: 'folder' }), repo: skills.folder });
  assert.equal(readFileSync(join(skills.folder, 'agent', 'skills', 'apostil-map-repo', 'SKILL.md'), 'utf8').length > 0, true);
  assert.equal(status(skills.folder), '');
  for (const name of skillNames(install)) assert.ok(readFileSync(exclude, 'utf8').split('\n').includes(`agent/skills/${name}/`));
  setup({ install, machine: testMachine({ claude: 'folder' }), repo: skills.folder, undo: true });
  assert.equal(readFileSync(exclude, 'utf8'), before);
  assert.equal(status(skills.folder), '');
  skills.remove();
});
