// The code of a file that should have a note: its functions, methods, classes and route handlers, by plain rules for each family of languages.

import type { Note } from './change-file';
import { isTestPath } from './processes';

export interface Definition {
  name: string;
  lines: [number, number]; // its first and last line, counted from 1
  test: boolean; // a definition of a test file, a test call with a name, def test_… or func Test…
}

/** A definition that has no note, with how many other code files name it. */
export interface Gap {
  file: string;
  lines: [number, number];
  name: string;
  used: number;
}

/** A writer's answer that a definition needs no note. */
export interface Skip {
  file: string;
  lines: [number, number];
  why: string;
}

type Family = 'brace' | 'python' | 'ruby';

const BRACE_FILE = /\.(ts|tsx|js|jsx|mjs|cjs|go|rs|java|kt|kts|cs|swift|php|c|h|cc|cpp|hpp)$/i;
const METHOD_FILE = /\.(ts|tsx|js|jsx|mjs|cjs|java|cs|swift|c|h|cc|cpp|hpp)$/i; // the languages whose methods or functions have no keyword
const JS_FILE = /\.(ts|tsx|js|jsx|mjs|cjs)$/i;

const familyOf = (path: string): Family | undefined =>
  (BRACE_FILE.test(path) ? 'brace' : /\.py$/i.test(path) ? 'python' : /\.rb$/i.test(path) ? 'ruby' : undefined);

