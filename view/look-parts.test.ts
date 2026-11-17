// Tests for the shared kinds of every component of a look (shared/look.ts): the fields and the pick "where", what shows and the words, one list of
// targets with the commands and keys that a look may use, the sections of a window, and the parts that each later build adds. On the made-up example.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { apostilCommands, LOOK_COMMANDS, LOOK_PARTS, lookProblems, nearest, PAGE_KEYS, valueProblem, type Component, type LookContext } from '../shared/look';
import type { RepoMap } from '../shared/repo-map';
import { EXAMPLE_LOOK, makeCheckExample } from './check-example';

const example = makeCheckExample();
after(() => example.remove());
const map: RepoMap = JSON.parse(readFileSync(join(__dirname, '../../view/example-map.json'), 'utf8'));
const context: LookContext = { folder: example.folder, map, commands: apostilCommands() };
const problems = (...rules: unknown[]): string[] => lookProblems({ rules }, context);
const jobs = { kind: 'node', diagram: 'lib-top', nodes: ['jobs'] };
const readLook = (name: string): unknown => JSON.parse(readFileSync(join(EXAMPLE_LOOK, name), 'utf8'));

test('a look saved by build 51 still passes the check, and so does the shared look of the example', () => {
  assert.deepEqual(lookProblems(readLook('look.json'), context), []);
  assert.deepEqual(lookProblems(readLook('look-shared.json'), context), []);
});

test('each new part has an area, other words and an example that passes the check on the made-up example', () => {
  const fill = (rule: unknown): unknown => JSON.parse(JSON.stringify(rule).replaceAll('<diagram>', 'lib-top').replaceAll('<node>', 'jobs')
    .replaceAll('<folder>/', 'src/library/jobs/').replaceAll('<file>', 'src/library/night_jobs.py').replaceAll('<set>:<value>', 'services:postgresql'));
  const all: Record<string, unknown> = { ...LOOK_PARTS.slots, ...LOOK_PARTS.picks, ...LOOK_PARTS.targets };
  const parts = ['show', 'order', 'text', 'click', 'input', 'window', 'where', 'graphs', 'folder', 'change', 'pull', 'comment'].map((name) => [name, all[name]] as [string, { area: string; words: readonly string[]; example?: unknown }]);
  for (const [name, part] of parts) {
    assert.ok(Object.keys(LOOK_PARTS.areas).includes(part.area) && part.words.length, name);
    // "order" has no example until a component is a list (the briefs 59 to 61): no component takes it yet.
    if (name === 'order') { assert.equal(part.example, undefined); continue; }
    assert.deepEqual(problems(fill(part.example)), [], name);
  }
});

test('the pick "where": a field that the component does not have names its fields and the nearest one; a field with fixed values lists them', () => {
  assert.deepEqual(problems({ pick: { kind: 'node', where: { down: false } }, text: { size: 'small' } }), []);
  assert.deepEqual(problems({ pick: { kind: 'step', where: { is: ['step', 'process'], steps: 3 } }, text: { size: 'small' } }), []);
  assert.deepEqual(problems({ pick: { kind: 'node', where: { level: 2 } }, text: { size: 'small' } }), ['Rule 1, "pick": a node has no field "level". Its fields are "title", "files", "down".']);
  assert.deepEqual(problems({ pick: { kind: 'node', where: { file: 'x' } }, text: { size: 'small' } }), ['Rule 1, "pick": a node has no field "file". Its fields are "title", "files", "down". The nearest is "files".']);
  assert.deepEqual(problems({ pick: { kind: 'step', where: { is: 'task' } }, text: { size: 'small' } }), ['Rule 1, "pick": "task" is no value of "is". The values are step, process.']);
  assert.deepEqual(problems({ pick: { kind: 'node', where: { files: 'many' } }, text: { size: 'small' } }), ['Rule 1, "pick": "files" of a node is a whole number, or a list of them.']);
});

