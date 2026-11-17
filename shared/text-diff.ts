// A diff of two texts in the process, written as Git writes one (3 lines around each change), for texts that are no file:
// the texts of the cells of a notebook before and now. Nothing is written to disk.

type Step = '-' | '+' | ' ';

const MOST = 2000; // with more removed and added lines than this between the two ends, the search stops: all of that part counts as removed and added

/**
 * The line-by-line steps from `a` to `b`: ' ' kept, '-' removed, '+' added. The lines that both texts start with and end with are kept;
 * the part between them gets the fewest added and removed lines (Myers), up to MOST of them, so that a long new notebook costs no time and no memory.
 */
function steps(a: string[], b: string[]): Step[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  const kept = (count: number): Step[] => Array<Step>(count).fill(' ');
  return [...kept(start), ...between(a.slice(start, a.length - end), b.slice(start, b.length - end)), ...kept(end)];
}

/** The steps of the part that differs. */
function between(a: string[], b: string[]): Step[] {
  const all = (): Step[] => [...Array<Step>(a.length).fill('-'), ...Array<Step>(b.length).fill('+')];
  if (!a.length || !b.length) return all();
  const max = Math.min(a.length + b.length, MOST);
  const zero = max + 1; // v[zero + k] is the furthest x on the diagonal k
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = []; // for each count of steps d: the diagonals -d - 1 to d + 1 before that round
  const goesDown = (at: (k: number) => number, k: number, d: number): boolean => k === -d || (k !== d && at(k - 1) < at(k + 1));
  let found = false;
  for (let d = 0; d <= max && !found; d++) {
    trace.push(v.slice(zero - d - 1, zero + d + 2));
    for (let k = -d; k <= d && !found; k += 2) {
      let x = goesDown((at) => v[zero + at], k, d) ? v[zero + k + 1] : v[zero + k - 1] + 1;
      let y = x - k;
      while (x < a.length && y < b.length && a[x] === b[y]) { x++; y++; }
      v[zero + k] = x;
      found = x >= a.length && y >= b.length;
    }
  }
  if (!found) return all();
  // Walk back through the rounds to the start.
  const out: Step[] = [];
  let [x, y] = [a.length, b.length];
  for (let d = trace.length - 1; d >= 0; d--) {
    const before = (k: number): number => trace[d][k + d + 1];
    const k = x - y;
    const prevK = goesDown(before, k, d) ? k + 1 : k - 1;
    const prevX = before(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) { out.push(' '); x--; y--; }
    if (d > 0) out.push(x === prevX ? '+' : '-');
    [x, y] = [prevX, prevY];
  }
  return out.reverse();
}

const AROUND = 3;

/** The diff of two texts as Git writes it, with `path` in its head; empty when they are the same. */
export function textDiff(before: string, after: string, path: string): string {
  const split = (text: string) => (text === '' ? [] : text.replace(/\n$/, '').split('\n'));
  const [a, b] = [split(before), split(after)];
  const rows: { sign: '-' | '+' | ' '; text: string; old: number; now: number }[] = [];
  let [i, j] = [0, 0];
  for (const sign of steps(a, b)) {
    rows.push({ sign, text: sign === '+' ? b[j] : a[i], old: i + 1, now: j + 1 });
    if (sign !== '+') i++;
    if (sign !== '-') j++;
  }
  const changed = rows.map((row, at) => (row.sign !== ' ' ? at : -1)).filter((at) => at >= 0);
  if (!changed.length) return '';
  // Hunks: the changed rows with 3 rows around them; two hunks that touch become one.
  const hunks: [number, number][] = [];
  for (const at of changed) {
    const [from, to] = [Math.max(0, at - AROUND), Math.min(rows.length - 1, at + AROUND)];
    const last = hunks[hunks.length - 1];
    if (last && from <= last[1] + 1) last[1] = to;
    else hunks.push([from, to]);
  }
  const out = [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`];
  for (const [from, to] of hunks) {
    const part = rows.slice(from, to + 1);
    const oldCount = part.filter((row) => row.sign !== '+').length;
    const nowCount = part.filter((row) => row.sign !== '-').length;
    const start = (count: number, line: number) => (count ? line : line - 1);
    out.push(`@@ -${start(oldCount, part[0].old)},${oldCount} +${start(nowCount, part[0].now)},${nowCount} @@`);
    out.push(...part.map((row) => `${row.sign}${row.text}`));
  }
  return out.join('\n');
}
