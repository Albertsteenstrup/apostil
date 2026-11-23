// Tests for the marks and the look on a page (view/media/marks.js, read in Node): which rule wins a slot, the colours of both themes, the roll-up of
// marks to nodes and steps with the order of a stack, and one chip for a call out of the repo and its arrow. Made-up marks and rules.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { flowGraph } from '../shared/diagram-graph';
import { DEFAULT_RULES } from '../shared/look';
import { SERVICES } from '../shared/marks';
import { lookRules } from '../shared/look-data';

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

test('the roll-up: a node holds the marks under its paths, a step the marks inside its lines, a stack puts the values that few nodes share first, and a call out of the repo whose line is a mark shows it in its box only', () => {
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

  // A call out of the repo whose line is a mark shows it in its box, once: the step that calls gets no second chip for it, and its arrow none either
  // (tested below).
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
    assert.deepEqual(edges.map((edge: any) => edge.marks.map((one: any) => one.line)), [[], []]);
  }
});

// One icon for one service between an arrow and its two ends.
test('an arrow shows no mark that one of its ends shows already: the call box of that service, or the step that holds the same mark', () => {
  const marks = [mark('book-feed', 'src/ask.py', 12), mark('table-store', 'src/ask.py', 20), mark('night-bell', 'src/tell.py', 7)];
  const diagram = {
    id: 'process:ask', graph: { nodes: {}, edges: [{ from: 's0', to: 'o0' }, { from: 's0', to: 's1' }, { from: 's1', to: 's0' }] },
    // The first arrow starts at the line that calls the service; the second inside the lines of its step; the third at a line that no end holds.
    edgeLines: { 's0>o0': [{ file: 'src/ask.py', line: 12 }], 's0>s1': [{ file: 'src/ask.py', line: 20 }], 's1>s0': [{ file: 'src/tell.py', line: 7 }] },
    nodes: {
      s0: { kind: 'step', paths: [{ path: 'src/ask.py' }], at: [{ file: 'src/ask.py', from: 10, to: 30 }] },
      s1: { kind: 'step', paths: [{ path: 'src/tell.py' }], at: [{ file: 'src/tell.py', from: 20, to: 40 }] },
      o0: { kind: 'call', paths: [], calls: [{ file: 'src/ask.py', line: 12 }] },
    },
  };
  const shown = (rules: unknown[]): number[][] => {
    const look = { marks, rules };
    return Marks.edgesOf(diagram, look, Marks.thingsOf(diagram, look)).map((edge: any) => edge.marks.map((one: any) => one.line));
  };
  // The call box shows the service of line 12 and the step that of line 20, so their arrows show nothing; the mark of line 7 stands on its arrow only.
  assert.deepEqual(shown(DEFAULT_RULES), [[], [], [7]]);
  // The end still holds the use at the line of the arrow: its window lists it.
  const things = Marks.thingsOf(diagram, { marks, rules: DEFAULT_RULES });
  assert.deepEqual([things.o0.marks.map((one: any) => one.line), things.s0.marks.map((one: any) => one.line)], [[12], [20]]);
  // An end that holds the mark and does not show it (a rule gave its corner to another set) leaves the icon to the arrow.
  assert.deepEqual(shown([...DEFAULT_RULES, { pick: { kind: 'call' }, corners: { 'upper-right': { set: 'errors' } } }]), [[12], [], [7]]);
  // A rule picks an arrow by a mark at its line also when the arrow does not show it.
  const picked = Marks.edgesOf(diagram, { marks, rules: [...DEFAULT_RULES, { pick: { kind: 'arrow', mark: 'services:book-feed' }, arrow: { width: 2 } }] }, things);
  assert.deepEqual(picked.map((edge: any) => edge.slots['arrow.width']), [2, undefined, undefined]);
});

// ----- the shared kinds of every component: the fields, what shows, the words, an order, the window of the pointer -----

test('the pick "where" picks by a field of a thing, and ranks after a path and before a kind', () => {
  const diagram = {
    id: 'top', graph: { nodes: { feed: 'Feed', jobs: 'Night jobs' }, edges: [] },
    nodes: { feed: { paths: [{ path: 'src/feed/' }], files: 4, down: 'feed-area' }, jobs: { paths: [{ path: 'src/jobs/' }], files: 2 } },
  };
  const rules = [
    { pick: { kind: 'node' }, box: { color: '#111111' } }, // a kind
    { pick: { kind: 'node', where: { down: false } }, box: { color: '#222222', line: '#222222' } }, // a field wins over the later kind rule below
    { pick: { kind: 'node', paths: ['src/jobs/'] }, box: { line: '#333333' } }, // a path wins over a field
    { pick: { kind: 'node', where: { files: [2, 3] } }, text: { size: 'small' } }, // one of a list of values
    { pick: { kind: 'node' }, box: { dashed: true, color: '#444444' } }, // a later kind
  ];
  const things = Marks.thingsOf(diagram, { marks: [], rules });
  assert.deepEqual(things.jobs.fields, { title: 'Night jobs', files: 2, down: false });
  assert.deepEqual(things.jobs.slots, { 'box.color': '#222222', 'box.line': '#333333', 'text.size': 'small', 'box.dashed': true });
  assert.deepEqual(things.feed.slots, { 'box.color': '#444444', 'box.dashed': true });
  // A step and a call read their own fields; the names of a call are a list, and "where" finds one of them.
  const step = { kind: 'step', paths: [{ path: 'src/run.py' }], note: { title: 'Run the rows' }, steps: 3 };
  assert.deepEqual(Marks.fieldsOf('step', 's0', step, diagram), { title: 'Run the rows', file: 'src/run.py', steps: 3, is: 'step', quiet: false });
  assert.equal(Marks.picks({ kind: 'call', where: { name: 'send' } }, { kind: 'call', fields: Marks.fieldsOf('call', 'o0', { paths: [], names: ['send', 'read'], note: { title: 'smtplib' } }, diagram) }), true);
});

