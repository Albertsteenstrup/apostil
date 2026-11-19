// Tests for the notes of files: add-notes, note-groups, notes, and how the notes of files stand beside the code.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Note } from '../shared/change-file';
import { fileText, lineCount, repoId } from '../shared/git';
import { noteGroups } from '../shared/note-groups';
import { fromWords, notesInRepo } from '../shared/notes-beside-code';
import type { RepoMap } from '../shared/repo-map';
import { Store } from '../shared/store';
import { makeTestRepo, runApostil, tempFolder } from '../shared/test-repo';
import { addDiagramToMap, addNotesToMap, saveMapDraft } from './save';

const topMap = (): RepoMap => ({
  format: 1,
  diagrams: [{ id: 'top', kind: 'flow', title: 'The test repo', mermaid: 'flowchart LR\n  code --> docs', nodePaths: { code: ['src/'], docs: ['README.md'] } }],
});

const note = (file: string, lines: [number, number], title: string, text = 'It does the work.'): Note => ({ file, lines, title, text });

/** A repo with a saved map and two python files of 12 and 6 lines on main. */
function setup() {
  const repo = makeTestRepo();
  repo.write('src/app.py', Array.from({ length: 12 }, (_, at) => `line_${at + 1} = ${at + 1}`).join('\n') + '\n');
  repo.write('src/tool.py', 'def tool():\n    a = 1\n    b = 2\n    return a + b\n\n\nTOOL = tool()\n');
  repo.commit('files');
  const store = new Store(tempFolder('apostil-home-'));
  assert.equal(saveMapDraft(store, repo.folder, topMap()).saved, true);
  return { repo, store, id: repoId(repo.folder), done: () => (store.close(), repo.remove()) };
}

test('add-notes saves notes by file, replaces only the files it names, keeps the others after two saves, and a range replaces only the notes inside its lines', () => {
  const { repo, store, id, done } = setup();
  const first = addNotesToMap(store, repo.folder, { notes: [note('src/app.py', [1, 6], 'Set the first values'), note('src/app.py', [7, 12], 'Set the last values')] });
  assert.deepEqual(first, { saved: true, problems: [], notes: 2, files: 1 });
  const second = addNotesToMap(store, repo.folder, { notes: [note('src/tool.py', [1, 4], 'Add two numbers'), note('src/tool.py', [2, 3], 'Make the numbers')] }); // a note inside another
  assert.equal(second.saved, true);
  assert.deepEqual(store.getMap(id)?.map.fileNotes?.map((one) => [one.file, one.title]), [['src/app.py', 'Set the first values'], ['src/app.py', 'Set the last values'], ['src/tool.py', 'Add two numbers'], ['src/tool.py', 'Make the numbers']]);
  // The text of each note's lines is kept, by the index of the note in the list.
  assert.deepEqual(store.getMap(id)?.map.noteCode?.['@files/2'], ['def tool():', '    a = 1', '    b = 2', '    return a + b']);
  assert.deepEqual(store.getMap(id)?.map.noteCode?.['@files/0'], Array.from({ length: 6 }, (_, at) => `line_${at + 1} = ${at + 1}`));

  // A new JSON for tool.py replaces its notes and keeps those of app.py (the indexes move, the text stays with its note).
  assert.equal(addNotesToMap(store, repo.folder, { notes: [note('src/tool.py', [1, 4], 'Return the sum')] }).saved, true);
  const map = store.getMap(id)!.map;
  assert.deepEqual(map.fileNotes?.map((one) => one.title), ['Set the first values', 'Set the last values', 'Return the sum']);
  assert.deepEqual(map.noteCode?.['@files/1'], Array.from({ length: 6 }, (_, at) => `line_${at + 7} = ${at + 7}`));
  assert.equal(Object.keys(map.noteCode ?? {}).filter((key) => key.startsWith('@files/')).length, 3);

  // A file that has no code worth a note is named in "files": its notes go, and it is not asked for again while its text is the same.
  assert.equal(addNotesToMap(store, repo.folder, { notes: [], files: ['src/tool.py'] }).saved, true);
  assert.deepEqual(store.getMap(id)?.map.fileNotes?.map((one) => one.file), ['src/app.py', 'src/app.py']);
  assert.deepEqual(Object.keys(store.getMap(id)?.map.noNotes ?? {}), ['src/tool.py']);

  // A range replaces only the notes inside its lines, and a note outside the range is refused.
  addNotesToMap(store, repo.folder, { notes: [note('src/app.py', [1, 4], 'Old one'), note('src/app.py', [5, 8], 'Old two'), note('src/app.py', [9, 12], 'Old three')] });
  const outside = addNotesToMap(store, repo.folder, { notes: [note('src/app.py', [3, 6], 'Across')], ranges: [{ file: 'src/app.py', from: 5, to: 12 }] });
  assert.match(outside.problems.join(' '), /outside your lines \(5-12\)/);
  const inside = addNotesToMap(store, repo.folder, { notes: [note('src/app.py', [5, 12], 'New range')], ranges: [{ file: 'src/app.py', from: 5, to: 12 }] });
  assert.equal(inside.saved, true);
  assert.deepEqual(store.getMap(id)?.map.fileNotes?.map((one) => one.title), ['Old one', 'New range']);
  done();
});

