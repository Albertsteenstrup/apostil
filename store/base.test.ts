// Tests for --base: on a main branch, a change can be the commits after a named commit.

import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type { ChangeFile } from '../shared/change-file';
import { git, repoId } from '../shared/git';
import { notesInRepo } from '../shared/notes-beside-code';
import { Store } from '../shared/store';
import { makeTestRepo, runApostil, tempFolder } from '../shared/test-repo';

const twoCommits = (): ChangeFile => ({
  format: 1, title: 'Adds a stop and a log', reason: 'The app needs a way to stop, and a log.',
  parts: [{ id: 'app', name: 'App', files: ['src/app.py', 'src/log.py'], notes: [{ file: 'src/log.py', lines: [1, 2], title: 'Write one line' }] }],
  links: [],
});

test('--base on a main branch with two commits: the change is both commits, the save keeps the base, later commands need no option, and a commit that is no earlier commit is refused', () => {
  const repo = makeTestRepo();
  const feature = git(repo.folder, 'rev-parse', 'HEAD');
  git(repo.folder, 'checkout', '-q', 'main');
  const home = tempFolder('apostil-home-');
  const apostil = (...args: string[]) => {
    const run = runApostil([...args, '--folder', repo.folder], { env: { APOSTIL_HOME: home } });
    return { status: run.status, out: JSON.parse(run.stdout) };
  };
  const before = git(repo.folder, 'rev-parse', 'HEAD');
  repo.write('src/app.py', 'def start():\n    return 1\n\n\ndef stop():\n    return 0\n');
  repo.commit('stop');
  repo.write('src/log.py', 'def log(text):\n    print(text)\n');
  repo.commit('log');

  // With no option, a main branch with nothing uncommitted has no change.
  const nothing = apostil('material').out;
  assert.deepEqual(nothing.files, []);
  assert.match(nothing.hint, /notes on the code as it is: they come with the map and need no commit .*--base HEAD~1 for the latest commit/); // so that an agent does not ask the owner for a commit when he asked for notes
  const material = apostil('material', '--base', 'HEAD~2');
  assert.equal(material.out.base, before);
  assert.deepEqual(material.out.files.map((file: { path: string }) => file.path).sort(), ['src/app.py', 'src/log.py']);

  // A commit of another branch and a name that is no commit: one sentence.
  for (const commit of [feature, 'no-such-commit']) {
    const refused = apostil('material', '--base', commit);
    assert.equal(refused.status, 1);
    assert.match(refused.out.problems[0], /is no earlier commit of the branch main\. Give a commit that "git log --oneline" lists/);
  }

  const draft = join(tempFolder('apostil-draft-'), 'draft.json');
  writeFileSync(draft, JSON.stringify(twoCommits()));
  const checked = apostil('check', draft, '--base', 'HEAD~2');
  assert.equal(checked.status, 0);
  assert.deepEqual(checked.out.checks.filesInNoPart, []);
  assert.equal(apostil('save', draft, '--base', 'HEAD~2').out.saved, true);

  // The stored change holds the base: the later commands give the same change with no option.
  assert.equal(apostil('material').out.base, before);
  assert.equal(apostil('check', draft).out.checks.filesNotChanged.length, 0);
  assert.equal(apostil('for-check').out.ranges[0].code[0], '1: def log(text):');
  const [row] = apostil('list').out;
  assert.equal(row.branch, 'main');
  assert.equal(row.commits, 2);
  repo.remove();
});

test('a description of a later commit on a main branch takes the place of the one before it, and the notes of that one still stand beside their code', () => {
  const repo = makeTestRepo();
  git(repo.folder, 'checkout', '-q', 'main');
  const home = tempFolder('apostil-home-');
  const save = (file: ChangeFile) => {
    const draft = join(tempFolder('apostil-draft-'), 'draft.json');
    writeFileSync(draft, JSON.stringify(file));
    return JSON.parse(runApostil(['save', draft, '--base', 'HEAD~1', '--folder', repo.folder], { env: { APOSTIL_HOME: home } }).stdout);
  };
  const logFile: ChangeFile = { format: 1, title: 'Adds a log', reason: 'The app needs a log.', parts: [{ id: 'log', name: 'Log', files: ['src/log.py'], notes: [{ file: 'src/log.py', lines: [1, 2], title: 'Write one line' }] }], links: [] };
  repo.write('src/app.py', 'def start():\n    return 1\n\n\ndef stop():\n    return 0\n');
  repo.commit('stop');
  assert.equal(save({ format: 1, title: 'Adds a stop', reason: 'The app needs a way to stop.', parts: [{ id: 'app', name: 'App', files: ['src/app.py'], notes: [{ file: 'src/app.py', lines: [5, 6], title: 'Stop returns zero' }] }], links: [] }).saved, true);
  repo.write('src/log.py', 'def log(text):\n    print(text)\n');
  repo.commit('log');
  assert.equal(save(logFile).saved, true);
  assert.equal(save(logFile).saved, true); // the same commit again: this description takes the place of its own notes, and nothing more is kept

  const store = new Store(home);
  const titles = (path: string) => notesInRepo(store, repo.folder, path, readFileSync(join(repo.folder, path), 'utf8')).notes.map((found) => found.note.title);
  assert.deepEqual(titles('src/log.py'), ['Write one line']);
  assert.deepEqual(titles('src/app.py'), ['Stop returns zero']); // from the description that the later one replaced
  assert.equal(store.keptNotes(repoId(repo.folder)).length, 1);
  assert.equal(store.listChanges(repoId(repo.folder)).length, 1);
  store.close();
  repo.remove();
});
