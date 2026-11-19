// Made-up dense notes for the browser checks: a file of functions, a note of the map for each function, and a note for each step of `every` lines inside it.
// It is the density that small models write with a note for each function and each step. No real code.

const WORDS = ['reads the rows', 'checks the limit', 'keeps the order', 'skips an empty value', 'writes the result', 'counts the misses', 'stops at the first error', 'asks the store once'];
const word = (at) => WORDS[at % WORDS.length];

/**
 * A made-up file: { path, code: the answer of "code:<path>" with its notes }. Functions of `fn` lines; the first line of each is its `def`,
 * the last is blank. The note of a function holds all its lines but the blank one; its steps start on the line after the `def`.
 */
export function denseFile({ path, lines = 450, every = 8, fn = 30 }) {
  const text = [];
  const notes = [];
  const from = { title: 'Made-up map: dense notes', branch: '', map: true };
  const note = (first, last, title, words, symbol) => notes.push({ file: path, lines: [first, last], title, text: words, symbol, key: `beside:map/dense/${notes.length}`, part: '', linkedTests: 0, from });
  for (let start = 1; start <= lines; start += fn) {
    const end = Math.min(lines, start + fn - 1);
    const name = `handle_${start}`;
    text.push(`def ${name}(items, limit):`);
    for (let line = start + 1; line <= end; line++) text.push(line === end ? '' : `    value_${line} = compute(items, ${line}) if limit > ${line % 7} else None`);
    if (end - 1 <= start) continue;
    note(start, end - 1, `Handle one batch of ${name.slice(7)}`, `The function ${word(start)} and then ${word(start + 3)}, so the caller gets one answer.`, name);
    for (let first = start + 1, step = 1; first <= end - 1; first += every, step++) {
      const last = Math.min(end - 1, first + every - 1);
      note(first, last, `Step ${step}: ${word(first)}`, `This step ${word(first + 1)}${step % 2 ? ' before the next step reads it' : ''}.`, name);
    }
  }
  return { path, code: { lines: text, changed: [], removed: [], status: 'same', notes } };
}