test('add-notes refuses each fault with a sentence and saves nothing, keeps at most 400 notes for a file, and gives words that may break the rules back as style', () => {
  const { repo, store, id, done } = setup();
  const refuse = (draft: unknown): string => {
    const result = addNotesToMap(store, repo.folder, draft);
    assert.equal(result.saved, false);
    assert.equal(store.getMap(id)?.map.fileNotes, undefined);
    return result.problems.join(' | ');
  };
  assert.match(refuse({ notes: [note('src/app.py', [1, 2], 'Read one two three four five six')] }), /the title has 7 words\. Use at most 6: a verb and what it acts on\./);
  assert.match(refuse({ notes: [note('src/app.py', [1, 2], 'Read it', Array.from({ length: 21 }, () => 'word').join(' '))] }), /the text has 21 words\. Use at most 20\./);
  assert.match(refuse({ notes: [note('src/app.py', [1, 2], 'Checks the app')] }), /the title starts with "Checks"\. Start with the bare verb: "Check"\./);
  assert.match(refuse({ notes: [note('src/app.py', [1, 2], 'Applies the rule')] }), /Start with the bare verb: "Apply"\./);
  assert.match(refuse({ notes: [note('src/app.py', [1, 2], 'Read it', 'Returns zero. Then it stops.')] }), /the text has 2 sentences\. Write one sentence\./);
  assert.match(refuse({ notes: [note('src/app.py', [1, 2], 'Read it', 'Returns zero; the caller stops.')] }), /joins two ideas with a semicolon/);
  assert.match(refuse({ notes: [note('src/app.py', [1, 2], 'First'), note('src/app.py', [1, 2], 'Second')] }), /the lines 1-2 of src\/app\.py have a note already \("First"\)/);
  assert.match(refuse({ notes: [note('src/app.py', [5, 99], 'Too far')] }), /Line 99 is after the end of src\/app\.py, which has 12 lines/);
  assert.match(refuse({ notes: [note('src/nope.py', [1, 2], 'No file')] }), /no file of the repo/);
  assert.match(refuse({ notes: [{ ...note('src/app.py', [1, 2], 'Gone'), removed: true }] }), /leave out "removed"/);
  assert.match(refuse({ notes: [{ file: 'src/app.py', title: 'No lines' }] }), /"lines" must be \[first, last\]/);
  assert.match(refuse({ notes: [], files: ['src/nope.py'] }), /The file src\/nope\.py is no file of the repo/);
  assert.match(refuse({ notes: 5 }), /"notes" must be a list/);
  // One bad note keeps the good ones of the JSON from being saved.
  assert.match(refuse({ notes: [note('src/app.py', [1, 2], 'Good'), note('src/app.py', [3, 99], 'Bad')] }), /Line 99/);

  // More than 400 notes for one file are refused, and 400 are saved.
  repo.write('src/long.py', Array.from({ length: 450 }, (_, at) => `x${at} = ${at}`).join('\n') + '\n');
  repo.commit('long');
  const notes = (count: number): Note[] => Array.from({ length: count }, (_, at) => note('src/long.py', [at + 1, at + 1], `Set x${at}`));
  const refused = addNotesToMap(store, repo.folder, { notes: notes(401) });
  assert.match(refused.problems.join(' '), /the file src\/long\.py has 401 notes\. Keep at most 400/);
  assert.equal(addNotesToMap(store, repo.folder, { notes: notes(400) }).saved, true);
  assert.equal(store.getMap(id)?.map.fileNotes?.length, 400);

  // Notes saved before keep their words, a new note is held to the pattern, and words that may break the rules come back as style.
  // A saved note that breaks the pattern stays: another file can still get notes.
  store.updateMap(id, 'x', (stored) => ({ ...stored!, fileNotes: [note('src/tool.py', [1, 4], 'Checks the whole tool from top to bottom')] }));
  const saved = addNotesToMap(store, repo.folder, { notes: [note('src/app.py', [1, 2], 'Skip the old rows', 'Rows are skipped when they are matching nothing.')] });
  assert.equal(saved.saved, true, saved.problems.join(' '));
  assert.deepEqual(saved.style, [
    'The notes, note "Skip the old rows": "are skipped" may be passive. Say who does it, as "Skips the file" for "the file is skipped".',
    'The notes, note "Skip the old rows": "matching" is an -ing word. Use a verb or a noun, as "keeps" for "keeping" or "that match" for "matching".',
  ]);
  assert.equal(addNotesToMap(store, repo.folder, { notes: [note('src/app.py', [1, 2], 'Skip the old rows', 'Skips the rows that match nothing.')] }).style, undefined);
  done();
});

