// Tests for the order and the readiness of the work of a map run: note-groups, process-groups and mark-groups list their groups
// largest first, and the groups of the service and mark writers of an area are ready as soon as the notes of that area are saved.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Note } from '../shared/change-file';
import { repoId } from '../shared/git';
import { readyMarkGroups } from '../shared/marks';
import { groupProcessFacts, noteGroups, readyProcessGroups } from '../shared/note-groups';
import type { RepoMap } from '../shared/repo-map';
import { Store } from '../shared/store';
import { makeTestRepo, runApostil, tempFolder } from '../shared/test-repo';
import { addNotesToMap, saveMapDraft } from './save';

// Two areas: "code" with one small file, "lib" with a file of 500 lines (a notes group of its own) and one of 150. Both areas reach a service.
const BIG = ['import httpx', 'def fetch():', '    return httpx.get("https://feed.example.org/new")', ...Array.from({ length: 497 }, (_, at) => `x_${at} = ${at}`)].join('\n') + '\n';
const MID = Array.from({ length: 150 }, (_, at) => `y_${at} = ${at}`).join('\n') + '\n';
const SMALL = ['import httpx', 'def ping():', '    return httpx.get("https://ping.example.org/")', ...Array.from({ length: 17 }, (_, at) => `z_${at} = ${at}`)].join('\n') + '\n';

const note = (file: string, lines: [number, number], title: string): Note => ({ file, lines, title, text: 'Does the work of this step.' });

function setUp() {
  const repo = makeTestRepo();
  repo.write('lib/big.py', BIG);
  repo.write('lib/mid.py', MID);
  repo.write('src/small.py', SMALL);
  repo.commit('two areas');
  const home = tempFolder('apostil-home-');
  const store = new Store(home);
  const map: RepoMap = { format: 1, diagrams: [{ id: 'top', kind: 'flow', title: 'Top', mermaid: 'flowchart LR\n  code["Code"] --> lib["Lib"]', nodePaths: { code: ['src/'], lib: ['lib/'] } }] };
  assert.equal(saveMapDraft(store, repo.folder, map).saved, true);
  const stored = () => store.getMap(repoId(repo.folder))!;
  // The other code files of the test repo have no code worth a note, so that only these three need notes.
  const others = noteGroups(repo.folder, stored()).groups.flatMap((group) => group.files.map((file) => file.path)).filter((path) => !['lib/big.py', 'lib/mid.py', 'src/small.py'].includes(path));
  assert.equal(addNotesToMap(store, repo.folder, { notes: [], files: others }).saved, true);
  const printed = (args: string[]) => JSON.parse(runApostil([...args, '--folder', repo.folder], { env: { APOSTIL_HOME: home } }).stdout);
  return { repo, store, stored, printed };
}

test('note-groups, process-groups and mark-groups list their groups largest first: lines of code for notes and marks, notes for processes', () => {
  const { repo, store, stored, printed } = setUp();
  // The notes groups: the file of 500 lines first, though its area comes second in the top diagram.
  const notes = noteGroups(repo.folder, stored()).groups;
  assert.deepEqual(notes.map((group) => [group.area, group.lines]), [['lib', 500], ['lib', 150], ['code', 20]]);
  assert.deepEqual(printed(['note-groups']).groups.map((group: { lines: number }) => group.lines), [500, 150, 20]);
  // With all notes saved: the process group of "lib" (3 notes) before the one of "code" (1 note).
  assert.equal(addNotesToMap(store, repo.folder, { notes: [note('lib/big.py', [2, 3], 'Fetch the feed'), note('lib/big.py', [4, 5], 'Set the first values'), note('lib/mid.py', [1, 2], 'Set the values'), note('src/small.py', [2, 3], 'Ping the site')] }).saved, true);
  assert.deepEqual(readyProcessGroups(repo.folder, stored()).groups.map((group) => [group.area, group.notes]), [['lib', 3], ['code', 1]]);
  assert.deepEqual(printed(['process-groups']).groups.map((group: { area: string }) => group.area), ['lib', 'code']);
  // The groups of the services and of a set of a look: "lib" (its two files) before "code" (its small file and the files of the test repo).
  assert.deepEqual(readyMarkGroups(repo.folder, stored(), 'services').groups.map((group) => group.area), ['lib', 'code']);
  assert.deepEqual(readyMarkGroups(repo.folder, stored(), 'checks').groups.map((group) => [group.area, group.files.reduce((sum, file) => sum + file.lines, 0)]), [['lib', 652], ['code', 31]]);
  assert.deepEqual(printed(['mark-groups', '--set', 'services']).groups.map((group: { area: string }) => group.area), ['lib', 'code']);
  store.close();
  repo.remove();
});

test('the groups of the service and mark writers of an area are ready as soon as the notes of that area are saved, and mark-groups says how many areas still wait', () => {
  const { repo, store, stored, printed } = setUp();
  // Before any notes: every area waits, and no group of marks is ready.
  assert.deepEqual([readyMarkGroups(repo.folder, stored(), 'services').groups, readyMarkGroups(repo.folder, stored(), 'services').waiting], [[], 2]);
  // The notes of "code" are saved, those of "lib" not yet: only the groups of "code" are ready, for the services and for a set of a look.
  assert.equal(addNotesToMap(store, repo.folder, { notes: [note('src/small.py', [2, 3], 'Ping the site')] }).saved, true);
  const services = readyMarkGroups(repo.folder, stored(), 'services');
  assert.deepEqual([services.groups.map((group) => group.area), services.waiting], [['code'], 1]);
  assert.deepEqual(readyMarkGroups(repo.folder, stored(), 'checks').groups.map((group) => group.area), ['code']);
  const shown = printed(['mark-groups', '--set', 'services']);
  assert.deepEqual([shown.groups.map((group: { area: string }) => group.area), shown.waiting], [['code'], 1]);
  // When the notes of "lib" are saved, its groups are ready too, and no area waits.
  assert.equal(addNotesToMap(store, repo.folder, { notes: [note('lib/big.py', [2, 3], 'Fetch the feed'), note('lib/mid.py', [1, 2], 'Set the values')] }).saved, true);
  const all = readyMarkGroups(repo.folder, stored(), 'services');
  assert.deepEqual([all.groups.map((group) => group.area), all.waiting], [['lib', 'code'], 0]);
  store.close();
  repo.remove();
});

test('processes --group gives the check of one group: the notes of its files in no process, its stale processes, and whether it needs a second round', () => {
  const { repo, store, stored, printed } = setUp();
  assert.equal(addNotesToMap(store, repo.folder, { notes: [note('lib/big.py', [2, 3], 'Fetch the feed'), note('lib/mid.py', [1, 2], 'Set the values'), note('src/small.py', [2, 3], 'Ping the site')] }).saved, true);
  const [lib, code] = readyProcessGroups(repo.folder, stored()).groups;
  // No process yet: every note of the group is in no process, and the group needs a second round; the other group is not counted.
  const facts = groupProcessFacts(stored().map, lib.name)!;
  assert.deepEqual([facts.processes, facts.notInProcess.count, facts.notInProcess.files.map((file) => file.file), facts.again], [0, 2, ['lib/big.py', 'lib/mid.py'], true]);
  assert.deepEqual(printed(['processes', '--group', code.name]).notInProcess.files.map((file: { file: string }) => file.file), ['src/small.py']);
  // An unknown group is a problem that says where the names are.
  assert.match(JSON.stringify(printed(['processes', '--group', 'no-such-group'])), /No group of the process writers is named \\"no-such-group\\"/);
  store.close();
  repo.remove();
});
