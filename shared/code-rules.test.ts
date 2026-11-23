// Rules of the code that a test enforces, so no agent needs to remember them. Each failure says the rule and the real fix.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const ROOT = path.resolve(__dirname, '..', '..'); // out/shared → the repo
const IMPORT = /(?:from\s+|require\(\s*|import\(\s*|import\s+)['"]([^'"]+)['"]/g;
const TEST_HELPERS = ['shared/test-repo.ts']; // test code that runs the apostil command, though its name has no .test

/** Every non-test .ts file of a top folder, as a path from the repo. */
const sources = (folder: string): string[] =>
  fs.readdirSync(path.join(ROOT, folder)).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts')).map((f) => `${folder}/${f}`)
    .filter((f) => !TEST_HELPERS.includes(f));

/** What a file imports: "vscode", another file of the repo (as a path from the repo), or nothing for a Node or npm module. */
const importsOf = (file: string): string[] => {
  const out: string[] = [];
  for (const [, spec] of fs.readFileSync(path.join(ROOT, file), 'utf8').matchAll(IMPORT)) {
    if (spec === 'vscode') out.push('vscode');
    if (!spec.startsWith('.')) continue;
    const base = path.join(path.dirname(file), spec);
    const found = [base, `${base}.ts`, `${base}.js`].find((p) => fs.existsSync(path.join(ROOT, p)) && fs.statSync(path.join(ROOT, p)).isFile());
    if (found) out.push(found);
  }
  return [...new Set(out)];
};

const RULE = 'Rule: shared/, store/ (the apostil command) and helper/ (the MCP helper) run without VS Code. Only view/ and theme/ may use vscode.';

/** The top folder of a repo path ("view/media/marks.js" → "view"). */
const folderOf = (file: string): string => file.split('/')[0];

// Which folders each folder may import. view/ and theme/ run inside VS Code and may import anything.
const MAY_IMPORT: Record<string, string[]> = {
  shared: ['shared'],
  store: ['shared', 'store'],
  helper: ['shared', 'store', 'helper'],
};

// Imports from before this rule. Move the pure code they use into shared/, then delete the line here.
const OLD_IMPORTS = new Set([
  'store/doctor.ts → view/install-command.ts',
  'store/uninstall.ts → view/install-command.ts',
  'store/uninstall-hook.ts → view/install-command.ts',
  'store/look-changes.ts → view/home-data.ts',
  'store/look-changes.ts → view/page-data.ts',
  'store/look-changes.ts → view/media/marks.js',
]);

test('shared/, store/ and helper/ import only the folders below them', () => {
  const wrong: string[] = [];
  for (const [folder, allowed] of Object.entries(MAY_IMPORT)) {
    for (const file of sources(folder)) {
      for (const dep of importsOf(file)) {
        const edge = `${file} → ${dep}`;
        if (dep !== 'vscode' && !allowed.includes(folderOf(dep)) && !OLD_IMPORTS.has(edge)) wrong.push(edge);
      }
    }
  }
  assert.deepEqual(wrong, [], `${RULE}\nMove the code you need into shared/ (or the lower folder) and import it from there; do not add it to OLD_IMPORTS.`);
});

test('no file of shared/, store/ or helper/ reaches vscode, also through other files', () => {
  const wrong: string[] = [];
  for (const start of Object.keys(MAY_IMPORT).flatMap(sources)) {
    const cameFrom = new Map<string, string>([[start, '']]);
    const queue = [start];
    while (queue.length) {
      const file = queue.shift()!;
      for (const dep of file === 'vscode' ? [] : importsOf(file)) {
        if (cameFrom.has(dep)) continue;
        cameFrom.set(dep, file);
        queue.push(dep);
      }
    }
    if (!cameFrom.has('vscode')) continue;
    const chain = ['vscode'];
    while (cameFrom.get(chain[0])) chain.unshift(cameFrom.get(chain[0])!);
    wrong.push(chain.join(' → '));
  }
  assert.deepEqual(wrong, [], `${RULE}\nKeep the vscode call in view/ and pass the value in; never import vscode, or a file that does, from these folders.`);
});

