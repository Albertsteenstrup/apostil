// Tests for the parts of Home, the drawn processes and the graphs page that a look reaches (build 59), on the made-up example "library-app": a folded
// area box and a folded file box, a step opened in place, the direction of each level, the head of an arrow, the fields "is" of an arrow and "quiet" of
// a step, the order of panels, and the check of the new parts with the note of set-look for a rule that picks nothing.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { apostilCommands, lookProblems, type LookContext } from '../shared/look';
import { Store } from '../shared/store';
import { tempFolder } from '../shared/test-repo';
import { lookChanges } from '../store/look-changes';
import { saveMapDraft } from '../store/save';
import { EXAMPLE_LOOK, makeCheckExample } from './check-example';
import { homeData, type HomeDiagram } from './home-data';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const Marks = require('../../view/media/marks.js');

const example = makeCheckExample();
const store = new Store(tempFolder('apostil-store-'));
after(() => { store.close(); example.remove(); });
const map = JSON.parse(readFileSync(join(__dirname, '../../view/example-map.json'), 'utf8'));
assert.deepEqual(saveMapDraft(store, example.folder, map).problems, []);
const diagrams = homeData(store, example.folder).map!.diagrams;
const diagramOf = (id: string): HomeDiagram => diagrams.find((one) => one.id === id)!;
const context: LookContext = { folder: example.folder, map, commands: apostilCommands() };
type Edge = { from: string; to: string; label?: string; fields: Record<string, unknown>; slots: Record<string, unknown> };

/** A diagram in a look of these rules, as Home draws it: a step that a rule opens in place, its things and arrows, and what Mermaid gets. */
function drawn(id: string, rules: unknown[]) {
  const look = { marks: [], rules, one: ['content', 'click'], files: {} };
  const diagram = Marks.openSteps(diagramOf(id), look, (one: string) => diagrams.find((each) => each.id === one));
  const things = Marks.thingsOf(diagram, look);
  const edges: Edge[] = Marks.edgesOf(diagram, look, things);
  return { diagram, things, edges, shown: Marks.shownFlow(diagram, things, edges, Marks.boxesOf(diagram, look), Marks.drawingOf(diagram, look)) };
}
const pairs = (edges: { from: string; to: string }[]): string => edges.map((one) => `${one.from}>${one.to}`).join(' ');

test('a folded area box is one node with its title; the arrows of its nodes go to it, and the arrow inside it goes; with no rule the box is as written', () => {
  const { shown } = drawn('lib-lending', [{ pick: { kind: 'area-box', diagram: 'lib-lending' }, box: { color: '#2b6cb0' }, show: { folded: true } }]);
  assert.match(shown.text, /^ {2}holding\["Holds"\]$/m);
  assert.doesNotMatch(shown.text, /subgraph|service\[|models/);
  assert.equal(pairs(shown.graph.edges), 'shelf>holding holding>queue requests>queue shelf>perms queue>api');
  assert.equal(shown.graph.nodes.holding, 'Holds');
  assert.equal(drawn('lib-lending', []).shown.text, diagramOf('lib-lending').mermaid);
});

test('a file box takes the words of a rule with the name of its file, and folded it is one node with its arrows, as an area box', () => {
  const named = drawn('process:answer-request', [{ pick: { kind: 'file-box', paths: ['src/library/lending/'] }, content: { words: '{name} ({steps})' } }]).shown.text;
  assert.deepEqual(named.match(/subgraph f\d\[[^\]]*\]/g), ['subgraph f0["src/library/web/requests_router.py"]', 'subgraph f1["requests.py (2)"]', 'subgraph f2["notices.py (1)"]']);
  const { shown, edges } = drawn('process:answer-request', [{ pick: { kind: 'file-box', paths: ['src/library/lending/requests.py'] }, show: { folded: true } }]);
  assert.match(shown.text, /^ {2}f1\["src\/library\/lending\/requests\.py"\]$/m);
  assert.equal(pairs(edges), 's0>s1 s0>s2 s2>s12 s2>s13 s2>o0');
  assert.equal(pairs(shown.graph.edges), 's0>s1 s0>f1 f1>s13 f1>o0'); // the arrow to the step of requests.py inside it goes
});