test('add-notes lists the gaps of its files, the most used first; a skip answers a gap until a new save of its file, and a skip with no why or with no function is refused', () => {
  const { repo, store, id, done } = setup();
  repo.write('src/shop.py', 'def total(items):\n    sum = 0\n    for item in items:\n        sum += item\n    return sum\n\n\ndef unused(x):\n    y = x + 1\n    y = y * 2\n    return y\n\n\ndef label(name):\n    text = name.strip()\n    text = text.title()\n    return text\n');
  repo.write('src/a.py', 'from shop import label, total\nprint(label("x"), total([1]))\n');
  repo.write('src/b.py', 'from shop import label\n');
  repo.commit('shop');
  const first = addNotesToMap(store, repo.folder, { notes: [note('src/shop.py', [1, 5], 'Add the items')] });
  assert.deepEqual(first.gaps, [{ file: 'src/shop.py', lines: [14, 17], name: 'label', used: 2 }, { file: 'src/shop.py', lines: [8, 11], name: 'unused', used: 0 }]);

  // Each gap answered once: a note, and a skip with why. Then nothing is missing, and the save prints no gaps.
  const skip = { file: 'src/shop.py', lines: [8, 11], why: 'Nothing calls it yet.' };
  const answered = addNotesToMap(store, repo.folder, { notes: [note('src/shop.py', [1, 5], 'Add the items'), note('src/shop.py', [14, 17], 'Tidy the name')], skip: [skip] });
  assert.deepEqual(answered, { saved: true, problems: [], notes: 2, files: 1 });
  assert.deepEqual(store.getMap(id)?.map.skips, [skip]);
  // A new save of the file replaces its skips, as it replaces its notes.
  assert.deepEqual(addNotesToMap(store, repo.folder, { notes: [note('src/shop.py', [1, 5], 'Add the items'), note('src/shop.py', [14, 17], 'Tidy the name')] }).gaps?.map((gap) => gap.name), ['unused']);
  assert.equal(store.getMap(id)?.map.skips, undefined);

  assert.match(addNotesToMap(store, repo.folder, { notes: [], skip: [{ file: 'src/shop.py', lines: [8, 11] }] }).problems.join(' '), /Skip of src\/shop\.py 8-11: give "why"/);
  assert.match(addNotesToMap(store, repo.folder, { notes: [], skip: [{ ...skip, lines: [6, 9] }] }).problems.join(' '), /Skip of src\/shop\.py 6-9: these lines are no function, method or class of the file/);
  done();
});

