// Tests for the save, the material, the cleanup and the command line.

import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { headCommit, repoId } from '../shared/git';
import { Store } from '../shared/store';
import { makeTestRepo, runApostil, tempFolder, testChangeFile } from '../shared/test-repo';
import { cleanup } from './cleanup';
import { changeMaterial, forFreshCheck } from './material';
import { saveDraft } from './save';

const DAY = 24 * 60 * 60 * 1000;
const start = new Date('2026-01-01T00:00:00Z');
const later = (days: number): Date => new Date(start.getTime() + days * DAY);
const noChecks = { filesInNoPart: [], filesInTwoParts: [], filesNotChanged: [], generated: [], badNotes: [] };

test('a draft with a wrong shape is not saved; a save stores the change with its checks, and a second save replaces it and keeps the base', () => {
  const store = new Store(tempFolder('apostil-home-'));
  const repo = makeTestRepo();
  const wrong = saveDraft(store, repo.folder, { ...testChangeFile(), title: '', parts: [{ id: 'Bad Id', name: 'X', files: [] }] });
  assert.equal(wrong.saved, false);
  assert.equal(wrong.changeId, undefined);
  assert.ok(wrong.problems.some((problem) => problem.includes('"title"')));
  assert.ok(wrong.problems.some((problem) => problem.includes('"id"')));
  assert.equal(store.listChanges(repoId(repo.folder)).length, 0);

  const first = saveDraft(store, repo.folder, testChangeFile());
  assert.equal(first.saved, true);
  assert.deepEqual(first.checks?.generated, ['generated/api.json']);
  assert.deepEqual(first.checks?.filesInNoPart, []);
  repo.write('src/more.py', 'def more():\n    return 1\n');
  repo.commit('more');
  const second = saveDraft(store, repo.folder, { ...testChangeFile(), title: 'New title' });
  assert.equal(second.changeId, first.changeId);
  const stored = store.listChanges(repoId(repo.folder));
  assert.equal(stored.length, 1);
  assert.equal(stored[0].file.title, 'New title');
  assert.equal(stored[0].base, repo.base);
  assert.equal(stored[0].head, headCommit(repo.folder));
  assert.deepEqual(second.checks?.filesInNoPart, ['src/more.py']);
  store.close();
  repo.remove();
});

test('the cleanup marks a change with a deleted folder, keeps it for 7 days, then removes it; it clears the mark when a branch still holds the commit', () => {
  const store = new Store(tempFolder('apostil-home-'));
  const repo = makeTestRepo();
  const gone = (branch: string, head: string) => store.saveChange({ repoId: repoId(repo.folder), folder: join(repo.folder, 'gone'), branch, base: repo.base, head, file: testChangeFile(), checks: noChecks });
  const id = gone('old', repo.base);
  assert.deepEqual(cleanup(store, start).marked, [id]);
  assert.deepEqual(cleanup(store, later(6)).removed, []);
  assert.equal(store.getChange(id)?.missingSince, start.toISOString());
  assert.deepEqual(cleanup(store, later(8)).removed, [id]);
  assert.equal(store.getChange(id), undefined);

  saveDraft(store, repo.folder, testChangeFile()); // a change whose folder still exists
  const held = gone('older', headCommit(repo.folder));
  store.markMissing(held, start.toISOString());
  assert.deepEqual(cleanup(store, later(1)), { marked: [], cleared: [held], removed: [] });
  assert.equal(store.getChange(held)?.missingSince, undefined);
  store.close();
  repo.remove();
});

test('the material lists an added function, and the lines for the fresh check hold the code of a note', () => {
  const store = new Store(tempFolder('apostil-home-'));
  const repo = makeTestRepo();
  const material = changeMaterial(store, repo.folder);
  assert.equal(material.branch, 'feature');
  assert.equal(material.base, repo.base);
  assert.deepEqual(material.files.map((file) => file.path).sort(), ['generated/api.json', 'src/app.py', 'src/new_tool.py']);
  assert.ok(material.names.some((name) => name.file === 'src/app.py' && name.change === 'added' && name.text === 'def stop():'));
  assert.equal(material.namesLeftOut, 0);
  assert.equal(material.changeFile, undefined);

  saveDraft(store, repo.folder, testChangeFile());
  const [range] = forFreshCheck(store, repo.folder, 'app')!.ranges;
  assert.deepEqual(range.lines, [5, 6]);
  assert.deepEqual(range.code, ['5: def stop():', '6:     return 0']);
  assert.deepEqual(forFreshCheck(store, repo.folder, 'tool')!.ranges, []); // a part with no notes
  store.close();
  repo.remove();
});

