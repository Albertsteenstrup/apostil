// The tests of `apostil map --fit`, on the made-up library example of the checks.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { mapFit } from './map-fit';
import type { RepoMap } from './repo-map';

const example = (): RepoMap => JSON.parse(readFileSync(join(__dirname, '../../view/example-map.json'), 'utf8'));

test('map --fit lists the files that stand in no node, the nodes with no file with a note or a process, and the calls with no arrow in the top diagram', () => {
  const whole = example();
  assert.equal(mapFit(whole).filesInNoNode.count, 0);
  assert.equal(mapFit(whole).callsWithNoArrow.count, 0);
  assert.equal(mapFit(whole).nodesWithNoFile.items.some((one) => one.node === 'routes'), false);

  // The node "routes" is given a wrong path: its files stand in no node now, and the node holds no file.
  const wrong = example();
  wrong.diagrams[0].nodePaths!.routes = ['src/library/nowhere/'];
  const fit = mapFit(wrong);
  assert.ok(fit.filesInNoNode.items.includes('src/library/web/requests_router.py'));
  assert.deepEqual(fit.nodesWithNoFile.items.find((one) => one.node === 'routes'), { diagram: 'lib-top', node: 'routes', paths: ['src/library/nowhere/'] });

  // The arrow from "routes" to "lending" is taken out: the calls of the processes between the two have no arrow, with one example.
  const cutArrow = example();
  cutArrow.diagrams[0].mermaid = cutArrow.diagrams[0].mermaid.replace('  routes -->|"hands to"| lending["Lending"]\n', '  lending["Lending"]\n');
  const [call] = mapFit(cutArrow).callsWithNoArrow.items;
  assert.equal(call.from, 'routes');
  assert.equal(call.to, 'lending');
  assert.ok(call.calls >= 1);
  assert.match(call.example, /^answer-request: src\/library\/web\/requests_router\.py:35 calls src\/library\/lending\/requests\.py/);
});

test('map --fit lists the functions that other code files use and that have no note, the most used first, and none of a set-aside file', () => {
  const map = example();
  const fn = (name: string): string => `def ${name}(x):\n    y = x\n    y = y + 1\n    return y\n\n\n`;
  const files = [
    { path: 'src/shop.py', text: fn('total') + fn('label') + fn('noted') + fn('unused') }, // lines 1-4, 7-10, 13-16, 19-22
    { path: 'src/a.py', text: 'from shop import total, label, noted\n' },
    { path: 'src/b.py', text: 'from shop import label, hidden\n' },
    { path: 'src/aside.py', text: fn('hidden') },
  ];
  map.fileNotes = [...(map.fileNotes ?? []), { file: 'src/shop.py', lines: [13, 16], title: 'Add one', text: 'It adds one.' }];
  map.noNotes = { 'src/aside.py': 'x' };
  assert.deepEqual(mapFit(map, files).usedWithNoNote, { count: 2, items: [{ file: 'src/shop.py', lines: [7, 10], name: 'label', used: 2 }, { file: 'src/shop.py', lines: [1, 4], name: 'total', used: 1 }] });
  assert.equal(mapFit(map).usedWithNoNote.count, 0); // with no code files given
});

test('map --fit cuts each list at 20 entries and counts the rest', () => {
  const many = example();
  many.fileNotes = Array.from({ length: 25 }, (_, at) => ({ file: `stray/file${String(at).padStart(2, '0')}.py`, lines: [1, 2] as [number, number], title: 'Do it', text: 'It does it.' }));
  const { filesInNoNode } = mapFit(many);
  assert.equal(filesInNoNode.count, 25);
  assert.equal(filesInNoNode.items.length, 20);
  assert.equal(filesInNoNode.more, 5);
});
