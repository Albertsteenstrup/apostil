// Tests for the marks and the look on a page (view/media/marks.js, read in Node): which rule wins a slot, the colours of both themes, the roll-up of
// marks to nodes and steps with the order of a stack, and one chip for a call out of the repo and its arrow. Made-up marks and rules.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_RULES } from '../shared/look';
import { SERVICES } from '../shared/marks';
import { lookRules } from './look-data';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const Marks = require('../../view/media/marks.js');

const mark = (value: string, file: string, line: number, set = 'services') => ({ set, value, file, line, at: line, name: 'call' });
const node = (paths: string[], marks: unknown[] = []) => ({ kind: 'node', diagram: 'top', node: 'n', paths, marks });

test('the rules: the default first; a rule changes only its own slots; the rule that names a thing most closely wins a slot, then the later one', () => {
  const thing = { ...node(['src/feed/'], [mark('book-feed', 'src/feed/read.py', 3)]), node: 'feed' };
  // With no look the logos of the services stand at the upper right.
  assert.deepEqual(Marks.resolve(DEFAULT_RULES, thing), { 'corners.upper-right': { set: 'services' } });
  const button = { icon: 'open.svg', name: 'Open' };
  const rules = [
    ...DEFAULT_RULES,
    { pick: { kind: 'node', paths: ['src/'] }, box: { color: '#2b6cb0' } }, // a path
    { pick: { kind: 'node' }, box: { color: '#15803d', shape: 'cyl' }, corners: { 'upper-right': button } }, // a kind, later
    { pick: { kind: 'node', mark: 'services:book-feed' }, box: { line: '#b45309' } }, // a mark
    { pick: { kind: 'node', diagram: 'top', nodes: ['feed'] }, box: { line: '#7e22ce' } }, // a node id
    { pick: { kind: 'note' }, note: { color: '#b45309' } }, // another kind: never a node
  ];
  assert.deepEqual(Marks.resolve(rules, thing), {
    'corners.upper-right': button, // the later kind rule takes the place of the logos of the services
    'box.color': '#2b6cb0', // the path wins over the later kind rule
    'box.shape': 'cyl', // only the kind rule sets the shape, so it keeps it
    'box.line': '#7e22ce', // the node id wins over the mark
  });
  // A thing that no rule but the default picks keeps the default.
  assert.deepEqual(Marks.resolve(rules.slice(0, DEFAULT_RULES.length + 2), { ...node(['docs/']), node: 'docs' }), { 'corners.upper-right': button, 'box.color': '#15803d', 'box.shape': 'cyl' });
  // An arrow is picked by nodes when both its ends are.
  const ends = [{ node: 'feed', paths: [] }, { node: 'jobs', paths: [] }];
  const arrowRule = [{ pick: { kind: 'arrow', nodes: ['feed', 'jobs'] }, arrow: { width: 2 } }];
  assert.deepEqual(Marks.resolve(arrowRule, { kind: 'arrow', ends, marks: [] }), { 'arrow.width': 2 });
  assert.deepEqual(Marks.resolve(arrowRule, { kind: 'arrow', ends: [ends[0], { node: 'desk', paths: [] }], marks: [] }), {});
  // The corner of a set of a look is a rule of its kinds, after the default and before the rules of the look.
  const sets = [SERVICES, { id: 'errors', name: 'Errors', rule: 'r', corner: { node: 'upper-right' as const, note: 'upper-left' as const } }];
  const withSet = lookRules(sets, [{ pick: { kind: 'node', mark: 'errors:*' }, corners: { 'upper-right': { set: 'services' } } }]);
  assert.deepEqual(Marks.resolve(withSet, thing)['corners.upper-right'], { set: 'errors' });
  assert.deepEqual(Marks.resolve(withSet, { ...thing, marks: [mark('state', 'src/feed/read.py', 4, 'errors')] })['corners.upper-right'], { set: 'services' });
});

test('the colours: one colour gives a light and a dark box whose words read at 4.5:1, and a line that stands out from both papers', () => {
  const light = [255, 255, 255];
  const dark = [24, 24, 27];
  for (const color of ['#2b6cb0', '#b45309', '#15803d', '#ffff00', '#777777', '#000000', '#ffffff', '#7e22ce', '#f0f']) {
    const box = Marks.boxColors(color);
    assert.ok(box, color);
    assert.ok(Marks.contrast(Marks.parse(box.light.fill), Marks.parse(box.light.text)) >= 4.5, `${color} light ${JSON.stringify(box.light)}`);
    assert.ok(Marks.contrast(Marks.parse(box.dark.fill), Marks.parse(box.dark.text)) >= 4.5, `${color} dark ${JSON.stringify(box.dark)}`);
    // The dark theme gets a deep fill, not the light one.
    assert.ok(Marks.contrast(Marks.parse(box.dark.fill), dark) < Marks.contrast(Marks.parse(box.light.fill), dark), color);
    const line = Marks.lineColors(color);
    assert.ok(Marks.contrast(Marks.parse(line.light), light) >= 3 && Marks.contrast(Marks.parse(line.dark), dark) >= 3, `${color} line ${JSON.stringify(line)}`);
  }
  // A blue gives a soft blue in the light theme with dark words, and a deep blue in the dark theme with light words.
  const blue = Marks.boxColors('#2b6cb0');
  assert.deepEqual([blue.light.text, blue.dark.text], ['#1f2328', '#e8eaed']);
});