test('a step whose rule says "folded": false holds its inner steps in its box, in place and one level deep, without the quiet boxes of the inner drawing', () => {
  const { diagram, shown } = drawn('process:answer-request', [{ pick: { kind: 'step', where: { title: 'Answer the request' } }, show: { folded: false } }]);
  assert.match(diagram.mermaid, /^ {4}subgraph s2\["Answer the request"\]\n {6}s2_s3\["Lock the requests for the book"\]/m);
  const inner = Object.keys(diagram.nodes).filter((id) => id.startsWith('s2_'));
  assert.deepEqual(inner, ['s2_s3', 's2_s4', 's2_s5', 's2_s6', 's2_s7', 's2_s8', 's2_s9', 's2_s10', 's2_s11']);
  // The arrows of the process keep their numbers; the inner arrows follow, the branches dotted with their words.
  assert.equal(pairs(diagram.graph.edges.slice(0, 5)), 's0>s1 s0>s2 s2>s12 s2>s13 s2>o0');
  assert.match(diagram.mermaid, /s2_s5 -\.->\|"when the key repeats"\| s2_s11$/m);
  assert.equal(shown.text, diagram.mermaid); // nothing else in the look changes it
  assert.equal(drawn('process:answer-request', []).diagram, diagramOf('process:answer-request'));
});

test('the direction of each level; a branch arrow of an opened step that a rule leaves out keeps the order of its steps as a plain arrow', () => {
  const place = diagrams.find((one) => one.id.startsWith('processes:'))!.id;
  const turned = (id: string, level: string, direction: string) => drawn(id, [{ pick: { kind: 'process-drawing', where: { level } }, layout: { direction } }]).shown.text.split('\n')[0];
  assert.deepEqual([turned(place, 'processes', 'down'), turned('process:answer-request', 'process', 'down'), turned('process:answer-request/2', 'step', 'right')], ['flowchart TB', 'flowchart TB', 'flowchart LR']);
  assert.equal(turned('process:answer-request/2', 'process', 'right'), 'flowchart TB'); // another level: as it was
  const { shown } = drawn('process:answer-request/2', [{ pick: { kind: 'arrow', diagram: 'process:answer-request', where: { is: 'branch' } }, show: { shown: false } }]);
  assert.doesNotMatch(shown.text, /-\.->|s5 .*s11/);
  assert.match(shown.text, /^ {2}s8 --> s9$/m);
});

test('the head of an arrow: none takes it away, dot puts the dot of Mermaid in its place, and a rule gives it to the arrows that it picks', () => {
  const marker = 'url(#apostil-3_flowchart-v2-pointEnd)';
  assert.deepEqual([Marks.headOf(marker, 'none'), Marks.headOf(marker, 'dot'), Marks.headOf(marker, 'arrow')], [null, 'url(#apostil-3_flowchart-v2-circleEnd)', marker]);
  const { edges } = drawn('lib-top', [{ pick: { kind: 'arrow', diagram: 'lib-top', nodes: ['jobs', 'lending'] }, arrow: { head: 'dot' } }]);
  assert.deepEqual(edges.filter((one) => one.slots['arrow.head']).map((one) => `${one.from}>${one.to}`), ['jobs>lending']);
});

