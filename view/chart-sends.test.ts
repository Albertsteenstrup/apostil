// Tests for the sends of the chart of a map run: one at a time, the next after the page drew, none while the tab is hidden.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ChartSends } from './chart-sends';

test('the tab "Map run" gets one chart at a time: a change while one is on its way goes once after the page drew it, and nothing goes while the tab is hidden', () => {
  let sends = 0;
  let visible = true;
  const sender = new ChartSends(() => { sends++; }, () => visible);
  sender.changed();
  sender.changed();
  sender.changed();
  assert.equal(sends, 1);
  sender.drew();
  assert.equal(sends, 2); // the changes in between are one read
  sender.drew();
  assert.equal(sends, 2); // nothing new

  visible = false;
  sender.changed();
  assert.equal(sends, 2);
  sender.shown(); // still hidden
  assert.equal(sends, 2);
  visible = true;
  sender.shown();
  assert.equal(sends, 3);
  sender.shown();
  assert.equal(sends, 3);
});
