// Tests for the order of the calls of a drawn process, a box that many boxes call, a long chain in columns, and the steps that a step calls in another file.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Note } from '../shared/change-file';
import { columnSizes, parentsWithCalls, processDrawings, processesWithStepsIn } from '../shared/process-diagrams';
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
  const helper = note('src/long.py', [count + 4, count + 6], 'Filter the rows');
  const map = processOf([outer, ...steps, helper], callers.map((at) => arrow(steps[at], helper, `filter ${at + 1}`, at + 2)));
  const drawings = processDrawings(map, map.processes![0]);
  return { opened: drawings.find((one) => one.id.includes('/'))!, steps, helper };
}

test('the arrows that leave a box are numbered by the lines of their calls, and a box with one arrow has no number', () => {
  const main = note('src/main.py', [1, 10], 'Run the job');
  const ask = note('src/main.py', [12, 13], 'Ask once');
  const retry = note('src/main.py', [15, 16], 'Retry transient errors');
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

test('a step that calls a function in another file holds its steps: the top drawing shows the calling step, and opening it shows the called steps', () => {
  const main = note('src/run.py', [1, 10], 'Run the job');
  const load = note('src/run.py', [2, 3], 'Load the rows');
  const send = note('src/send.py', [1, 12], 'Send all rows');
  const pack = note('src/send.py', [2, 5], 'Pack the rows');
  const post = note('src/send.py', [6, 11], 'Post each pack');
  const map = processOf([main, load, send, pack, post], [arrow(main, send, 'send them', 5)]);
  const [top, ...opened] = drawn(map);
  assert.deepEqual(Object.keys(top.nodes), ['s0']);
  assert.match(top.mermaid, /s0\["Run the job<br><i class='ns'>4 steps<\/i>"\]/);
  assert.deepEqual(top.nodes.s0.at, [{ file: 'src/run.py', from: 1, to: 10 }, { file: 'src/send.py', from: 1, to: 12 }]);
  assert.deepEqual(processesWithStepsIn(map, 'src/send.py').map((one) => one.lit), [['s0']]);
  const step = opened.find((one) => one.id === top.nodes.s0.down)!;
  assert.deepEqual(Object.keys(step.nodes), ['s1', 's2']);
  assert.equal(step.nodes.s2.down, 'process:p/2');
  assert.match(step.mermaid, /s1 --> s2/);
  assert.deepEqual(Object.keys(opened.find((one) => one.id === 'process:p/2')!.nodes), ['s3', 's4']);
});

test('a called step goes under the smallest step that holds the call and comes first in the list, never under a step inside itself; a call in the same file moves no step, and another caller calls a quiet box of it', () => {
  const run = note('src/a.py', [1, 20], 'Run it');
  const start = note('src/a.py', [2, 5], 'Start');
  const help = note('src/b.py', [1, 8], 'Help');
  const tool = note('src/c.py', [1, 4], 'Use the tool');
  const finish = note('src/a.py', [10, 15], 'Finish');
  const later = note('src/a.py', [30, 32], 'Clean up');
  const map = processOf([run, start, help, tool, finish, later], [
    arrow(finish, help, 'help again', 12), arrow(start, help, 'help', 3), arrow(help, tool, 'use it', 2), arrow(run, later, 'clean up', 18),
  ]);
  const parent = parentsWithCalls(map.processes![0], map.processes![0].steps);
  assert.deepEqual([help, tool, later].map((one) => parent.get(key(one))), [key(start), key(help), undefined]);
  const opened = drawn(map).find((one) => one.id === 'process:p/0')!;
  assert.deepEqual(Object.keys(opened.edgeLines!), ['s4>x2']);

  const inner = note('src/x.py', [3, 4], 'Check the input');
  const side = note('src/y.py', [1, 5], 'Ask the side');
  const outer = note('src/x.py', [1, 10], 'Read the input');
  const loop = processOf([inner, side, outer], [arrow(inner, side, 'ask', 3), arrow(side, outer, 'read again', 2)]);
  const around = parentsWithCalls(loop.processes![0], loop.processes![0].steps);
  assert.deepEqual([side, outer].map((one) => around.get(key(one))), [key(inner), undefined]);
  assert.equal(drawn(loop).length, 3);
});