// The starts of a definition, read on a line whose strings are blank and whose comments are gone.
const TEST_CALL = /^\s*(?:test|it|describe)(?:\.\w+)?\s*\(?\s*(['"`])/;
const ROUTE = /^\s*(?:[\w$]+\.)+(get|post|put|patch|delete|all|HandleFunc)\s*\(\s*(['"`])/;
const CLASS = /(?:^|[^\w$.])(?:class|object|trait|impl(?:\s*<[^>]*>)?(?:\s+[\w:]+(?:<[^>]*>)?\s+for)?)\s+([A-Za-z_$][\w$]*)/;
const KEYWORD = /(?:^|[^\w$.])(?:function\s*\*?|func|fn|fun)\s+(?:\([^)]*\)\s*)?(?:<[^>]*>\s*)?(?:[\w.]+\.)?([A-Za-z_$][\w$]*)/;
const ARROW = /^\s*(?:export\s+)?(?:(?:const|let|var)\s+|(?:(?:public|private|protected|static|readonly|override)\s+)*)([A-Za-z_$][\w$]*)\s*(?:(?::[^=]*)?=|:)\s*(?:async\s+)?(?:function\b|(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]*)?=>|\(\s*$)/;
const METHOD = /^\s*((?:[\w$<>[\],?*&:]+\s+)*)\*?((?:\w+::)*~?[A-Za-z_$][\w$]*)\s*(?:<[^>()]*>)?\s*\(/;
const PY_DEF = /^\s*(?:async\s+)?(def|class)\s+([A-Za-z_]\w*)/;
const RB_DEF = /^\s*(?:def\s+(?:self\.)?([A-Za-z_]\w*[?!=]?)|class\s+([A-Z]\w*))/;
const CONTROL = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'new', 'else', 'do', 'try', 'sizeof', 'typeof', 'await', 'yield', 'throw', 'case', 'using', 'lock', 'foreach', 'when', 'synchronized', 'super', 'this', 'with', 'match', 'guard', 'function', 'delete', 'void']);

const BEFORE_REGEX = '(,=:[!&|?{};>'; // after one of these, a "/" of JavaScript starts a regular expression, not a division

/** The end of a regular expression of JavaScript that starts at a "/" on one line: its closing "/", or -1. */
function regexEnd(text: string, at: number): number {
  let inClass = false;
  for (let end = at + 1; end < text.length && text[end] !== '\n'; end++) {
    if (text[end] === '\\') end++;
    else if (text[end] === '[' || text[end] === ']') inClass = text[end] === '[';
    else if (text[end] === '/' && !inClass) return end;
  }
  return -1;
}

/** Where a string closes: at its closing quote, else at the end of its line or text. A template of JavaScript skips the code of each "${…}". */
function stringEnd(text: string, at: number, quote: string, js: boolean): number {
  let end = at + quote.length;
  while (end < text.length && !text.startsWith(quote, end)) {
    if (quote.length === 1 && quote !== '`' && text[end] === '\n') return end;
    if (text[end] === '\\') end += 2;
    else if (js && quote === '`' && text.startsWith('${', end)) end = codeEnd(text, end + 2) + 1;
    else end++;
  }
  return Math.min(end, text.length);
}

/** The "}" that closes the code of a "${" in a template of JavaScript, with the strings and templates inside it skipped. */
function codeEnd(text: string, at: number): number {
  let depth = 0;
  let last = '{';
  for (let end = at; end < text.length; end++) {
    const char = text[end];
    if ('\'"`'.includes(char)) end = stringEnd(text, end, char, true);
    else if (char === '/' && BEFORE_REGEX.includes(last) && regexEnd(text, end) > 0) end = regexEnd(text, end);
    else if (char === '{') depth++;
    else if (char === '}' && depth-- === 0) return end;
    if (char.trim()) last = char;
  }
  return text.length;
}

/** The text with the inside of each string, regular expression and comment blank, so that a brace in them counts for nothing. Lines and columns stay. */
function cleanText(text: string, family: Family, rust: boolean, js: boolean): string {
  const comment = family === 'brace' ? '//' : '#';
  const quotes = family === 'brace' ? '\'"`' : '\'"';
  const blank = (part: string): string => part.replace(/[^\n]/g, ' ');
  const out: string[] = [];
  let last = ''; // the last character of code before this one that is no space
  let at = 0;
  while (at < text.length) {
    const char = text[at];
    const regex = js && char === '/' && text[at + 1] !== '/' && text[at + 1] !== '*' && (!last || BEFORE_REGEX.includes(last)) ? regexEnd(text, at) : -1;
    if (regex > 0) {
      out.push('/', blank(text.slice(at + 1, regex)), '/');
      at = regex + 1;
      last = '/';
    } else if (text.startsWith(comment, at)) {
      const end = text.indexOf('\n', at);
      const stop = end < 0 ? text.length : end;
      out.push(' '.repeat(stop - at));
      at = stop;
    } else if (family === 'brace' && text.startsWith('/*', at)) {
      const end = text.indexOf('*/', at + 2);
      const stop = end < 0 ? text.length : end + 2;
      out.push(blank(text.slice(at, stop)));
      at = stop;
    } else if (quotes.includes(char) && !(rust && char === "'" && text[at + 1] !== '\\' && text[at + 2] !== "'")) { // a lifetime of Rust is no string
      const quote = family === 'python' && text.startsWith(char.repeat(3), at) ? char.repeat(3) : char;
      const end = stringEnd(text, at, quote, js);
      const closed = text.startsWith(quote, end);
      const shown = quote.length === 3 ? '   ' : quote; // a closing """ at the start of a line ends no block of Python
      out.push(shown, blank(text.slice(at + quote.length, end)), closed ? shown : '');
      at = closed ? end + quote.length : end;
      last = char;
    } else {
      out.push(char);
      if (char.trim()) last = char;
      at++;
    }
  }
  return out.join('');
}

const indentOf = (line: string): number => line.length - line.trimStart().length;

/** The next line with text after a line, or ''. */
const nextLine = (lines: string[], at: number): string => lines.slice(at + 1).find((line) => line.trim()) ?? '';

/** True when a statement goes on after this line. A comma goes on only before a body, as in a list of a C++ constructor. */
const goesOn = (lines: string[], at: number, comma: boolean): boolean => /(=>|[=+\-*/&|?:])\s*$/.test(lines[at]) || (comma && /,\s*$/.test(lines[at]))
  || /^\s*([{.:?]|=>|->|where\b|throws\b|extends\b|implements\b)/.test(nextLine(lines, at));

/** The last line of a definition of a brace language, by its brackets. Undefined when it needs a body and has none. */
function braceEnd(lines: string[], start: number, from: number, needsBody: boolean): number | undefined {
  let depth = 0;
  let body = false;
  for (let at = start; at < lines.length; at++) {
    for (const char of at === start ? lines[at].slice(from) : lines[at]) {
      if (char === '{' || char === '(' || char === '[') {
        if (char === '{' && depth === 0) body = true;
        depth++;
      } else if (char === '}' || char === ')' || char === ']') depth--;
      if (depth < 0 || (char === ';' && depth === 0)) return body || !needsBody ? at : undefined;
    }
    if (depth === 0 && (body || !goesOn(lines, at, needsBody))) return body || !needsBody ? at : undefined;
  }
  return undefined;
}

/** The last line of a Python definition: its header may span lines, then its body is every line indented more than it. */
function pythonEnd(lines: string[], start: number): number {
  let header = start;
  for (let depth = 0; header < lines.length; header++) {
    for (const char of lines[header]) depth += '([{'.includes(char) ? 1 : ')]}'.includes(char) ? -1 : 0;
    if (depth <= 0) break;
  }
  if (header >= lines.length) return start; // a header that never closes
  if (!lines[header].trimEnd().endsWith(':')) return header; // a body on the line of the header
  let end = header;
  for (let at = header + 1; at < lines.length && (!lines[at].trim() || indentOf(lines[at]) > indentOf(lines[start])); at++) if (lines[at].trim()) end = at;
  return end;
}

/** The last line of a Ruby definition: the "end" at its indentation. A definition on one line ends on it. */
function rubyEnd(lines: string[], start: number): number | undefined {
  if (/\bend\s*$/.test(lines[start]) || /^\s*def\s+[\w.]+[?!]?(\([^)]*\))?\s*=\s*[^(\s=]/.test(lines[start])) return start;
  const indent = indentOf(lines[start]);
  for (let at = start + 1; at < lines.length; at++) {
    if (!lines[at].trim()) continue;
    if (indentOf(lines[at]) < indent) return undefined;
    if (indentOf(lines[at]) === indent && /^\s*end\b/.test(lines[at])) return at;
  }
  return undefined;
}

/** A definition that starts at a line: its name, whether it is a test, and its last line (undefined when it has none). */
type Found = { name: string; test?: boolean; end?: number };

/** The text of the string that a match ends at the opening quote of (its last group), read from the raw line. */
const quoted = (match: RegExpExecArray, clean: string, raw: string): string => raw.slice(match[0].length, clean.indexOf(match[match.length - 1], match[0].length));

/** A definition of a brace language at a line. A method or a function with no keyword must have a body: else it is a call or a declaration. */
function braceAt(path: string, lines: string[], raw: string[], at: number): Found | undefined {
  const clean = lines[at];
  let match = TEST_CALL.exec(clean);
  if (match && JS_FILE.test(path)) return { name: quoted(match, clean, raw[at]), test: true, end: braceEnd(lines, at, 0, false) };
  match = ROUTE.exec(clean);
  if (match) return { name: `${match[1]} ${quoted(match, clean, raw[at])}`, end: braceEnd(lines, at, 0, false) };
  match = CLASS.exec(clean) ?? KEYWORD.exec(clean);
  if (match) return { name: match[1], test: path.endsWith('.go') && /^Test/.test(match[1]), end: braceEnd(lines, at, match.index, false) };
  match = JS_FILE.test(path) ? ARROW.exec(clean) : null;
  if (match) return { name: match[1], end: braceEnd(lines, at, 0, false) };
  match = METHOD_FILE.test(path) ? METHOD.exec(clean) : null;
  const name = match?.[2].split('::').pop()!;
  if (!match || CONTROL.has(name) || match[1].split(/\s+/).some((word) => CONTROL.has(word))) return undefined;
  return { name, end: braceEnd(lines, at, 0, true) };
}

/** A definition of Python at a line: a def or a class. */
function pythonAt(lines: string[], at: number): Found | undefined {
  const match = PY_DEF.exec(lines[at]);
  return match ? { name: match[2], test: match[1] === 'def' && /^test_/.test(match[2]), end: pythonEnd(lines, at) } : undefined;
}

/** A definition of Ruby at a line: a def, a class, or a test block with a name. */
function rubyAt(lines: string[], raw: string[], at: number): Found | undefined {
  const def = RB_DEF.exec(lines[at]);
  if (def) return { name: def[1] ?? def[2], test: /^test_/.test(def[1] ?? ''), end: rubyEnd(lines, at) };
  const call = TEST_CALL.exec(lines[at]);
  return call ? { name: quoted(call, lines[at], raw[at]), test: true, end: rubyEnd(lines, at) } : undefined;
}

/** The functions, methods, classes and route handlers of a file, in the order of their first lines. A definition of 1 to 3 lines is left out: it gets no note. */
export function definitionsOf(path: string, text: string): Definition[] {
  const family = familyOf(path);
  if (!family) return [];
  const raw = text.split('\n');
  const lines = cleanText(text, family, /\.rs$/i.test(path), JS_FILE.test(path)).split('\n');
  const testFile = isTestPath(path);
  const found: Definition[] = [];
  for (let at = 0; at < lines.length; at++) {
    const one = family === 'brace' ? braceAt(path, lines, raw, at) : family === 'python' ? pythonAt(lines, at) : rubyAt(lines, raw, at);
    if (one?.end !== undefined && one.end - at >= 3) found.push({ name: one.name, lines: [at + 1, one.end + 1], test: testFile || !!one.test });
  }
  return found;
}

const near = (a: number, b: number): boolean => Math.abs(a - b) <= 1;

/** The definitions that have no note: no note from its first line to its last (give or take one), and no note inside it. A skip of its lines answers it too. */
const unnoted = (definitions: Definition[], notes: Pick<Note, 'lines'>[], skips: Pick<Skip, 'lines'>[]): Definition[] => definitions.filter(({ lines: [first, last] }) =>
  !notes.some(({ lines }) => (near(lines[0], first) && near(lines[1], last)) || (lines[0] >= first && lines[1] <= last))
  && !skips.some(({ lines }) => lines[0] === first && lines[1] === last));

/** The definitions of these files with no note, the most used first, then the longest. `others` is read only when there is a gap. */
export function gapsIn(files: { path: string; text: string }[], notes: Note[], skips: Skip[], others: () => { path: string; text: string }[], keep = (_file: string, _line: number): boolean => true): Gap[] {
  const found = files.flatMap(({ path, text }) => unnoted(definitionsOf(path, text), notes.filter((note) => note.file === path), skips.filter((skip) => skip.file === path))
    .filter((one) => keep(path, one.lines[0])).map((one) => ({ file: path, lines: one.lines, name: one.name })));
  if (!found.length) return [];
  const names = new Set(found.map((gap) => gap.name));
  const naming = new Map<string, string[]>(); // a name, and the code files that name it
  for (const { path, text } of others()) for (const word of new Set(text.match(/[A-Za-z_$][\w$]*/g))) if (names.has(word)) naming.set(word, [...(naming.get(word) ?? []), path]);
  return found.map((gap) => ({ ...gap, used: (naming.get(gap.name) ?? []).filter((path) => path !== gap.file).length }))
    .sort((a, b) => b.used - a.used || (b.lines[1] - b.lines[0]) - (a.lines[1] - a.lines[0]));
}