test('a field of a slot that the component does not take, and words that name a field that it does not have, each have one sentence', () => {
  assert.deepEqual(problems({ pick: jobs, show: { folded: true } }), ['Rule 1, "show": a node cannot be folded. A node takes only "shown".']);
  assert.deepEqual(problems({ pick: { kind: 'note' }, content: { words: '{title}' } }), ['Rule 1, "content": a note takes no "words" here. A note takes only "fields".']);
  assert.deepEqual(problems({ pick: { kind: 'arrow' }, text: { icon: 'x.svg' } }), ['Rule 1, "text": an arrow takes no "icon" here. An arrow takes only "color", "size".']);
  assert.deepEqual(problems({ pick: jobs, content: { words: '{title} in {file}' } }),
    ['Rule 1, "content": the words name the field {file}, which a node does not have. Its fields are "title", "files", "down". The nearest is "files".']);
  assert.deepEqual(problems({ pick: { kind: 'note' }, content: { fields: ['title', 'test'] } }), ['Rule 1, "content": a note shows no field "test". It shows "title", "function", "tests", "text", "services". The nearest is "tests".']);
  assert.deepEqual(problems({ pick: jobs, text: { size: 'huge' } }), ['Rule 1, "text": "huge" is no size. Use one of "small", "normal", "large".']);
  assert.deepEqual(problems({ pick: { kind: 'arrow' }, order: { by: 'words' } }), ['Rule 1: an arrow has no slot "order". Its slots are "arrow", "content", "show", "text", "click", "input".']);
});

test('the slot "order" is checked against the fields of its component: one function, used by the lists of later builds', () => {
  const list: Component = { slots: ['order'], fields: { title: 'text', size: 'count' } };
  const at = (kind: Parameters<typeof valueProblem>[0], value: unknown, field: string): string[] => valueProblem(kind, value, 'Rule 1, "order"', field, { kind: 'node', component: list, context, sets: new Set() });
  assert.deepEqual([...at('field', 'size', 'by'), ...at('ids', ['a', 'b'], 'first'), ...at('yes', true, 'down')], []);
  assert.deepEqual(at('field', 'sise', 'by'), ['Rule 1, "order": a node has no field "sise". Its fields are "title", "size". The nearest is "size".']);
});

test('each new target passes, and each fault of a target has its sentence', () => {
  for (const target of [{ graphs: 'src/library/night_jobs.py' }, { graphs: 'src/library/' }, { folder: 'src/library/jobs/' }, { change: 'book-holds', part: 'hold-service' }, { pull: 12 }, { comment: true }]) {
    assert.deepEqual(problems({ pick: jobs, click: target }), [], JSON.stringify(target));
  }
  const one = (target: unknown): string => problems({ pick: jobs, click: target }).join(' | ');
  assert.equal(one({ graph: 'src/' }), `Rule 1, "click": "graph" is no target. The targets are ${Object.keys(LOOK_PARTS.targets).map((name) => `"${name}"`).join(', ')}. The nearest is "graphs".`);
  assert.equal(one({ folder: 'src/library/jobs' }), 'Rule 1, "click": "folder" must be a folder of the repo, ending with "/".');
  assert.equal(one({ graphs: 'src/gone.py' }), 'Rule 1, "click": The path src/gone.py does not exist.');
  assert.equal(one({ pull: 0 }), 'Rule 1, "click": "pull" must be the number of a pull request, as 12.');
  assert.equal(one({ comment: 'yes' }), 'Rule 1, "click": "comment" must be true.');
  assert.equal(one({ change: 'main', line: 3 }), 'Rule 1, "click": "line" goes with "file".');
  assert.match(one({ file: 'README.md', url: 'https://example.com' }), /a target holds exactly one of "file", "url"/);
  // A target is the same everywhere: a key, a menu entry and the button of build 51.
  assert.match(problems({ pick: jobs, input: { key: { g: { pul: 3 } } } }).join(), /Rule 1, "input", the key "g": "pul" is no target\. .* The nearest is "pull"\./);
  assert.match(problems({ pick: jobs, input: { menu: [{ name: 'Go', target: { folder: 'nowhere/' } }] } }).join(), /Rule 1, "input", entry 1: The path nowhere\/ does not exist\./);
});

