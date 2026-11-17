// Tests for how the options of a look reach the agent: `apostil look-slots` in layers (the core and the index, one area, a search, the whole list),
// with its sizes as a contract; `apostil set-look --check`, which saves nothing; what each rule picks now; and the nearest right name.
// On the made-up example of the checks (view/check-example/, the repo "library-app").

import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { repoId } from '../shared/git';
import { apostilCommands, LOOK_PARTS, lookProblems, nearest } from '../shared/look';
import { compactJson, lookSlots } from '../shared/look-slots';
import { Store } from '../shared/store';
import { runApostil, tempFolder } from '../shared/test-repo';
import { EXAMPLE_LOOK, makeCheckExample, putLookFiles } from '../view/check-example';
import { addMarksToMap } from './marks-save';
import { saveMapDraft } from './save';

const PROMPT = readFileSync(join(__dirname, '../../skills/apostil-map-repo/look-writer-prompt.md'), 'utf8');
const AREAS = Object.keys(LOOK_PARTS.areas);

/** The made-up example once for all tests: the repo with its map and the marks of the services, in a store of its own. */
let made: { folder: string; env: Record<string, string>; store: Store } | undefined;
function example() {
  if (made) return made;
  const repo = makeCheckExample();
  const store = new Store(tempFolder('apostil-store-'));
  assert.deepEqual(saveMapDraft(store, repo.folder, JSON.parse(readFileSync(join(__dirname, '../../view/example-map.json'), 'utf8'))).problems, []);
  for (const draft of JSON.parse(readFileSync(join(EXAMPLE_LOOK, 'marks.json'), 'utf8')).filter((one: { set: string }) => one.set === 'services')) {
    putLookFiles(repo.folder);
    assert.deepEqual(addMarksToMap(store, repo.folder, draft).problems, []);
  }
  putLookFiles(repo.folder);
  process.on('exit', () => repo.remove());
  made = { folder: repo.folder, env: { APOSTIL_HOME: store.folder }, store };
  return made;
}
const apostil = (args: string[]) => runApostil(args, { cwd: example().folder, env: example().env });

test('look-slots with no argument prints the core and one index line for each area, and the three sizes hold', () => {
  const run = runApostil(['look-slots'], { env: { APOSTIL_HOME: tempFolder('apostil-store-') } });
  const { core, areas, more } = JSON.parse(run.stdout);
  // The core: the box, the arrow without its button, the colour of a note, the corners, every pick, and the form of each target; of the content
  // only its words, of "show" only "shown", and the click (build 57).
  assert.deepEqual(Object.keys(core.slots), ['box', 'content', 'corners', 'note', 'arrow', 'show', 'click']);
  assert.deepEqual([Object.keys(core.slots.arrow.fields), Object.keys(core.slots.content.fields), Object.keys(core.slots.show.fields), core.slots.click.target], [['color', 'width', 'dashed'], ['words'], ['shown'], true]);
  // The targets of build 51 are in the core; the others in the area "clicks".
  assert.deepEqual([Object.keys(core.picks), Object.keys(core.targets)], [Object.keys(LOOK_PARTS.picks), ['file', 'url', 'command', 'prompt', 'place']]);
  assert.deepEqual(areas.map((one: { id: string; line: string }) => one.line.startsWith(`${one.id}: `) && one.id), AREAS);
  assert.match(more, /look-slots <area>.*--find "<words>".*--all/);
  // An agent pays for each character: the prompt and this answer at most 9,000 (room for one index line of each area of the builds 58 to 62),
  // each index line at most 110, one area at most 3,000, one search at most 2,000.
  assert.ok(PROMPT.length + run.stdout.length <= 9000, `the prompt ${PROMPT.length} and the answer ${run.stdout.length}`);
  for (const one of areas as { id: string; line: string }[]) assert.ok(one.line.length <= 110, `the index line of ${one.id}: ${one.line.length}`);
  for (const id of AREAS) {
    const size = runApostil(['look-slots', id], { env: { APOSTIL_HOME: tempFolder('apostil-store-') } }).stdout.length;
    assert.ok(size <= 3000, `the area ${id}: ${size}`);
  }
  // Every word of the list as a search, and pairs of them, as the command prints them.
  const words = [...new Set(JSON.stringify(LOOK_PARTS).toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 3))];
  for (const [at, word] of words.entries()) {
    for (const asked of [word, `${word} ${words[(at * 7 + 3) % words.length]}`]) {
      const size = compactJson(lookSlots('', asked, false).output).length + 1;
      assert.ok(size <= 2000, `the search "${asked}": ${size}`);
    }
  }
});