test('the roll-up: a node holds the marks under its paths, a step the marks inside its lines, a stack puts the values that few nodes share first, and a call out of the repo whose line is a mark shows it in its box and on its arrow only', () => {
  const marks = [
    mark('table-store', 'src/lending/requests.py', 40), mark('table-store', 'src/jobs/night.py', 12), mark('table-store', 'db/one.sql', 5),
    mark('book-feed', 'src/lending/notices.py', 74), mark('book-feed', 'src/jobs/night.py', 30),
    mark('hours-desk', 'src/jobs/night.py', 50), mark('night-bell', 'src/jobs/night.py', 90), mark('state', 'src/jobs/night.py', 50, 'errors'),
  ];
  const diagram = {
    id: 'top', graph: { nodes: {}, edges: [] },
    nodes: {
      lending: { paths: [{ path: 'src/lending/' }] }, jobs: { paths: [{ path: 'src/jobs/night.py' }] }, data: { paths: [{ path: 'db/' }] },
      web: { paths: [{ path: 'web/' }] },
    },
  };
  const things = Marks.thingsOf(diagram, { marks, rules: DEFAULT_RULES });
  assert.deepEqual(Object.values(things).map((thing: any) => thing.marks.length), [2, 5, 1, 0]);
  assert.deepEqual(things.jobs.slots, { 'corners.upper-right': { set: 'services' } });
  const spread = Marks.spreadOf(Object.values(things));
  assert.deepEqual(spread, { 'services:table-store': 3, 'services:book-feed': 2, 'services:hours-desk': 1, 'services:night-bell': 1, 'errors:state': 1 });
  // On the node of the jobs: the values that only it holds first, the one that three nodes share last; three show, then "+1".
  const stack = Marks.stackOf(things.jobs.marks, 'services', spread);
  assert.deepEqual(stack.map((one: any) => `${one.value}:${one.marks.length}`), ['hours-desk:1', 'night-bell:1', 'book-feed:1', 'table-store:1']);
  assert.equal(Marks.SHOWN, 3);
  // A step holds the marks inside its lines; with its lines at the save of the map, a note in the file tab with the lines of the file now.
  const step = { kind: 'step', at: [{ file: 'src/jobs/night.py', from: 10, to: 40 }] };
  assert.deepEqual(Marks.marksIn(step, marks).map((one: any) => one.line), [12, 30]);
  const moved = { ...mark('book-feed', 'src/jobs/night.py', 30), at: 33 };
  assert.equal(Marks.holds({ ...step, now: true, at: [{ file: 'src/jobs/night.py', from: 31, to: 34 }] }, moved), true);
  // The named things of a value, once each, and the places with no fixed name.
  const named = Marks.namedThings([{ ...marks[0], thing: { kind: 'table', name: 'book_request' } }, { ...marks[1], thing: { kind: 'table', name: 'loan' } }, { ...marks[2], thing: { kind: 'table', name: 'loan' } }, marks[3]]);
  assert.deepEqual([named.named.map((one: any) => `${one.name}:${one.marks.length}`), named.plain.length], [['book_request:1', 'loan:2'], 1]);

  // A call out of the repo whose line is a mark shows it in its box and on its arrow, and the step that calls gets no second chip for it.
  {
    const marks = [mark('table-store', 'src/requests.py', 102), mark('table-store', 'src/requests.py', 94)];
    const diagram = {
      id: 'process:ask', graph: { nodes: {}, edges: [{ from: 's0', to: 'o0' }, { from: 's0', to: 'o1' }] },
      edgeLines: { 's0>o0': [{ file: 'src/requests.py', line: 103 }], 's0>o1': [{ file: 'src/requests.py', line: 102 }] },
      nodes: {
        s0: { kind: 'step', paths: [{ path: 'src/requests.py' }], at: [{ file: 'src/requests.py', from: 84, to: 106 }] },
        o0: { kind: 'call', paths: [], calls: [{ file: 'src/requests.py', line: 103 }] },
        o1: { kind: 'call', paths: [], calls: [{ file: 'src/requests.py', line: 102 }] },
      },
    };
    const look = { marks, rules: DEFAULT_RULES };
    const things = Marks.thingsOf(diagram, look);
    assert.deepEqual([things.s0.marks.map((one: any) => one.line), things.o0.marks.length, things.o1.marks.map((one: any) => one.line)], [[94], 0, [102]]);
    assert.deepEqual(things.o1.slots, { 'corners.upper-right': { set: 'services' } });
    const edges = Marks.edgesOf(diagram, look, things);
    assert.deepEqual(edges.map((edge: any) => edge.marks.map((one: any) => one.line)), [[], [102]]);
  }
});

