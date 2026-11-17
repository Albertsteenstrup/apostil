// Tests for which notes the editor of VS Code shows on which line, with a step inside its function.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { notesAtLine, titledNotes } from './note-lines';

const fn = { name: 'function', lines: [10, 40] as [number, number] };
const first = { name: 'first step', lines: [10, 18] as [number, number] }; // starts on the line of the function
const second = { name: 'second step', lines: [20, 30] as [number, number] };
const next = { name: 'next function', lines: [42, 60] as [number, number] };
const notes = [fn, first, second, next];

test('a title stands at the end of the first line of the narrowest note that starts there, and the pointer on a line shows the narrowest note that holds it and the notes that start there', () => {
  assert.deepEqual([...titledNotes(notes)].map((note) => note.name), ['first step', 'second step', 'next function']);

  // The pointer on a line shows the narrowest note that holds it, and on a first line also the notes that start there.
  assert.deepEqual(notesAtLine(notes, 25).map((note) => note.name), ['second step']);
  assert.deepEqual(notesAtLine(notes, 19).map((note) => note.name), ['function']); // a line of the function in no step
  assert.deepEqual(notesAtLine(notes, 10).map((note) => note.name), ['first step', 'function']);
  assert.deepEqual(notesAtLine(notes, 41), []);
});

