// Tests for the order of the calls of a drawn process, a box that many boxes call, and a long chain in columns.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Note } from '../shared/change-file';
import { columnSizes, processDrawings } from '../shared/process-diagrams';
import { stepKey, type Arrow, type MapProcesses } from '../shared/processes';

/* eslint-disable @typescript-eslint/no-require-imports */
const ProcessDrawing = require('../../view/media/process-drawing.js');
/* eslint-enable @typescript-eslint/no-require-imports */

const note = (file: string, lines: [number, number], title: string): Note => ({ file, lines, title, text: 'Does one thing.' });
const key = (one: Note): string => stepKey(one);
const processOf = (notes: Note[], arrows: Arrow[]): MapProcesses => ({ fileNotes: notes, processes: [{ id: 'p', title: 'Do it', summary: 'Does it.', group: 'g', steps: notes.map(key), arrows }] });
const drawn = (map: MapProcesses) => processDrawings(map, map.processes![0]);
const arrow = (from: Note, to: Note, label: string, fromLine: number): Arrow => ({ from: key(from), to: key(to), label, fromLine, name: label });

/** One function of `count` steps (the opened step), which calls the same helper from the steps in `callers`. */
function longFunction(count: number, callers: number[] = []) {
  const outer = note('src/long.py', [1, count + 2], 'Do all of it');
  const steps = Array.from({ length: count }, (_, at) => note('src/long.py', [at + 2, at + 2], `Step ${at + 1}`));
  const helper = note('src/help.py', [1, 3], 'Filter the rows');
  const map = processOf([outer, ...steps, helper], callers.map((at) => arrow(steps[at], helper, `filter ${at + 1}`, at + 2)));
  const drawings = processDrawings(map, map.processes![0]);
  return { opened: drawings.find((one) => one.id.includes('/'))!, steps, helper };
}

test('the arrows that leave a box are numbered by the lines of their calls, and a box with one arrow has no number', () => {
  const main = note('src/main.py', [1, 10], 'Run the job');
  const ask = note('src/net.py', [1, 2], 'Ask once');
  const retry = note('src/net.py', [5, 6], 'Retry transient errors');
  // The writer listed the call at line 8 first; the code runs the call at line 3 first.
  const [drawing] = drawn(processOf([main, ask, retry], [arrow(main, ask, 'ask once', 8), arrow(main, retry, 'test for retry', 3)]));
  const arrows = drawing.mermaid.split('\n').filter((line) => line.includes('-->'));
  assert.equal(arrows.length, 2);
  assert.match(arrows[0], /<span class='eo'>1<\/span> test for retry/);
  assert.match(arrows[1], /<span class='eo'>2<\/span> ask once/);
  assert.deepEqual(drawing.order, { 's0>s2': 1, 's0>s1': 2 });
  const [alone] = drawn(processOf([main, ask], [arrow(main, ask, 'ask once', 8)]));
  assert.ok(!alone.mermaid.includes("class='eo'") && !alone.order);
});

test('three callers of one box give one arrow with the count and two dots, and the box lists its callers', () => {
  const { opened, helper } = longFunction(5, [0, 2, 3]);
  const toHelper = opened.mermaid.split('\n').filter((line) => /-->.* x\d+$/.test(line));
  assert.equal(toHelper.length, 1);
  assert.match(toHelper[0], /filter 1 · 3 steps/);
  const box = Object.keys(opened.nodes).find((id) => id.startsWith('x'))!; // the quiet box of the helper
  assert.deepEqual(opened.dots, { s3: [box], s4: [box] });
  const shared = opened.nodes[box];
  assert.deepEqual(shared.callers?.map((one) => [one.title, one.line]), [['Step 1', 2], ['Step 3', 4], ['Step 4', 5]]);
  assert.equal(shared.files[0], helper.file);
  // Two callers keep their two arrows.
  assert.equal(longFunction(5, [0, 2]).opened.mermaid.split('\n').filter((line) => /-->.* x\d+$/.test(line)).length, 2);
});

test('a chain of more than 14 boxes is laid out in columns of at most 12', () => {
  assert.deepEqual([15, 24, 35].map(columnSizes), [[8, 7], [12, 12], [12, 12, 11]]);
  assert.equal(longFunction(14).opened.columns, undefined);
  const { opened } = longFunction(35, [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(opened.columns!.columns.map((ids) => ids.filter((id) => id.startsWith('s')).length), [12, 12, 11]);
  const text = opened.columns!.mermaid;
  assert.match(text, /^flowchart LR/);
  assert.equal(text.split('\n').filter((line) => /^\s*subgraph col\d/.test(line)).length, 3);
  assert.equal(text.split('\n').filter((line) => /^\s*col\d --> col\d/.test(line)).length, 2);
  // The arrow of the order of the list between two columns is the one between the column boxes, not one between their steps.
  assert.ok(!text.includes('s12 --> s13'));
  assert.ok(opened.mermaid.includes('s12 --> s13'));
  // The shared box stands in the column of its first caller, and the other callers are dots there too.
  assert.equal(Object.keys(opened.columns!.dots).length, 7);
});

test('a drawing goes in columns unless a rule of the look turns it or leaves a box out, or he asked for one column', () => {
  const diagram = { id: 'process:p/0', columns: {} };
  assert.equal(ProcessDrawing.columnsOn(diagram), true);
  assert.equal(ProcessDrawing.columnsOn(diagram, { direction: 'down' }), false);
  assert.equal(ProcessDrawing.columnsOn(diagram, { hidden: true }), false);
  assert.equal(ProcessDrawing.columnsOn(diagram, { one: true }), false);
  assert.equal(ProcessDrawing.columnsOn({ id: 'process:p' }), false);
});
