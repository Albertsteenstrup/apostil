import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';

const file = path.join(__dirname, '..', '..', 'theme', 'apostil-light-color-theme.json');
const theme = JSON.parse(readFileSync(file, 'utf8'));
const colors: Record<string, string> = theme.colors;

const PALETTE = { stone: '#f3f0ea', paper: '#fffefc', ink: '#1a2b24', line: '#ddd6cc', teal: '#0f766e' };

// Brightness of a #rrggbb colour, as WCAG defines it.
function brightness(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [high, low] = [brightness(a), brightness(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

function tokenColor(scope: string): string {
  const rule = theme.tokenColors.find((r: { scope: string | string[] }) => [r.scope].flat().includes(scope));
  return rule.settings.foreground;
}

test('the theme is valid JSON with hex colours and token colours, its surfaces are the colours of the palette, and the picture colours are used for strings and keywords', () => {
  assert.equal(theme.name, 'Apostil Light');
  assert.equal(theme.type, 'light');
  assert.ok(Object.keys(colors).length > 100);
  assert.ok(theme.tokenColors.length > 0);

  // Every colour is a hex value.
  for (const [id, value] of Object.entries(colors)) assert.match(value, /^#[0-9a-f]{6}([0-9a-f]{2})?$/i, id);

  // The surfaces are the colours of the palette.
  assert.equal(colors['editor.background'], PALETTE.paper);
  assert.equal(colors['sideBar.background'], PALETTE.stone);
  assert.equal(colors['activityBar.background'], PALETTE.stone);
  assert.equal(colors['titleBar.activeBackground'], PALETTE.stone);
  assert.equal(colors['editorGroupHeader.tabsBackground'], PALETTE.stone);
  assert.equal(colors['statusBar.background'], PALETTE.stone);
  assert.equal(colors['panel.background'], PALETTE.paper);
  assert.equal(colors['editor.foreground'], PALETTE.ink);
  assert.equal(colors['sideBar.border'], PALETTE.line);
  assert.equal(colors['tab.activeBorderTop'], PALETTE.teal);
  assert.equal(colors['button.background'], PALETTE.teal);

  // The picture colours are used for strings and keywords.
  assert.equal(tokenColor('string'), '#8a5a2b');
  assert.equal(tokenColor('keyword'), '#5b4b8a');
});

test('text, line numbers, code colours and comments have enough contrast on their surface', () => {
  assert.ok(contrast(colors['editor.foreground'], colors['editor.background']) >= 4.5);
  assert.ok(contrast(colors['sideBar.foreground'], colors['sideBar.background']) >= 4.5);
  assert.ok(contrast(colors['statusBar.foreground'], colors['statusBar.background']) >= 4.5);
  assert.ok(contrast(colors['tab.inactiveForeground'], colors['tab.inactiveBackground']) >= 4.5);
  assert.ok(contrast(colors['button.foreground'], colors['button.background']) >= 4.5);
  assert.ok(contrast(colors['list.activeSelectionForeground'], colors['list.activeSelectionBackground']) >= 4.5);

  // Line numbers have a contrast of at least 3 to 1.
  assert.ok(contrast(colors['editorLineNumber.foreground'], colors['editor.background']) >= 3);
  assert.ok(contrast(colors['editorLineNumber.foreground'], colors['editor.lineHighlightBackground']) >= 3);

  // Each code colour has a contrast of at least 4.5 to 1 on the editor.
  const scopes = ['string', 'keyword', 'constant.numeric', 'constant.language', 'entity.name.function', 'entity.name.type', 'entity.name.tag', 'variable.other.property'];
  for (const scope of scopes) {
    assert.ok(contrast(tokenColor(scope), colors['editor.background']) >= 4.5, scope);
  }

  // Comments stay quiet but readable, at least 3 to 1.
  assert.ok(contrast(tokenColor('comment'), colors['editor.background']) >= 3);
  const comment = theme.tokenColors.find((r: { scope: string[] }) => r.scope.includes('comment'));
  assert.equal(comment.settings.fontStyle, 'italic');
});