test('the command line saves a draft and prints the result, and a broken draft gives exit code 1', () => {
  const repo = makeTestRepo();
  const home = tempFolder('apostil-home-');
  const draftFolder = tempFolder('apostil-draft-');
  const apostil = (...args: string[]) => runApostil([...args, '--folder', repo.folder], { env: { APOSTIL_HOME: home } });

  const draft = join(draftFolder, 'draft.json');
  writeFileSync(draft, JSON.stringify(testChangeFile()));
  const saved = apostil('save', draft);
  assert.equal(saved.status, 0);
  const result = JSON.parse(saved.stdout);
  assert.equal(result.saved, true);
  assert.equal(typeof result.changeId, 'number');
  assert.deepEqual(result.problems, []);
  assert.equal(JSON.parse(apostil('list').stdout)[0].title, 'Adds a stop function and a tool');

  const broken = join(draftFolder, 'broken.json');
  writeFileSync(broken, JSON.stringify({ format: 1 }));
  const failed = apostil('save', broken);
  assert.equal(failed.status, 1);
  assert.equal(JSON.parse(failed.stdout).saved, false);
  assert.equal(apostil('nonsense').status, 1);

  // One fresh check for each part: the points of a part replace only the points of that part.
  const points = join(draftFolder, 'points.json');
  writeFileSync(points, JSON.stringify([{ kind: 'no-note', text: 'The stop does not log.', file: 'src/app.py', lines: [5, 6] }]));
  assert.equal(apostil('open-points', points, '--part', 'app').status, 0);
  assert.equal(apostil('open-points', points, '--part', 'tool').status, 0);
  assert.equal(apostil('open-points', points, '--part', 'no-such-part').status, 1);
  assert.equal(JSON.parse(apostil('usage').stdout)[0].openPoints, 2);
  assert.deepEqual(JSON.parse(apostil('for-check', '--part', 'app').stdout).ranges[0].code, ['5: def stop():', '6:     return 0']);
  // A diagram with "before" comes with the code of its file as it was, for the checker to read "before" against.
  const withBefore = join(draftFolder, 'with-before.json');
  const file = testChangeFile();
  writeFileSync(withBefore, JSON.stringify({ ...file, diagrams: [{ ...file.diagrams![0], new: undefined, symbol: 'start', before: 'flowchart TD\n  ask["Ask to stop"]', edgeLines: [{ from: 'ask', to: 'done', lines: [5, 6] }] }] }));
  apostil('save', withBefore);
  const material = JSON.parse(apostil('for-check', '--part', 'app').stdout);
  const [diagram] = material.diagrams;
  assert.deepEqual([diagram.id, diagram.before, diagram.oldCode], ['stop-flow', 'flowchart TD\n  ask["Ask to stop"]', ['1: def start():', '2:     return 1']]);
  // Each node and arrow comes too, with the code of each place, for the checker to read against the diagram.
  const things = material.things.map((one: { thing: string; places: { code: string[] }[] }) => [one.thing, one.places.map((place) => place.code)]);
  assert.deepEqual(things, [['the step "Ask to stop"', [['5: def stop():']]], ['the step "Return 0"', [['6:     return 0']]], ['the arrow "Ask to stop" → "Return 0"', [['5: def stop():', '6:     return 0']]]]);

  // The rule: a node with no code and no reason is not saved, and the problem names it and says what to give.
  const missing = join(draftFolder, 'missing.json');
  writeFileSync(missing, JSON.stringify({ ...file, diagrams: [{ ...file.diagrams![0], nodeLines: { done: [6, 6] } }] }));
  const refused = apostil('save', missing);
  assert.equal(refused.status, 1);
  assert.deepEqual(JSON.parse(refused.stdout).problems, ['Diagram "stop-flow": The step "Ask to stop" has no code. Give its lines, or a reason: outside, no-line.']);
  assert.equal(apostil('check', missing).status, 1);
  // The same for a link between parts.
  const noLinkCode = join(draftFolder, 'no-link-code.json');
  writeFileSync(noLinkCode, JSON.stringify({ ...file, links: [{ from: 'app', to: 'tool', label: 'uses tool' }] }));
  const linkRefused = apostil('save', noLinkCode);
  assert.equal(linkRefused.status, 1);
  assert.deepEqual(JSON.parse(linkRefused.stdout).problems, ['The link "App → Tool: uses tool" has no code. Give the line of the call or the import, or a reason: outside, order, no-line.']);
  assert.equal(apostil('check', noLinkCode).status, 1);
  // The fresh check of a part gets each link that leaves it, with its code or its reason.
  assert.deepEqual(JSON.parse(apostil('for-check', '--part', 'app').stdout).links, [{ link: 'the link "App → Tool"', edge: ['app', 'tool'], reason: 'Only the order.' }]);
  assert.deepEqual(JSON.parse(apostil('for-check', '--part', 'tool').stdout).links, []);

  // The second agent marks a diagram as read; a new save takes the mark away.
  assert.deepEqual(JSON.parse(apostil('checked', 'stop-flow').stdout).checked, ['stop-flow']);
  assert.equal(apostil('checked', 'no-such-diagram').status, 1);
  const thingPoint = join(draftFolder, 'thing-point.json');
  writeFileSync(thingPoint, JSON.stringify([{ kind: 'thing-not-supported', text: 'Line 6 returns 0, not a stop.', diagram: 'stop-flow', node: 'done' }]));
  assert.equal(apostil('open-points', thingPoint, '--part', 'app').status, 0);
  assert.deepEqual(JSON.parse(apostil('context').stdout).openPoints.find((point: { diagram?: string }) => point.diagram), { kind: 'thing-not-supported', text: 'Line 6 returns 0, not a stop.', diagram: 'stop-flow', node: 'done' });
  writeFileSync(thingPoint, JSON.stringify([{ kind: 'thing-not-supported', text: 'x', diagram: 'stop-flow', node: 'ghost' }]));
  assert.equal(apostil('open-points', thingPoint).status, 1);
  // An open point at a link has its two parts and no diagram; "links" marks the links that leave a part as read.
  writeFileSync(thingPoint, JSON.stringify([{ kind: 'thing-not-supported', text: 'The app does not call the tool.', edge: ['app', 'tool'] }]));
  assert.equal(apostil('open-points', thingPoint, '--part', 'app').status, 0);
  assert.deepEqual(JSON.parse(apostil('context').stdout).openPoints.find((point: { edge?: string[]; diagram?: string }) => point.edge && !point.diagram),
    { kind: 'thing-not-supported', text: 'The app does not call the tool.', edge: ['app', 'tool'] });
  writeFileSync(thingPoint, JSON.stringify([{ kind: 'thing-not-supported', text: 'x', edge: ['tool', 'app'] }]));
  assert.match(JSON.parse(apostil('open-points', thingPoint).stdout).problems[0], /The change has no link from "tool" to "app"/);
  assert.deepEqual(JSON.parse(apostil('checked', 'links', '--part', 'app').stdout).checked, ['stop-flow', 'links:app']);
  assert.equal(apostil('checked', 'links', '--part', 'no-such-part').status, 1);
  apostil('save', withBefore);
  const store = new Store(home);
  assert.equal(store.findChange(repoId(repo.folder), 'feature')?.checked, undefined);

  // A name that the agent gives is stored with its session; a later save without one keeps it.
  const withName = JSON.parse(apostil('save', draft, '--agent', 'codex', '--session', 'made-up-thread', '--session-name', 'Repo understanding tool').stdout);
  assert.deepEqual(store.getChange(withName.changeId)!.agent, { app: 'codex', session: 'made-up-thread', name: 'Repo understanding tool' });
  apostil('save', draft, '--agent', 'codex');
  assert.equal(store.getChange(withName.changeId)!.agent!.name, 'Repo understanding tool');
  store.close();

  const help = apostil('save', '--help');
  assert.equal(help.status, 0);
  assert.equal(JSON.parse(help.stdout).commands.length, 47); // with apostil prompt
  repo.remove();
});