test('look-slots <area> prints only the parts of that area; an unknown area names the nearest and fails', () => {
  const home = { env: { APOSTIL_HOME: tempFolder('apostil-store-') } };
  const processes = JSON.parse(runApostil(['look-slots', 'processes'], home).stdout);
  // Every slot of its components; a slot of another area is one line that names it (build 57).
  assert.deepEqual([Object.keys(processes.components), Object.keys(processes.slots)], [['step', 'call'], ['box', 'content', 'corners', 'show', 'text', 'click', 'input', 'window']]);
  assert.deepEqual([processes.slots.window, Object.keys(processes.slots.box.fields)], ['the area windows gives its fields', Object.keys(LOOK_PARTS.slots.box.fields)]);
  assert.deepEqual(processes.components.call.example, LOOK_PARTS.components.call.example);
  const marks = JSON.parse(runApostil(['look-slots', 'marks'], home).stdout);
  assert.deepEqual([marks.components, Object.keys(marks.slots), marks.targets, marks.sets.form], [undefined, ['corners'], undefined, LOOK_PARTS.sets.form]);
  // Every target, and the slots of a click and other input, are in the area "clicks" (build 57).
  const clicks = JSON.parse(runApostil(['look-slots', 'clicks'], home).stdout);
  assert.deepEqual([Object.keys(clicks.slots), Object.keys(clicks.targets)], [['click', 'input'], Object.keys(LOOK_PARTS.targets)]);
  const wrong = runApostil(['look-slots', 'diagram'], home);
  assert.equal(wrong.status, 1);
  assert.deepEqual(JSON.parse(wrong.stdout).problems, ['"diagram" is no area. The areas are diagrams, processes, notes, marks, clicks, windows, lists. The nearest is "diagrams".']);
  assert.deepEqual(JSON.parse(runApostil(['look-slots', 'colours'], home).stdout).problems, ['"colours" is no area. The areas are diagrams, processes, notes, marks, clicks, windows, lists.']);
});

test('look-slots --find finds a part by a word of its "what" and by one of its "words"; words that fit nothing say so and print the index', () => {
  const home = { env: { APOSTIL_HOME: tempFolder('apostil-store-') } };
  const find = (words: string) => JSON.parse(runApostil(['look-slots', '--find', words], home).stdout);
  // "tab" stands only in the "what" of a note; "badge" only in the "words" of the corners.
  const [note] = find('tab').matches;
  assert.deepEqual([note.name, note.is, note.area, note.example], ['note', 'component', 'notes', LOOK_PARTS.components.note.example]);
  const [corners] = find('a badge').matches;
  assert.deepEqual([corners.name, corners.is, corners.area, corners.example], ['corners', 'slot', 'marks', LOOK_PARTS.slots.corners.example]);
  // A hit in a name counts more: "dashed" finds the two fields of that name first.
  assert.deepEqual(find('dashed').matches.slice(0, 2).map((one: { name: string }) => one.name), ['box.dashed', 'arrow.dashed']);
  const none = find('zebra quilt');
  assert.equal(none.found, 'Nothing in the list fits "zebra quilt". Read the index lines; when none fits, tell the owner and leave it out.');
  assert.deepEqual(none.areas.map((one: { id: string }) => one.id), AREAS);
});

test('every component has an area with an index line, and each example of the list passes the check on the made-up example with the placeholders filled', () => {
  const { folder, store } = example();
  const fill = (rule: unknown): unknown => JSON.parse(JSON.stringify(rule).replaceAll('<folder>/', 'src/library/lending/').replaceAll('<file>', 'src/library/night_jobs.py')
    .replaceAll('<diagram>', 'lib-top').replaceAll('<node>', 'jobs').replaceAll('<set>:<value>', 'services:table-store'));
  const context = { folder, map: store.getMap(repoId(folder))?.map, commands: apostilCommands() };
  // "order" has no example until a component is a list (briefs 59 to 61); every other part has one.
  const examples: Record<string, { example?: unknown }> = { ...LOOK_PARTS.components, ...Object.fromEntries(Object.entries(LOOK_PARTS.slots).map(([name, slot]) => [`slot ${name}`, slot])) };
  for (const [name, part] of Object.entries(examples).filter(([name]) => name !== 'slot order')) assert.deepEqual(lookProblems({ rules: [fill(part.example)] }, context), [], name);
  for (const [name, component] of Object.entries(LOOK_PARTS.components)) assert.ok(AREAS.includes(component.area), name);
});

