// Tests for the places in the answer of an agent (parts in media/answer-links.js): code with and without lines, a diagram and a node by title. No browser.

import assert from 'node:assert/strict';
import { test } from 'node:test';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parts } = require('../../view/media/answer-links.js');

const known = {
  files: new Set(['README.md']),
  titles: new Map<string, object>([['Pick a map run\'s team', { kind: 'diagram', diagram: 'team' }], ['Read the catalog', { kind: 'node', diagram: 'team', node: 'read' }]]),
};

test('an answer names code with lines, code alone, a diagram and a node; words with a dot stay words, and < and & stay text', () => {
  const answer = 'See shared/models.ts:246-257 and store/inbox.ts, e.g. App.page in README.md. "Pick a map run\'s team" calls "Read the catalog" when a < b & c; "Other" is no title.';
  const found = parts(answer, known);
  assert.equal(found.map((part: { text: string }) => part.text).join(''), answer);
  assert.deepEqual(found.filter((part: { place?: object }) => part.place), [
    { text: 'shared/models.ts:246-257', place: { file: 'shared/models.ts', lines: [246, 257] } },
    { text: 'store/inbox.ts', place: { file: 'store/inbox.ts' } },
    { text: 'README.md', place: { file: 'README.md' } },
    { text: 'Pick a map run\'s team', place: { kind: 'diagram', diagram: 'team' } },
    { text: 'Read the catalog', place: { kind: 'node', diagram: 'team', node: 'read' } },
  ]);
  assert.deepEqual(parts('package.json:3–5, not https://example.com/a.js or me@example.com', known).filter((part: { place?: object }) => part.place),
    [{ text: 'package.json:3–5', place: { file: 'package.json', lines: [3, 5] } }]);
});