test('"is" of an arrow and "quiet" of a step pick the right things: a rule hides the calls out of the repo, or the quiet steps, alone', () => {
  const is = (id: string) => [...new Set(drawn(id, []).edges.map((one) => one.fields.is))].join();
  const place = diagrams.find((one) => one.id.startsWith('processes:'))!.id;
  assert.deepEqual([is('lib-top'), is('process:answer-request'), is('process:answer-request/2'), is(place)], ['diagram', 'writer', 'writer,branch', 'handoff']);
  const left = (rules: unknown[]) => Object.keys(drawn('process:answer-request/2', rules).shown.graph.nodes).filter((id) => !/^s\d+$/.test(id)).join();
  assert.equal(left([]), 'x12,x13,o0');
  assert.equal(left([{ pick: { kind: 'call' }, show: { shown: false } }]), 'x12,x13');
  assert.equal(left([{ pick: { kind: 'step', where: { quiet: true } }, show: { shown: false } }]), 'o0');
});

test('the panels: those of a level are left out, and an order puts the ids of "first" first, then by a field', () => {
  const rules = [{ pick: { kind: 'panel', where: { level: 'change' } }, show: { shown: false } }, { pick: { kind: 'panel' }, order: { by: 'level', first: ['lib-tables'] } }];
  const panel = (id: string, level: string) => ({ id, fields: { id, level, type: 'flow', branch: '', title: id } });
  const rows = [panel('lib-top', 'map'), panel('', 'change'), panel('offer-flow', 'function'), panel('lib-tables', 'map')]
    .filter((row) => Marks.resolve(rules, { kind: 'panel', fields: row.fields })['show.shown'] !== false);
  const order = Object.fromEntries(Object.entries(Marks.resolve(rules, { kind: 'panel', fields: {} })).map(([slot, value]) => [slot.replace('order.', ''), value]));
  assert.deepEqual(Marks.orderRows(rows, order)[0].rows.map((row: { id: string }) => row.id), ['lib-tables', 'offer-flow', 'lib-top']);
});

test('the made-up look of this build passes the check; a fault of a new part has its sentence; set-look notes a rule that picks nothing now', () => {
  assert.deepEqual(lookProblems(JSON.parse(readFileSync(join(EXAMPLE_LOOK, 'look-home.json'), 'utf8')), context), []);
  const problems = (...rules: unknown[]): string[] => lookProblems({ rules }, context);
  assert.match(problems({ pick: { kind: 'trail' }, text: { color: '#2b6cb0' } })[0], /^Rule 1: "pick" must name a "kind": one of .*trail-step.*\. The nearest is "trail-step"\.$/);
  assert.deepEqual(problems({ pick: { kind: 'trail-step', where: { kind: 'map' } }, text: { color: '#2b6cb0' } }), ['Rule 1, "pick": a step of the trail has no field "kind". Its fields are "of", "name".']);
  assert.deepEqual(problems({ pick: { kind: 'arrow' }, arrow: { head: 'circle' } }), ['Rule 1, "arrow": "head" must be one of arrow, none, dot.']);
  assert.deepEqual(problems({ pick: { kind: 'process-drawing' }, layout: { direction: 'up' } }), ['Rule 1, "layout": "direction" must be right or down.']);
  assert.deepEqual(problems({ pick: { kind: 'panel' }, order: { by: 'size' } }), ['Rule 1, "order": a panel has no field "size". Its fields are "id", "level", "type", "branch", "title".']);
  assert.deepEqual(problems({ pick: { kind: 'area-box' }, show: { shown: false } }), ['Rule 1, "show": an area box cannot be shown. An area box takes only "folded".']);
  const look = { rules: [{ pick: { kind: 'area-box' as const, diagram: 'lib-top' }, box: { color: '#2b6cb0' } }, { pick: { kind: 'area-box' as const }, show: { folded: true } }, { pick: { kind: 'header' as const }, show: { shown: false } }] };
  assert.deepEqual(lookChanges(store, example.folder, look), {
    changes: ['Rule 1: 0 area boxes get a colour.', 'Rule 2: 1 area box gets folded or open.', 'Rule 3: each header line that it picks gets shown or hidden.'],
    notes: ['Rule 1 picks nothing now: the diagram "lib-top" has no area box.'],
  });
});
