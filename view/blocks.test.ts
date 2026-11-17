// Tests for the blocks of a look (build 58): the check of a page, a section of its own and the window of a target (shared/look.ts), a file of the
// repo as the data of a block (shared/repo-data.ts), and the data of the blocks when their page or window opens (view/look-blocks.ts).
// On the made-up example (the repo "library-app", with its file data/branches.csv) and on a small test repo.

import assert from 'node:assert/strict';
import { readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { repoId } from '../shared/git';
import { apostilCommands, LOOK_PARTS, lookProblems, type LookContext } from '../shared/look';
import { readRepoData } from '../shared/repo-data';
import type { RepoMap } from '../shared/repo-map';
import { Store } from '../shared/store';
import { makeTestRepo, tempFolder } from '../shared/test-repo';
import { setLook } from '../store/marks-save';
import { saveMapDraft } from '../store/save';
import { EXAMPLE_LOOK, makeCheckExample, putLookFiles } from './check-example';
import { blocksAnswer, blocksNow, pageData, type ShownBlock } from './look-blocks';
import { lookData } from './look-data';

const example = makeCheckExample();
const repo = makeTestRepo();
after(() => { example.remove(); repo.remove(); });
const map: RepoMap = JSON.parse(readFileSync(join(__dirname, '../../view/example-map.json'), 'utf8'));
const context: LookContext = { folder: example.folder, map, commands: apostilCommands() };
const blocksLook = JSON.parse(readFileSync(join(EXAMPLE_LOOK, 'look-blocks.json'), 'utf8'));
/** The problems of one page "opening-hours" with these blocks. */
const page = (...blocks: unknown[]): string[] => lookProblems({ pages: [{ id: 'opening-hours', title: 'Opening hours', blocks }], rules: [] }, context);
const jobs = { kind: 'node', diagram: 'lib-top', nodes: ['jobs'] };
const BRANCHES = { file: 'data/branches.csv' };

test('the look of the example passes, and so does each block in its written form and with a file of the repo in its place', () => {
  assert.deepEqual(lookProblems(blocksLook, context), []);
  assert.deepEqual(page(
    { text: 'Two lines.\n\nA second paragraph.' }, { title: 'Facts', fields: [['Runs', 'each night'], ['Jobs', 3]] }, { table: { columns: ['a', 'b'], rows: [['1', 2]] } },
    { bars: [['North', 9]] }, { code: 'run()' }, { state: { word: 'ready', color: '#2b6cb0', text: 'now' } }, { links: [{ name: 'Home', target: { place: { diagram: 'lib-top' } } }] },
    { button: { name: 'Open', target: { file: 'README.md', line: 1 } } }, { picture: 'apostil-look-picture-week.svg' }, { diagram: 'lib-top' }, { row: [{ text: 'a' }, { text: 'b' }, { text: 'c' }] },
    { table: { ...BRANCHES, columns: ['branch', 'hours'], rows: 2 } }, { bars: { ...BRANCHES, label: 'branch', value: 'hours' } }, { fields: { file: 'web/package.json', keys: ['name'] } },
    { state: { file: 'web/package.json', key: 'name' } }, { code: { file: 'src/library/night_jobs.py', lines: [516, 520] } }, { code: { file: 'web/package.json', key: 'scripts' } },
  ), []);
});

test('each fault of a block, a page and a target has its sentence, with the nearest right name', () => {
  assert.deepEqual(page({ text: 'a' }, { tabel: { columns: ['a'], rows: [] } }),
    ['Page "opening-hours", block 2: "tabel" is no block. The blocks are "text", "fields", "table", "bars", "code", "state", "links", "button", "picture", "diagram", "row". The nearest is "table".']);
  assert.deepEqual(page({ text: 'a' }, { table: BRANCHES }), ['Page "opening-hours", block 2: a table from a file needs "columns". The file data/branches.csv has: branch, opens, closes, hours.']);
  assert.deepEqual(page({ text: 'a' }, { table: { ...BRANCHES, columns: ['branch', 'open'] } }),
    ['Page "opening-hours", block 2: the file data/branches.csv has no column "open". Its columns are branch, opens, closes, hours. The nearest is "opens".']);
  assert.deepEqual(lookProblems({ rules: [{ pick: jobs, window: { sections: ['files', { title: 'Hours', blocks: [{ table: { file: 'data/hours.csv', columns: ['a'] } }] }] } }] }, context),
    ['Rule 1, "window", section 2, block 1: the file data/hours.csv is no file of the repo. Give a path that Git lists.']);
  assert.deepEqual(lookProblems({ pages: blocksLook.pages, rules: [{ pick: jobs, click: { page: 'opening-hour' } }] }, context),
    ['Rule 1, "click": the look has no page "opening-hour". Its pages are "opening-hours". The nearest is "opening-hours".']);
  assert.deepEqual(page(...Array.from({ length: 34 }, () => ({ text: 'a' }))), ['Page "opening-hours": it has 34 blocks. A page holds at most 30. Make two pages, or fewer blocks.']);
  assert.deepEqual(lookProblems({ pages: [...blocksLook.pages, ...blocksLook.pages], rules: [] }, context), ['The look: the page id "opening-hours" is used twice. Give each page its own id.']);
  assert.deepEqual(page({ text: 'a' }, { text: 'b' }, { text: 'c' }, { row: [{ text: 'a' }, { row: [{ text: 'b' }, { text: 'c' }] }] }),
    ['Page "opening-hours", block 4: a row cannot hold a row. Put the blocks of the inner row into this row, or into a second row.']);
  // A block inside a row is named by its row and its place in it; a field of a file that is no number names what it holds.
  assert.deepEqual(page({ row: [{ text: 'a' }, { bars: { ...BRANCHES, label: 'branch', value: 'opens' } }] }), ['Page "opening-hours", block 1.2: the column "opens" of data/branches.csv holds "09:00", which is no number.']);
  assert.deepEqual(page({ fields: { ...BRANCHES, keys: ['a'] } }), ['Page "opening-hours", block 1: the file data/branches.csv holds rows, not one object. Fields read keys of a JSON object.']);
  assert.deepEqual(page({ text: '' }), ['Page "opening-hours", block 1: the block "text" is { "text": "<words>" }.']);
});

test('a file of the repo reads as CSV (with quoted fields), TSV and JSON: rows, or the keys of an object; the blocks show its data', () => {
  repo.write('data/a.csv', 'name,note\nNorth,"wide, and ""tall"""\nSouth,"two\nlines"\n');
  repo.write('data/a.tsv', 'name\tcount\nNorth\t3\nSouth\t5\n');
  repo.write('data/a.json', '[{"name":"North","count":3},{"name":"South","count":5,"extra":true}]');
  repo.write('data/k.json', '{"state":{"word":"passed","color":"#1a7f37"},"owner":"desk"}');
  repo.commit('data');
  const read = (path: string) => readRepoData(repo.folder, path, LOOK_PARTS.limits.fileBytes);
  assert.deepEqual(read('data/a.csv'), { data: { rows: { columns: ['name', 'note'], rows: [{ name: 'North', note: 'wide, and "tall"' }, { name: 'South', note: 'two\nlines' }] } } });
  assert.deepEqual(read('data/a.tsv'), { data: { rows: { columns: ['name', 'count'], rows: [{ name: 'North', count: '3' }, { name: 'South', count: '5' }] } } });
  assert.deepEqual((read('data/a.json') as { data: { rows: { columns: string[] } } }).data.rows.columns, ['name', 'count', 'extra']);
  assert.deepEqual(read('data/k.json'), { data: { keys: { state: { word: 'passed', color: '#1a7f37' }, owner: 'desk' } } });
  assert.deepEqual(read('src/app.py'), { fault: 'kind' });
  const store = new Store(tempFolder('apostil-store-'));
  const { blocks, files } = blocksNow(store, repo.folder, [
    { title: 'Counts', bars: { file: 'data/a.tsv', label: 'name', value: 'count' } }, { table: { file: 'data/a.json', columns: ['name', 'count'], rows: 1 } },
    { state: { file: 'data/k.json', key: 'state' } }, { fields: { file: 'data/k.json', keys: ['owner'] } }, { code: { file: 'src/app.py', lines: [1, 2] } },
  ], (file) => file);
  assert.deepEqual(blocks, [
    { title: 'Counts', bars: [['North', 3], ['South', 5]], from: 'data/a.tsv' }, { table: { columns: ['name', 'count'], rows: [['North', 3]] }, from: 'data/a.json', more: 1 },
    { state: { word: 'passed', color: '#1a7f37' }, from: 'data/k.json' }, { fields: [['owner', 'desk']], from: 'data/k.json' },
    { code: { text: 'def start():\n    return 2', file: 'src/app.py', from: 1, to: 2 } },
  ]);
  assert.deepEqual(files, ['data/a.tsv', 'data/a.json', 'data/k.json', 'src/app.py']);
  store.close();
});

test('a path that leads out of the repo is refused: "..", a path from the root, and a link inside the repo that leads out', () => {
  const outside = join(tempFolder('apostil-outside-'), 'secret.csv');
  writeFileSync(outside, 'a\n1\n');
  symlinkSync(outside, join(repo.folder, 'data-link.csv'));
  repo.commit('a link that leads out');
  for (const path of ['../secret.csv', outside, 'data-link.csv']) assert.deepEqual(readRepoData(repo.folder, path, LOOK_PARTS.limits.fileBytes), { fault: 'outside' }, path);
  assert.deepEqual(lookProblems({ pages: [{ id: 'p', title: 'P', blocks: [{ table: { file: '../x.csv', columns: ['a'] } }] }], rules: [] }, { ...context, folder: repo.folder }),
    ['Page "p", block 1: the file ../x.csv lies outside the repo. Give a path inside it that Git lists.']);
});

test('each limit of the list has its sentence: blocks of a page, a section and a window, sections of its own, rows, columns, a row, lines of code, the size of a file, pages', () => {
  const many = (count: number) => Array.from({ length: count }, () => ({ text: 'a' }));
  const rule = (window: unknown) => lookProblems({ rules: [{ pick: jobs, window }] }, context);
  assert.deepEqual(rule({ sections: [{ blocks: many(7) }] }), ['Rule 1, "window", section 1: it has 7 blocks. A section holds at most 6. Make two sections, or fewer blocks.']);
  assert.deepEqual(rule({ sections: Array.from({ length: 5 }, () => ({ blocks: many(1) })) }), ['Rule 1, "window": it has 5 sections of its own. A window holds at most 4. Make a page, or fewer sections.']);
  assert.deepEqual(lookProblems({ rules: [{ pick: jobs, click: { window: { blocks: many(7) } } }] }, context), ['Rule 1, "click": it has 7 blocks. A window holds at most 6. Make a page, or fewer blocks.']);
  assert.deepEqual(page({ table: { columns: ['a'], rows: Array.from({ length: 51 }, () => ['1']) } }), ['Page "opening-hours", block 1: it has 51 rows. A table shows at most 50.']);
  assert.deepEqual(page({ table: { ...BRANCHES, columns: Array.from({ length: 13 }, () => 'branch') } }), ['Page "opening-hours", block 1: a table shows at most 12 columns. Give fewer "columns".']);
  assert.deepEqual(page({ table: { ...BRANCHES, columns: ['branch'], rows: 51 } }), ['Page "opening-hours", block 1: "rows" must be a whole number from 1 to 50.']);
  assert.deepEqual(page({ row: [{ text: 'a' }, { text: 'b' }, { text: 'c' }, { text: 'd' }] }), ['Page "opening-hours", block 1: a row holds two or three blocks side by side: { "row": [<block>, <block>] }.']);
  assert.deepEqual(page({ code: { file: 'src/library/night_jobs.py', lines: [400, 500] } }), ['Page "opening-hours", block 1: it shows 101 lines. A code block shows at most 100.']);
  writeFileSync(join(example.folder, 'big.csv'), `a\n${'1\n'.repeat(1_100_000)}`); // more than 2 MB, not in Git yet but not ignored: Git lists it
  assert.deepEqual(page({ table: { file: 'big.csv', columns: ['a'] } }), ['Page "opening-hours", block 1: the file big.csv is larger than 2 MB. A block reads a file of at most 2 MB.']);
  rmSync(join(example.folder, 'big.csv'));
  const pages = Array.from({ length: 21 }, (_, at) => ({ id: `p${at}`, title: 'P', blocks: many(1) }));
  assert.deepEqual(lookProblems({ pages, rules: [] }, context), ['The look: it has 21 pages. A look holds at most 20. Put more blocks on one page, or fewer pages.']);
  assert.deepEqual(lookProblems({ pages: [{ id: 'Opening Hours', title: 'x', blocks: many(1) }], rules: [] }, context), ['Page "Opening Hours": "id" must use small letters, digits and "-".']);
});

test('the targets "page" and "window": each passes, and each fault has its sentence', () => {
  const click = (target: unknown, pages = blocksLook.pages) => lookProblems({ pages, rules: [{ pick: jobs, click: target }] }, context);
  assert.deepEqual(click({ page: 'opening-hours' }), []);
  assert.deepEqual(click({ window: { title: 'In short', width: 300, blocks: [{ text: 'a' }, { links: [{ name: 'Hours', target: { page: 'opening-hours' } }] }] } }), []);
  assert.deepEqual(click({ page: 'hours' }, []), ['Rule 1, "click": the look has no page "hours". It has no pages yet: add one to "pages".']);
  assert.deepEqual(click({ window: { width: 2000, blocks: [{ text: 'a' }] } }), ['Rule 1, "click": the "width" of a window must be a number of pixels from 240 to 720.']);
  assert.deepEqual(click({ window: { title: 'x' } }), ['Rule 1, "click": "blocks" must be a list of blocks, as [ { "text": "<words>" } ]; apostil look-slots blocks gives every block.']);
  assert.deepEqual(click({ window: { blocks: [{ links: [{ name: 'x', target: { pag: 'opening-hours' } }] }] } }).map((one) => one.replace(/The targets are [^.]*\./, '…')),
    ['Rule 1, "click", block 1, link 1: "pag" is no target. … The nearest is "page".']);
});

test('Home carries no blocks: lookData() gives a ref for each list of blocks and the titles of the pages; the page asks for the blocks by the ref', () => {
  const store = new Store(tempFolder('apostil-store-'));
  assert.deepEqual(saveMapDraft(store, example.folder, map).problems, []);
  const repoKey = repoId(example.folder);
  assert.equal('pages' in lookData(store, repoKey, example.folder, (file) => file), false, 'with no look, the data of Home is as it was');
  const put = putLookFiles(example.folder);
  assert.deepEqual(setLook(store, example.folder, blocksLook).problems, []);
  put.clean();
  const data = lookData(store, repoKey, example.folder, (file) => file);
  const text = JSON.stringify(data);
  assert.ok(!text.includes('"blocks"') && !text.includes('data/branches.csv'), text);
  assert.deepEqual(data.pages, [{ id: 'opening-hours', title: 'Opening hours' }]);
  const ref = data.rules.at(-2)!.window!.sections![1] as { title: string; ref: string };
  assert.equal(ref.title, 'Opening hours');
  assert.deepEqual(blocksAnswer(store, example.folder, ref.ref, (file) => file), {
    blocks: [{ table: { columns: ['branch', 'opens'], rows: [['North', '09:00'], ['Harbour', '08:00'], ['Old Town', '10:00'], ['Station', '07:00']] }, from: 'data/branches.csv' }],
  });
  assert.deepEqual(blocksAnswer(store, example.folder, '000000000000', (file) => file), { gone: 'The look of this repo changed since this page loaded.' });
  store.close();
});

test('a file that changed since the save gives one quiet line in place of its block, and the rest of the page stands', () => {
  const store = new Store(tempFolder('apostil-store-'));
  assert.deepEqual(saveMapDraft(store, example.folder, map).problems, []);
  const put = putLookFiles(example.folder);
  assert.deepEqual(setLook(store, example.folder, blocksLook).problems, []);
  put.clean();
  const before = pageData(store, example.folder, 'opening-hours', (file) => file);
  assert.equal(before.title, 'Opening hours');
  assert.ok(before.blocks.every((block) => !block.quiet), JSON.stringify(before.blocks));
  const csv = join(example.folder, 'data/branches.csv');
  const kept = readFileSync(csv, 'utf8');
  writeFileSync(csv, 'branch,closes,hours\nNorth,18:00,9\n');
  const changed = pageData(store, example.folder, 'opening-hours', (file) => file);
  const [row, rowBefore] = [changed.blocks[1].row, before.blocks[1].row] as ShownBlock[][];
  assert.deepEqual([row[0], row[1]], [{ title: 'Branches', quiet: 'data/branches.csv has no column "opens" now.' }, rowBefore[1]]);
  assert.deepEqual([changed.blocks[0], changed.blocks[2].bars], [before.blocks[0], [['North', 9]]]);
  rmSync(csv);
  assert.equal(pageData(store, example.folder, 'opening-hours', (file) => file).blocks[2].quiet, 'data/branches.csv is gone now.');
  writeFileSync(csv, kept);
  assert.equal(pageData(store, example.folder, 'nowhere', (file) => file).gone, 'The look of this repo has no page "nowhere" now.');
  store.close();
});

test('each new part has an area with an index line, other words and an example that passes the check', () => {
  const fill = (value: unknown): unknown => JSON.parse(JSON.stringify(value).replaceAll('<diagram>', 'lib-top').replaceAll('<node>', 'jobs').replaceAll('<file>', 'src/library/night_jobs.py').replaceAll('<page>', 'opening-hours'));
  for (const [name, block] of Object.entries(LOOK_PARTS.blocks)) {
    assert.ok(Object.keys(LOOK_PARTS.areas).includes(block.area) && block.words.length, name);
    assert.deepEqual(page(fill(block.example)), [], name);
  }
  for (const name of ['window', 'page'] as const) {
    const target = LOOK_PARTS.targets[name];
    assert.ok(Object.keys(LOOK_PARTS.areas).includes(target.area) && target.words.length, name);
    assert.deepEqual(lookProblems({ pages: blocksLook.pages, rules: [fill(target.example)] }, context), [], name);
  }
  assert.ok(LOOK_PARTS.areas[LOOK_PARTS.pages.area] && LOOK_PARTS.pages.words.length);
  assert.deepEqual(lookProblems(fill(LOOK_PARTS.pages.example), context), []);
  assert.deepEqual(lookProblems({ rules: [fill(LOOK_PARTS.slots.window.example)] }, context), []);
});