test('the notes of files stand beside the code: in place of the notes of the diagrams of an older map, through save-map and add-diagram, after their lines moved, and not after their lines changed', () => {
  const { repo, store, done } = setup();
  const oldMap = topMap();
  oldMap.diagrams.push({ id: 'area', kind: 'flow', title: 'Area', mermaid: 'flowchart LR\n  a --> b', parent: 'top', nodePaths: { a: ['src/app.py'], b: ['src/tool.py'] },
    notes: [note('src/app.py', [1, 6], 'Diagram note'), note('src/app.py', [7, 12], 'Only in the diagram')] });
  assert.equal(saveMapDraft(store, repo.folder, oldMap).saved, true);
  const text = (): string => readFileSync(join(repo.folder, 'src/app.py'), 'utf8');
  const before = notesInRepo(store, repo.folder, 'src/app.py', text());
  assert.deepEqual(before.notes.map((one) => [one.note.title, fromWords(one.change)]), [['Diagram note', 'From the map: Area'], ['Only in the diagram', 'From the map: Area']]);

  addNotesToMap(store, repo.folder, { notes: [note('src/app.py', [1, 6], 'File note')] });
  const after = notesInRepo(store, repo.folder, 'src/app.py', text());
  assert.deepEqual(after.notes.map((one) => [one.note.title, fromWords(one.change)]), [['File note', 'From the map']]);

  // save-map keeps the notes of files, and add-diagram keeps them too.
  addNotesToMap(store, repo.folder, { notes: [note('src/app.py', [1, 6], 'First half')] });
  assert.equal(saveMapDraft(store, repo.folder, { ...topMap(), diagrams: [{ ...topMap().diagrams[0], title: 'Written again' }] }).saved, true);
  const map = store.getMap(repoId(repo.folder))!.map;
  assert.equal(map.diagrams[0].title, 'Written again');
  assert.deepEqual(map.fileNotes?.map((one) => one.title), ['First half']);
  assert.ok(map.noteCode?.['@files/0']);
  const written = { id: 'area', kind: 'flow', title: 'Area', mermaid: 'flowchart LR\n  a --> b', parent: 'top', nodePaths: { a: ['src/app.py'], b: ['src/tool.py'] } };
  assert.equal(addDiagramToMap(store, repo.folder, written).saved, true);
  assert.deepEqual(store.getMap(repoId(repo.folder))?.map.fileNotes?.map((one) => one.title), ['First half']);

  // A note of a file stands beside the code after its lines moved, and does not show after its lines changed.
  addNotesToMap(store, repo.folder, { notes: [note('src/tool.py', [1, 4], 'Add two numbers'), note('src/tool.py', [7, 7], 'Run it')] });
  const original = 'def tool():\n    a = 1\n    b = 2\n    return a + b\n\n\nTOOL = tool()\n';
  const moved = `# a new first line\n# and a second\n${original}`;
  const found = notesInRepo(store, repo.folder, 'src/tool.py', moved);
  assert.deepEqual(found.notes.map((one) => [one.note.title, one.lines]), [['Add two numbers', [3, 6]], ['Run it', [9, 9]]]);
  const changed = notesInRepo(store, repo.folder, 'src/tool.py', original.replace('b = 2', 'b = 3'));
  assert.deepEqual(changed.notes.map((one) => one.note.title), ['Run it']);
  assert.equal(changed.older, 1);
  done();
});

