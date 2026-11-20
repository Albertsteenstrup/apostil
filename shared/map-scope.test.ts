// Tests for .apostilignore: the matcher of its lines, and the code files of a repo that it changes.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lineFor, scopeLines } from './map-scope';
import { codeFiles, noteGroups, scopeCounts } from './note-groups';
import { makeTestRepo } from './test-repo';

/** What the lines decide for each path: "notes", "path only", or "rule" when no line matches. */
const decide = (text: string, paths: string[]): string[] => {
  const lines = scopeLines(text);
  return paths.map((path) => { const line = lineFor(lines, path); return line ? (line.notes ? 'notes' : 'path only') : 'rule'; });
};

test('.apostilignore reads like .gitignore: a plain line leaves out, a "!" line takes in, the last line that matches wins, and "/", "**", a comment and "\\#" as in Git', () => {
  // A plain line, and a "!" line after it that wins for the files that it matches, also inside the folder that the line before left out.
  assert.deepEqual(decide('legacy/\n!legacy/keep.py\n', ['legacy/a.py', 'legacy/keep.py', 'src/a.py']), ['path only', 'notes', 'rule']);
  // The last line that matches wins: a plain line after a "!" line leaves the file out again.
  assert.deepEqual(decide('!*.json\nconfig/*.json\n', ['config/a.json', 'data/b.json']), ['path only', 'notes']);
  // A trailing "/" matches a folder and everything in it, never a file of that name.
  assert.deepEqual(decide('build/\n', ['build/out.js', 'build/deep/x.js', 'src/build']), ['path only', 'path only', 'rule']);
  // A leading "/" ties the line to the top folder; a name with no "/" matches in any folder, also deep.
  assert.deepEqual(decide('/vendor\n', ['vendor/lib.js', 'src/vendor/lib.js']), ['path only', 'rule']);
  assert.deepEqual(decide('fixtures\n*.gen.ts\n', ['a/b/c/fixtures/one.py', 'a/b/c/x.gen.ts', 'fixtures.py']), ['path only', 'path only', 'rule']);
  // "**" across folders: at the start, in the middle and at the end; "*" and "?" stay within one name.
  assert.deepEqual(decide('**/migrations\napp/**/schema.sql\nout/**\nsrc/*.py\nlog?.txt\n', [
    'db/x/migrations/1.py', 'app/schema.sql', 'app/a/b/schema.sql', 'out/a/b.js', 'src/a.py', 'src/deep/a.py', 'log1.txt', 'log10.txt',
  ]), ['path only', 'path only', 'path only', 'path only', 'path only', 'rule', 'path only', 'rule']);
  // A comment and a blank line count for nothing; "\#" starts a name with "#", and spaces at the end count for nothing.
  const lines = scopeLines('# a comment\n\n\\#notes.py\nold/   \n');
  assert.deepEqual(lines.map((line) => [line.line, line.text]), [[3, '\\#notes.py'], [4, 'old/']]);
  assert.deepEqual(decide('# a comment\n\\#notes.py\n', ['#notes.py', 'notes.py', 'a comment']), ['path only', 'rule', 'rule']);
  // A set of letters, and one that is not.
  assert.deepEqual(decide('v[12].py\nw[!12].py\n', ['v1.py', 'v3.py', 'w1.py', 'w3.py']), ['path only', 'rule', 'rule', 'path only']);
});

test('codeFiles with a .apostilignore: a left-out code file, a "!" JSON file that gets notes, a "!" binary file that still gets none, the counts of Home and of note-groups; with no file, no change', () => {
  const repo = makeTestRepo();
  repo.write('legacy/old.py', 'def old():\n    return 0\n');
  repo.write('config/schema.json', '{ "type": "object" }\n');
  repo.write('config/logo.png', 'PNG\0\0binary');
  repo.write('dist/app.min.js', 'var a=1;\n');
  repo.commit('more files');
  const paths = (): string[] => codeFiles(repo.folder).files.map((file) => file.path);
  const before = paths();
  assert.deepEqual(before, ['legacy/old.py', 'src/app.py', 'src/new_tool.py']);
  assert.equal(scopeCounts(repo.folder), undefined); // no .apostilignore: Home shows nothing new

  repo.write('.apostilignore', '# What Apostil maps\nlegacy/\n!config/\n'); // not committed: it counts too
  const scoped = codeFiles(repo.folder);
  assert.deepEqual(scoped.files.map((file) => file.path), ['config/schema.json', 'src/app.py', 'src/new_tool.py']);
  assert.equal(scoped.leftOut, 1);
  // Home counts by path: one code file left out, and two files with no code ending taken in (the picture too, which has no text).
  assert.deepEqual(scopeCounts(repo.folder), { leftOut: 1, added: 2 });
  assert.deepEqual(noteGroups(repo.folder, undefined).skipped, { count: 1, why: 'generated files, files of more than 20,000 lines, files with no text, and 1 file that .apostilignore leaves out' });

  // A "!" line wins over the generated name; with an empty file, the rule of today again.
  repo.write('.apostilignore', '!dist/app.min.js\n');
  assert.ok(paths().includes('dist/app.min.js'));
  repo.write('.apostilignore', '');
  assert.deepEqual(paths(), before);
  repo.remove();
});
