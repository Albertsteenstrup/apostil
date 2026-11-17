// Finds the tests that call a function. The view shows them as the test count of a note.

import { fileText, tryGit } from './git';

export interface FoundTest {
  file: string;
  name?: string; // the test that holds the call, when it can be found
  line: number; // the line of the call
  group: 'integration' | 'unit'; // from the folder: a path with "/integration/" is an integration test
}

// The start of a test in Python, and in JavaScript or TypeScript.
const TEST_START = /^\s*(?:async\s+)?def\s+(test\w*)|^\s*(?:test|it)\(\s*['"`](.+?)['"`]/;

/** Lists the calls of `symbol` in test files. One entry for each test, not for each call. */
export function findTests(folder: string, symbol: string): FoundTest[] {
  const hits = tryGit(folder, 'grep', '-n', '-F', '-e', `${symbol}(`, '--', '*test*') ?? '';
  const found = new Map<string, FoundTest>();
  const texts = new Map<string, string[]>();
  for (const hit of hits.split('\n').filter(Boolean)) {
    const [file, lineText] = hit.split(':');
    const line = Number(lineText);
    if (!texts.has(file)) texts.set(file, (fileText(folder, file) ?? '').split('\n'));
    const name = testAbove(texts.get(file)!, line);
    const key = `${file}::${name ?? line}`;
    if (!found.has(key)) found.set(key, { file, name, line, group: file.includes('/integration/') ? 'integration' : 'unit' });
  }
  return [...found.values()];
}

/** The name of the test that starts at or above a line. */
function testAbove(lines: string[], line: number): string | undefined {
  for (let index = line - 1; index >= 0; index--) {
    const match = TEST_START.exec(lines[index] ?? '');
    if (match) return match[1] ?? match[2];
  }
  return undefined;
}