test('note-groups: groups of about 400 lines of whole files, a long file whole in a group of its own, files left out, a new file taken in, and a second run that lists only what changed', () => {
  const { repo, store, id, done } = setup();
  const functions = (count: number, size: number, prefix: string): string => Array.from({ length: count }, (_, at) => `def ${prefix}${at}():\n${Array.from({ length: size - 1 }, (_, line) => `    value_${line} = ${line}`).join('\n')}\n`).join('\n\n');
  repo.write('src/big.py', functions(33, 60, 'big')); // about 2,000 lines
  repo.write('src/gen.py', '# Code generated by a tool. Do not edit.\nX = 1\n');
  repo.write('src/data.json', '{}\n');
  repo.write('src/empty.py', '\n\n');
  repo.write('yarn.lock', 'lock\n');
  repo.write('src/min.min.js', 'var a=1;\n');
  repo.commit('more files');
  repo.write('src/brand_new.py', 'def fresh():\n    return 1\n'); // not committed
  for (let at = 0; at < 2; at++) repo.write(`src/half${at}.py`, `def half${at}():\n${Array.from({ length: 299 }, (_, line) => `    v${line} = ${line}`).join('\n')}\n`); // 300 lines each
  saveMapDraft(store, repo.folder, { ...topMap(), diagrams: [{ ...topMap().diagrams[0], nodePaths: { code: ['src/'], docs: ['README.md'] } }] });

  const first = noteGroups(repo.folder, store.getMap(id));
  assert.deepEqual(first.skipped.count, 2); // generated and empty
  const paths = first.groups.map((group) => group.files.map((file) => file.path));
  // A file of 2,000 lines is one group, whole; two files of 300 lines are two groups; no file is ever split.
  const big = first.groups.filter((group) => group.files.some((file) => file.path === 'src/big.py'));
  assert.equal(big.length, 1);
  assert.deepEqual(big[0].files, [{ path: 'src/big.py', lines: lineCount(fileText(repo.folder, 'src/big.py')!) }]);
  assert.equal(first.groups.filter((group) => group.files.some((file) => /half\d/.test(file.path))).length, 2);
  assert.ok(paths.flat().length === new Set(paths.flat()).size, 'each file stands in one group');
  const flat = paths.flat();
  assert.ok(flat.includes('src/brand_new.py'), 'a new file that is not committed is taken in');
  assert.ok(!flat.some((path) => /gen\.py|data\.json|empty\.py|yarn\.lock|min\.min\.js/.test(path)));
  for (const group of first.groups.filter((one) => one.files.length > 1)) assert.ok(group.lines <= 400, `${group.name} has ${group.lines} lines`);
  assert.ok(first.groups.every((group) => group.area === 'code' || group.files.every((file) => !file.path.startsWith('src/'))));
  assert.ok(first.groups.every((group) => /^[a-z0-9-]+$/.test(group.name)));
  assert.deepEqual(noteGroups(repo.folder, store.getMap(id)).groups.map((group) => group.name), first.groups.map((group) => group.name)); // the same names for the same files

  // Notes for every file but the long one: the second run lists only the files that still need notes.
  const small = flat.filter((path) => path !== 'src/big.py');
  assert.equal(addNotesToMap(store, repo.folder, { notes: small.map((path) => note(path, [1, 2], `Start ${path.replace(/\W/g, ' ')}`)) }).saved, true);
  assert.deepEqual(noteGroups(repo.folder, store.getMap(id)).groups.map((group) => group.files.map((file) => file.path)), [['src/big.py']]);
  // A file whose code changed (its noted lines are no longer there) is listed again.
  repo.write('src/half1.py', `def other():\n    return 3\n${'x = 1\n'.repeat(10)}`);
  assert.deepEqual(noteGroups(repo.folder, store.getMap(id)).groups.flatMap((group) => group.files.map((file) => file.path)).sort(), ['src/big.py', 'src/half1.py']);
  // A file that a writer called empty stays out while its text is the same; --all lists every code file.
  addNotesToMap(store, repo.folder, { notes: [], files: ['src/half1.py'] });
  assert.ok(!noteGroups(repo.folder, store.getMap(id)).groups.some((group) => group.files.some((file) => file.path === 'src/half1.py')));
  assert.ok(noteGroups(repo.folder, store.getMap(id), true).groups.some((group) => group.files.some((file) => file.path === 'src/half1.py')));
  done();
});

