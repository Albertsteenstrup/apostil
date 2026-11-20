// .apostilignore: the file at the top of a repo that chooses what Apostil maps, in the syntax of .gitignore. A plain line gives the files that it
// matches no notes, only their path. A line that starts with "!" gives them notes, also files that the rule of note-groups leaves out. The last line
// that matches a file wins; a file that no line matches keeps the rule. Unlike Git, a "!" line brings back a file inside a folder that a line before
// left out: Apostil matches files, not folders. The rule itself and its reasons stand in note-groups.ts (codeFiles, ruleFor).

import { fileText } from './git';

export const SCOPE_FILE = '.apostilignore';

/** One line of the file that matches files. */
export interface ScopeLine {
  line: number; // its number in the file, from 1
  text: string; // as written, with no spaces at its end
  notes: boolean; // a "!" line: the files that it matches get notes
  folders: boolean; // it ends with "/": it matches folders only, so the files in them
  pattern: RegExp; // matches a path from the top of the repo
}

const REGEX_SIGNS = /[.+^${}()|[\]\\*?]/g;

/**
 * A pattern as a regular expression for a whole path. `*` and `?` stay within one folder name, `[abc]` is one letter of a name (`[!abc]` none of them),
 * `**` matches across folders (at the start, between two "/" or at the end), and `\` makes the next letter plain. A pattern that is not `anchored` to the
 * top folder matches in any folder.
 */
function patternOf(glob: string, anchored: boolean): RegExp {
  let source = '';
  for (let at = 0; at < glob.length; at++) {
    const char = glob[at];
    const wholeName = (at === 0 || glob[at - 1] === '/') && (glob[at + 2] === '/' || at + 2 === glob.length);
    if (char === '\\' && at + 1 < glob.length) source += glob[++at].replace(REGEX_SIGNS, '\\$&');
    else if (glob.startsWith('**', at) && wholeName) {
      source += glob[at + 2] === '/' ? '(?:.*/)?' : '.*'; // "**/": no folder or any folders; "/**" at the end: all in it
      at += glob[at + 2] === '/' ? 2 : 1;
    } else if (char === '*') source += '[^/]*';
    else if (char === '?') source += '[^/]';
    else if (char === '[' && glob.indexOf(']', at + 2) > 0) {
      const end = glob.indexOf(']', at + 2); // a "]" right after "[" is a letter of the set
      const set = glob.slice(at + 1, end);
      const not = set[0] === '!' || set[0] === '^';
      source += `(?!/)[${not ? '^' : ''}${(not ? set.slice(1) : set).replace(/[\\\]^[]/g, '\\$&')}]`;
      at = end;
    } else source += char.replace(REGEX_SIGNS, '\\$&');
  }
  return new RegExp(`^${anchored ? '' : '(?:.*/)?'}${source}$`);
}

/** The lines of the file that match files, in their order. A blank line and a comment ("#") count for nothing; "\#" and "\!" start a plain name. */
export function scopeLines(text: string): ScopeLine[] {
  return text.split('\n').flatMap((raw, at): ScopeLine[] => {
    const line = raw.replace(/\r$/, '').replace(/(?<!\\) +$/, ''); // the spaces at the end count for nothing, but "\ "
    if (!line || line.startsWith('#')) return [];
    const notes = line.startsWith('!');
    const glob = notes ? line.slice(1) : line;
    const folders = glob.endsWith('/') && !glob.endsWith('\\/');
    const bare = folders ? glob.slice(0, -1) : glob;
    // A "/" at the start or in the middle ties the line to the top folder; with none, it matches a name in any folder.
    const plain = bare.replace(/^\//, '');
    return plain ? [{ line: at + 1, text: line, notes, folders, pattern: patternOf(plain, bare.includes('/')) }] : [];
  });
}

/** The lines of the .apostilignore of a folder, also when it is not committed; undefined when the repo has none. */
export function readScope(folder: string): ScopeLine[] | undefined {
  const text = fileText(folder, SCOPE_FILE);
  return text === undefined ? undefined : scopeLines(text);
}

/** True when a line matches a file: the file itself, or a folder that holds it. A line that ends with "/" matches only the folders. */
function matches(line: ScopeLine, path: string): boolean {
  const names = path.split('/');
  for (let depth = 1; depth < names.length; depth++) if (line.pattern.test(names.slice(0, depth).join('/'))) return true;
  return !line.folders && line.pattern.test(path);
}

/** The line that decides a file: the last line that matches it. Undefined when no line does: the rule decides. */
export function lineFor(lines: ScopeLine[], path: string): ScopeLine | undefined {
  for (let at = lines.length - 1; at >= 0; at--) if (matches(lines[at], path)) return lines[at];
  return undefined;
}

/** A line in words, for `apostil why`: ".apostilignore line 3: legacy-admin/". */
export const lineWords = (line: ScopeLine): string => `${SCOPE_FILE} line ${line.line}: ${line.text}`;
