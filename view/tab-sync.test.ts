// Tests for tab-sync: focusing a diagram node scrolls an already-open code tab in another group, follows cross-file steps into a side code group, and stays quiet with no side code tab.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chooseBesideColumn, chooseFollowTarget, type OpenTab } from './tab-sync';

const tab = (viewColumn: number, uri: string | undefined, kind: 'file' | 'text' | 'webview', isActive = true): OpenTab => ({
  viewColumn, uri, isFileTab: kind === 'file', isTextEditor: kind === 'text', isActive,
});

test('chooseFollowTarget scrolls the matching open code tab in another group, follows into an open side code group across files, and does nothing when no code tab is open beside', () => {
  const home = tab(1, undefined, 'webview', true);
  const fileA = tab(2, 'file:///repo/a.ts', 'file', true);
  const fileB = tab(2, 'file:///repo/b.ts', 'text', false);

  // Only Home open: stay calm, open nothing.
  assert.equal(chooseFollowTarget([home], 1, 'file:///repo/a.ts'), undefined);
  assert.equal(chooseBesideColumn([home], 1, 'file:///repo/a.ts'), undefined);

  // Same file open in group 2 (Apostil file tab): scroll it in place.
  assert.deepEqual(chooseFollowTarget([home, fileA], 1, 'file:///repo/a.ts'), { viewColumn: 2, alreadyOpen: true, isFileTab: true });

  // Same file open in group 2 as a background text editor: reveal & scroll it there.
  assert.deepEqual(chooseFollowTarget([home, fileA, fileB], 1, 'file:///repo/b.ts'), { viewColumn: 2, alreadyOpen: true, isFileTab: false });

  // Different file in a multi-file process while group 2 has code open: follow into group 2.
  assert.deepEqual(chooseFollowTarget([home, fileA], 1, 'file:///repo/c.ts'), { viewColumn: 2, alreadyOpen: false, isFileTab: true });

  // Code file open only in the SAME column as Home (behind Home): do not jump over Home.
  assert.equal(chooseFollowTarget([home, tab(1, 'file:///repo/a.ts', 'file', false)], 1, 'file:///repo/a.ts'), undefined);

  // Another non-code webview in group 2: do not replace it with code uninvited.
  assert.equal(chooseFollowTarget([home, tab(2, undefined, 'webview', true)], 1, 'file:///repo/a.ts'), undefined);

  // Explicit "Open code beside" reuses group 2 when code is already open there.
  assert.equal(chooseBesideColumn([home, fileA], 1, 'file:///repo/c.ts'), 2);
});