test('the commands: add-notes removes its draft, apostil map prints counts and no notes of files, and apostil notes prints one file', () => {
  const repo = makeTestRepo();
  repo.write('src/app.py', Array.from({ length: 12 }, (_, at) => `line_${at + 1} = ${at + 1}`).join('\n') + '\n');
  repo.write('src/tool.py', 'def tool():\n    return 1\n');
  repo.commit('files');
  const home = tempFolder('apostil-home-');
  const apostil = (...args: string[]) => runApostil([...args, '--folder', repo.folder], { env: { APOSTIL_HOME: home } });
  const map = join(tempFolder('apostil-draft-'), 'map.json');
  writeFileSync(map, JSON.stringify(topMap()));
  assert.equal(apostil('save-map', map).status, 0);
  const draft = join(repo.folder, 'apostil-notes-test.json');
  writeFileSync(draft, JSON.stringify({ notes: [note('src/app.py', [1, 6], 'First half'), note('src/app.py', [7, 12], 'Second half')] }));
  const added = JSON.parse(apostil('add-notes', draft).stdout);
  assert.deepEqual([added.saved, added.notes, added.draftRemoved], [true, 2, true]);
  assert.equal(existsSync(draft), false);

  const shown = JSON.parse(apostil('map').stdout);
  assert.deepEqual([shown.notes, shown.notedFiles], [2, 1]);
  assert.equal(shown.map.fileNotes, undefined);
  assert.equal(shown.map.noteCode, undefined);
  assert.match(shown.hint, /2 code files need notes/); // new_tool.py and tool.py have none

  const one = JSON.parse(apostil('notes', 'src/app.py').stdout);
  assert.deepEqual(one.notes.map((entry: Note) => entry.title), ['First half', 'Second half']);
  assert.equal(one.standing, 2);

  const groups = JSON.parse(apostil('note-groups').stdout);
  assert.deepEqual(groups.groups.map((group: { files: { path: string }[] }) => group.files.map((file) => file.path)), [['src/new_tool.py', 'src/tool.py']]);
  assert.equal(groups.groups[0].area, 'code');
  assert.equal(JSON.parse(apostil('note-groups', '--all').stdout).groups[0].files.length, 3);

  writeFileSync(draft, JSON.stringify({ notes: [note('src/app.py', [1, 99], 'Bad')] }));
  const refused = apostil('add-notes', draft);
  assert.equal(refused.status, 1);
  assert.equal(existsSync(draft), true); // stays, so that the writer can repair it
  repo.remove();
});

test('writers at the same time keep each other\'s notes', async () => {
  const repo = makeTestRepo();
  const names = ['a', 'b', 'c', 'd', 'e', 'f'];
  for (const name of names) repo.write(`src/${name}.py`, `def ${name}():\n    return 1\n`);
  repo.commit('files');
  const home = tempFolder('apostil-home-');
  const env = { ...process.env, APOSTIL_HOME: home };
  const map = join(tempFolder('apostil-draft-'), 'map.json');
  writeFileSync(map, JSON.stringify(topMap()));
  assert.equal(runApostil(['save-map', map, '--folder', repo.folder], { env: { APOSTIL_HOME: home } }).status, 0);
  // Six programs at the same time: only real programs can race for the store.
  const runs = names.map((name) => new Promise<number | null>((done) => {
    writeFileSync(join(repo.folder, `apostil-notes-${name}.json`), JSON.stringify({ notes: [note(`src/${name}.py`, [1, 2], `Define ${name}`)] }));
    spawn(process.execPath, [join(__dirname, 'cli.js'), 'add-notes', `apostil-notes-${name}.json`, '--folder', repo.folder], { env, cwd: repo.folder }).on('close', done);
  }));
  assert.deepEqual(await Promise.all(runs), names.map(() => 0));
  const store = new Store(home);
  assert.deepEqual(store.getMap(repoId(repo.folder))?.map.fileNotes?.map((one) => one.title), names.map((name) => `Define ${name}`));
  store.close();
  repo.remove();
});

