// The lines of a diff: as rows with a sign and a line number, as the added lines now, and as the removed lines with their places. The page, the checks and the threads of a pull request use it.

export interface DiffLine {
  sign: '+' | '-' | ' ';
  text: string;
  line: number; // its number in the file as it is now, or for a removed line, as it was
}

/** The changed lines of a diff, with the context lines that Git puts between them. */
export function diffLines(diff: string): DiffLine[] {
  const out: DiffLine[] = [];
  let before = 0;
  let now = 0;
  let inHunk = false; // the head of the diff comes before the first hunk
  for (const line of diff.split('\n')) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
    if (hunk) { before = Number(hunk[1]); now = Number(hunk[2]); inHunk = true; continue; }
    if (!inHunk || line.startsWith('\\')) continue;
    const sign = line[0] === '+' || line[0] === '-' ? line[0] : ' ';
    out.push({ sign, text: line.slice(1), line: sign === '-' ? before : now });
    if (sign !== '+') before++;
    if (sign !== '-') now++;
  }
  return out;
}

/** A removed line of a diff: the line of the file as it is now that it stands before, its number in the file as it was, and its text. */
export interface RemovedLine {
  at: number;
  line: number;
  text: string;
}

/** The line numbers that a diff adds or changes, in the file as it is now. */
export function addedLines(diff: string): number[] {
  const added: number[] = [];
  let line = 0;
  for (const text of diff.split('\n')) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(text);
    if (hunk) { line = Number(hunk[1]); continue; }
    if (line === 0 || text.startsWith('\\')) continue;
    if (text.startsWith('+')) added.push(line++);
    else if (!text.startsWith('-')) line++;
  }
  return added;
}

/** The removed lines of a diff, each with the line of the new file that it stands before. */
export function removedLines(diff: string): RemovedLine[] {
  const removed: RemovedLine[] = [];
  let before = 0;
  let now = 0;
  for (const text of diff.split('\n')) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(text);
    if (hunk) { before = Number(hunk[1]); now = Number(hunk[2]); continue; }
    if (now === 0 || text.startsWith('\\')) continue;
    if (text.startsWith('-')) removed.push({ at: now, line: before++, text: text.slice(1) });
    else if (text.startsWith('+')) now++;
    else { before++; now++; }
  }
  return removed;
}

/** Turns sorted line numbers into ranges: [3, 4, 5, 9] becomes [[3, 5], [9, 9]]. */
export function toRanges(lines: number[]): [number, number][] {
  const ranges: [number, number][] = [];
  for (const line of lines) {
    const last = ranges[ranges.length - 1];
    if (last && line === last[1] + 1) last[1] = line;
    else ranges.push([line, line]);
  }
  return ranges;
}