test('set-look --check saves nothing and removes no file; a wrong kind, slot, field and node id each name the nearest; each rule says what it picks now', () => {
  const { folder } = example();
  writeFileSync(join(folder, 'apostil-look.json'), readFileSync(join(EXAMPLE_LOOK, 'look.json')));
  const run = apostil(['set-look', '--check', 'apostil-look.json']);
  assert.equal(run.status, 0, run.stdout);
  const checked = JSON.parse(run.stdout);
  for (const name of ['apostil-look.json', 'apostil-look-open.svg', 'apostil-look-shelf.mp4']) assert.ok(existsSync(join(folder, name)), name);
  assert.equal(JSON.parse(apostil(['look']).stdout).look, 'default');
  // The things that each rule picks now, as the page picks them: the services are marked, the set "errors" is not marked yet.
  assert.deepEqual(checked, {
    ok: true, problems: [],
    changes: [
      'Rule 1: 8 nodes get a colour.', 'Rule 2: 1 node gets a shape.', 'Rule 3: 1 node gets a picture.', 'Rule 4: 1 node gets a film.',
      'Rule 5: 1 node gets a new upper-left corner.', 'Rule 6: 1 arrow gets a colour and a width.', 'Rule 7: 0 steps get a line colour and a line width.',
      'Rule 8: 0 notes get a colour of the bar.',
    ],
    notes: ['Rule 7 picks nothing now: no step holds a mark "errors:state".', 'Rule 8 picks nothing now: no note holds a mark "errors:*".'],
  });
  // A rule of the services picks the steps, calls and notes whose code holds a mark.
  writeFileSync(join(folder, 'apostil-look-calls.json'), JSON.stringify({ rules: [{ pick: { kind: 'call', mark: 'services:table-store' }, box: { dashed: true } }] }));
  assert.match(JSON.parse(apostil(['set-look', '--check', 'apostil-look-calls.json']).stdout).changes[0], /^Rule 1: [1-9]\d* calls? gets? a dashed or solid line\.$/);

  writeFileSync(join(folder, 'apostil-look-wrong.json'), JSON.stringify({ rules: [
    { pick: { kind: 'nod' }, box: { color: '#2b6cb0' } },
    { pick: { kind: 'node' }, boxes: { color: '#2b6cb0' } },
    { pick: { kind: 'node' }, box: { colour: '#2b6cb0' } },
    { pick: { kind: 'node', diagram: 'lib-top', nodes: ['job'] }, box: { dashed: true } },
    { pick: { kind: 'step', diagram: 'process:ask-requests' }, box: { dashed: true } },
  ] }));
  const wrong = apostil(['set-look', '--check', 'apostil-look-wrong.json']);
  assert.equal(wrong.status, 1);
  assert.deepEqual(JSON.parse(wrong.stdout), {
    ok: false, changes: [], notes: [],
    problems: [
      'Rule 1: "pick" must name a "kind": one of node, step, call, arrow, note. The nearest is "node".',
      'Rule 2: "boxes" is no slot. The slots are "box", "content", "corners", "note", "arrow", "show", "order", "text", "click", "input", "window". The nearest is "box".',
      'Rule 3, "box": "colour" is no field here. Use only "color", "line", "width", "dashed", "shape". The nearest is "color".',
      'Rule 4: the diagram "lib-top" has no node "job". Its nodes are web, routes, lending, jobs, desk, data, checks, writing. The nearest is "jobs".',
      'Rule 5: "process:ask-requests" is no diagram of the map. apostil map lists the ids of the diagrams; a process is "process:<id>". The nearest is "process:ask-request".',
    ],
  });
  assert.ok(existsSync(join(folder, 'apostil-look-wrong.json')));
});

test('set-look prints what each rule picks now after a save that worked', () => {
  const { folder } = example();
  writeFileSync(join(folder, 'apostil-look.json'), readFileSync(join(EXAMPLE_LOOK, 'look.json')));
  putLookFiles(folder);
  const checked = JSON.parse(apostil(['set-look', '--check', 'apostil-look.json']).stdout);
  const saved = JSON.parse(apostil(['set-look', 'apostil-look.json']).stdout);
  assert.equal(saved.saved, true, JSON.stringify(saved));
  assert.deepEqual([saved.changes, saved.notes], [checked.changes, checked.notes]);
  assert.equal(JSON.parse(apostil(['look']).stdout).rules.length, 8);
});

test('the nearest right name: one or two letters changed, or the same first three letters; none when no name is close', () => {
  assert.equal(nearest('colour', ['color', 'line', 'width']), 'color');
  assert.equal(nearest('Boxes', ['box', 'content']), 'box');
  assert.equal(nearest('lin', ['line', 'link']), 'line'); // both one letter away: the first
  assert.equal(nearest('processes', ['process:ask', 'notes']), 'process:ask'); // the same first three letters
  assert.equal(nearest('zebra', ['box', 'content', 'corners']), undefined);
});