test('what shows: a node that is not shown leaves the flow chart with its arrows, an arrow can leave alone or get new words, and the rest stays as written', () => {
  const mermaid = ['flowchart LR', '  web["Web pages"] -->|"calls"| routes["Web routes"]', '  jobs["Night jobs"] -->|"wakes &lt;each&gt;"| lending["Lending"]',
    '  checks["Tests"] -.->|"try"| lending', '  a & b --> c --> d', '  subgraph f0["src/x.py"]', '    s1["One step"]', '  end', '  class checks,s1 elsewhere'].join('\n');
  const graph = { nodes: { web: 'Web pages', routes: 'Web routes', jobs: 'Night jobs', lending: 'Lending', checks: 'Tests', a: 'a', b: 'b', c: 'c', d: 'd', s1: 'One step' }, edges: flowGraph(mermaid).edges.map(({ from, to, label }) => ({ from, to, ...(label ? { label } : {}) })) };
  const hide = new Set(['checks', 's1', 'b']);
  const things = Object.fromEntries(Object.keys(graph.nodes).map((node) => [node, { node, slots: hide.has(node) ? { 'show.shown': false } : {} }]));
  const edges = graph.edges.map((edge: { from: string; label?: string }, at: number) => ({ ...edge, fields: { words: edge.label ?? '', of: edge.from }, slots: at === 0 ? { 'show.shown': false } : at === 1 ? { content: { words: '{words} night · from {of}' } } : {} }));
  const shown = Marks.shownFlow({ mermaid, graph }, things, edges);
  // The text draws the graph without them: what flowGraph reads of it is the graph less the hidden nodes and their arrows.
  const drawn = flowGraph(shown.text);
  assert.deepEqual([...drawn.nodes.keys()].sort(), ['a', 'c', 'd', 'jobs', 'lending', 'routes', 'web']);
  assert.deepEqual(drawn.edges.map((edge) => `${edge.from}>${edge.to}:${edge.label ?? ''}`), ['jobs>lending:wakes <each> night · from jobs', 'a>c:', 'c>d:']);
  assert.deepEqual(shown.graph.edges.map((edge: { from: string; to: string }) => `${edge.from}>${edge.to}`), ['jobs>lending', 'a>c', 'c>d']);
  assert.match(shown.text, /jobs -->\|"wakes &lt;each&gt; night · from jobs"\| lending/); // the words of the repo are escaped
  assert.ok(!/subgraph|elsewhere/.test(shown.text), 'a group left empty goes, and a class names no hidden node');
  // With nothing hidden and no new words, the text is the text as written.
  assert.equal(Marks.shownFlow({ mermaid, graph }, {}, graph.edges.map((edge) => ({ ...edge, slots: {} }))).text, mermaid);
});

test('words with fields are filled in and escaped; an order puts the ids of "first" first, sorts by a field and groups by another', () => {
  assert.equal(Marks.fillWords('{title} · {files} files · {name}', { title: 'Jobs <night>', files: 3, name: ['send', 'read'] }), 'Jobs &lt;night&gt; · 3 files · send, read');
  const rows = [{ id: 'a', fields: { size: 3, kind: 'x' } }, { id: 'b', fields: { size: 9, kind: 'y' } }, { id: 'c', fields: { size: 1, kind: 'x' } }, { id: 'd', fields: { size: 5, kind: 'y' } }];
  const ids = (groups: { group?: string; rows: { id: string }[] }[]) => groups.map((group) => `${group.group ?? ''}:${group.rows.map((row) => row.id).join('')}`);
  assert.deepEqual(ids(Marks.orderRows(rows, { by: 'size' })), [':cadb']);
  assert.deepEqual(ids(Marks.orderRows(rows, { by: 'size', down: true, first: ['c'] })), [':cbda']);
  assert.deepEqual(ids(Marks.orderRows(rows, { by: 'size', group: 'kind' })), ['x:ca', 'y:db']);
});

test('a window of the pointer from sections: the order and the width of the rule, without the sections that it does not name, and the lines of what a click does first', () => {
  const sections = [{ id: 'files', html: '<f>' }, { id: 'changes', html: '<c>' }, { id: 'marks', html: '<m>' }, { id: 'where', sub: 'run.py · line 3' }];
  const plain = Marks.windowOf({ title: 'Jobs', sub: '3 files', width: 520, sections });
  assert.deepEqual([plain.width, plain.sub, plain.body], [520, '3 files · run.py · line 3', '<f><c><m>']);
  const ruled = Marks.windowOf({ title: 'Jobs', sub: '3 files', width: 520, sections }, { 'window.sections': ['changes', 'files'], 'window.width': 440, click: { graphs: 'src/jobs/' } });
  assert.deepEqual([ruled.width, ruled.sub, ruled.ids], [440, '3 files', ['changes', 'files']]);
  assert.equal(ruled.body, '<div class="lk-does"><p>Click: Opens the graphs of src/jobs/.</p></div><c><f>');
  assert.deepEqual(Marks.inputWords({ 'input.alt': { file: 'a.py', line: 3 }, 'input.key': { g: { pull: 12 } }, 'input.menu': [{ name: 'One', target: { comment: true } }] }),
    ['Alt+click: Opens a.py at line 3.', 'Key G: Opens pull request #12.', 'Right click: 1 entry']);
});