test('a command that changes the computer is refused; the commands that a look may run are in one list, all of them commands of Apostil', () => {
  assert.deepEqual(problems({ pick: jobs, click: { command: 'apostil.graphsOf' } }), []);
  const [refused] = problems({ pick: jobs, click: { command: 'apostil.uninstall' } });
  assert.ok(refused.startsWith('Rule 1, "click": the command "apostil.uninstall" changes the computer, so a look cannot run it. A look can run: apostil.home, apostil.graphsOf, '), refused);
  assert.match(problems({ pick: jobs, click: { command: 'workbench.action.quit' } }).join(), /"workbench\.action\.quit" is no command of Apostil/);
  const all = apostilCommands();
  assert.ok(LOOK_COMMANDS.every((command) => all.includes(command)), 'each command of a look is a command of Apostil');
  for (const command of ['apostil.setUp', 'apostil.installCommand', 'apostil.connectClaudeCode', 'apostil.uninstall', 'apostil.linksOff', 'apostil.linksOn']) assert.ok(!LOOK_COMMANDS.includes(command), command);
});

test('a key that a page of Apostil uses is refused, with the keys that are free', () => {
  assert.deepEqual(problems({ pick: jobs, input: { key: { g: { comment: true }, '7': { pull: 12 } } } }), []);
  const [taken] = problems({ pick: jobs, input: { key: { j: { comment: true } } } });
  assert.ok(taken.startsWith('Rule 1, "input": the key "j" is a key of the page already. Free keys are the digits and the letters a, b, c, d, e, f, g, h, i, l, m,'), taken);
  assert.ok(PAGE_KEYS.includes('k') && PAGE_KEYS.includes('Alt+ArrowDown') && PAGE_KEYS.includes('Escape'));
  assert.deepEqual(problems({ pick: jobs, input: { key: { gg: { comment: true } } } }), ['Rule 1, "input": the key "gg" is no letter or digit. A key of a look is one letter or one digit.']);
});

test('the sections of a window: the ids of the component, an unknown one names the nearest, and a section of its own holds blocks (build 58)', () => {
  assert.deepEqual(problems({ pick: jobs, window: { width: 440, sections: ['changes', 'files'] } }), []);
  assert.deepEqual(problems({ pick: { kind: 'step' }, window: { sections: ['marks', 'note'] } }), []);
  assert.deepEqual(problems({ pick: jobs, window: { sections: ['file'] } }), ['Rule 1, "window": "file" is no section of the window of a node. Its sections are "files", "changes", "marks". The nearest is "files".']);
  assert.deepEqual(problems({ pick: jobs, window: { sections: ['files', { title: 'In short', blocks: [{ text: 'Hello' }] }] } }), []);
  assert.deepEqual(problems({ pick: jobs, window: { sections: [{ text: 'Hello' }] } }), [
    'Rule 1, "window", section 1: "text" is no field here. Use only "title", "blocks".',
    'Rule 1, "window", section 1: "blocks" must be a list of blocks, as [ { "text": "<words>" } ]; apostil look-slots blocks gives every block.',
  ]);
  assert.deepEqual(problems({ pick: jobs, window: { width: 2000 } }), ['Rule 1, "window": "width" must be a number of pixels from 240 to 720.']);
  assert.deepEqual(problems({ pick: { kind: 'arrow' }, window: { width: 300 } }), ['Rule 1: an arrow has no slot "window". Its slots are "arrow", "content", "show", "text", "click", "input".']);
});

test('the nearest right name: one or two letters changed, or the same first three letters; with no close name there is none', () => {
  assert.equal(nearest('graph', ['file', 'graphs', 'folder']), 'graphs');
  assert.equal(nearest('colour', ['color', 'line']), 'color');
  assert.equal(nearest('sectionz', ['sections', 'width']), 'sections');
  assert.equal(nearest('level', ['title', 'files', 'down']), undefined);
});

test('package.json declares no capabilities.untrustedWorkspaces: VS Code keeps Apostil off in a workspace that it does not trust, so no look acts there', () => {
  const manifest = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8'));
  assert.equal(manifest.capabilities?.untrustedWorkspaces, undefined);
});
