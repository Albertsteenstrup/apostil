// Tests for the path that he followed, as plain data: the rules of media/trail.js and the path of the window.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TrailRules, WindowTrail, type Step } from './trail';

const { HOME, start, upTo, walk, before } = TrailRules;
const lower: Step = { tab: 'home', diagram: 'lending', lit: [], name: 'Lending' };
const graphs: Step = { tab: 'graphs', path: 'src/lending/', name: 'src/lending/' };
const change: Step = { tab: 'change', change: 7, go: { level: 'change', lit: ['hold-service'] }, name: 'Adds holds' };
const part: Step = { tab: 'change', change: 7, go: { level: 'part', part: 'hold-service', diagram: 'flow' }, name: 'Hold service' };
const diffs: Step = { tab: 'change', change: 7, go: { view: 'diffs' }, name: 'Diffs' };
const names = (steps: Step[]): string => steps.map((step) => step.name).join(' › ');

test('a new path starts at Home; the line of a view is the path up to it; one step back is the step before the view in its line', () => {
  assert.equal(names(start(HOME)), 'Home');
  assert.equal(names(start({ tab: 'home', diagram: '', name: 'Home' })), 'Home');
  assert.equal(names(start(graphs)), 'Home › src/lending/');
  assert.equal(names(start(change)), 'Home › Adds holds');

  // The line of a view is the path up to it; a view that is not in the path has Home and itself.
  const steps = [HOME, graphs, change];
  assert.equal(names(upTo(steps, graphs)), 'Home › src/lending/');
  assert.equal(names(upTo(steps, lower)), 'Home › Lending');

  // One step back: the step before the view in its line, none on the top map.
  {
    const steps = [HOME, lower, graphs, change];
    assert.equal(before(steps, change)?.name, 'src/lending/');
    assert.equal(before(steps, lower)?.name, 'Home');
    assert.equal(before(steps, HOME), null);
  }
});

test('a step is added after the view that it was taken from, and a step that is in the path already cuts the path back to it', () => {
  let steps = start(HOME);
  steps = walk(steps, HOME, lower);
  steps = walk(steps, lower, graphs);
  steps = walk(steps, graphs, change);
  steps = walk(steps, change, part);
  assert.equal(names(steps), 'Home › Lending › src/lending/ › Adds holds › Hold service');
  // From a view that is not the last, the path first goes back to that view.
  assert.equal(names(walk(steps, graphs, diffs)), 'Home › Lending › src/lending/ › Diffs');

  // A step that is in the path already is not added again: the path is cut back to it, with the step as it is now.
  {
    const steps = [HOME, lower, graphs, change, part];
    const again = walk(steps, part, { ...lower, lit: ['hold-service'] });
    assert.equal(names(again), 'Home › Lending');
    assert.deepEqual(again[1].tab === 'home' && again[1].lit, ['hold-service']);
    // The change and its part are two views; a part with another diagram is the same view.
    assert.equal(names(walk(steps, part, change)), 'Home › Lending › src/lending/ › Adds holds');
    assert.equal(walk(steps, part, { ...part, go: { level: 'part', part: 'hold-service', diagram: 'sequence' } }).length, 5);
  }
});

test('the window keeps one path: each change goes to every tab, and back opens the view of that step', () => {
  const opened: Step[] = [];
  const told: string[] = [];
  const trail = new WindowTrail((step) => opened.push(step), (steps) => told.push(names(steps)));
  trail.start(graphs);
  trail.walk(graphs, change, true);
  trail.walk(change, part);
  trail.back(graphs);
  assert.deepEqual(told, ['Home › src/lending/', 'Home › src/lending/ › Adds holds', 'Home › src/lending/ › Adds holds › Hold service', 'Home › src/lending/']);
  assert.deepEqual(opened.map((step) => step.name), ['Adds holds', 'src/lending/']); // a step that a page took in its own tab opens nothing
});
