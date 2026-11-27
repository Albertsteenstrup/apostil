// Tells whether a shell command only reads files, so that a run that Apostil starts does not wait for a person to allow it.
// It reads the command as the shell does (quotes, escapes, pipes, loops) and says yes only when each simple command starts with a program that only reads.
// When it is unsure, it says no, and the run asks as it always did.

/** The command of the hook that allows commands that only read (store/read-hook.ts), as a map run of Claude Code gets it. */
export const READ_HOOK_COMMAND = 'apostil read-hook';

/** What a "$" that the shell does not expand (in single quotes, or after a backslash) becomes in a word, so that a "$" in a word always means a variable. */
const LITERAL_DOLLAR = '\u0000';
const literal = (text: string): string => text.replaceAll('$', LITERAL_DOLLAR);

type Item = { kind: 'word'; text: string } | { kind: 'end' } | { kind: 'out' };

/** How many characters of `text` at `at` (a "$") belong to a variable that is safe to read: "$", "$name" or "${name}". Undefined for "$(" and for "${" with anything but a name. */
function variableLength(text: string, at: number): number | undefined {
  if (text[at + 1] === '(') return undefined;
  if (text[at + 1] !== '{') return 1;
  return /^\$\{\w+\}/.exec(text.slice(at))?.[0].length;
}

/** The text of the double quotes that start at `at`, and where they end; undefined for a command substitution, a backtick or quotes that never end. */
function doubleQuoted(text: string, at: number): { value: string; end: number } | undefined {
  let value = '';
  for (let i = at + 1; i < text.length; i++) {
    const char = text[i];
    if (char === '"') return { value, end: i };
    if (char === '`') return undefined;
    if (char === '\\' && i + 1 < text.length && '$`"\\\n'.includes(text[i + 1])) {
      if (text[i + 1] !== '\n') value += literal(text[i + 1]);
      i++;
    } else if (char === '$') {
      const length = variableLength(text, i);
      if (!length) return undefined;
      value += text.slice(i, i + length);
      i += length - 1;
    } else {
      value += char;
    }
  }
  return undefined;
}

/** The words of a command, with its ends (| ; && || & and new lines) and its output redirections (> >> &>) as items; undefined when it holds what is too hard to check. */
function items(command: string): Item[] | undefined {
  const out: Item[] = [];
  let word: string | undefined;
  const flush = (): void => {
    if (word !== undefined) out.push({ kind: 'word', text: word });
    word = undefined;
  };
  // An output redirection starts at `at` (the first ">"); the position of its last character, or -1 for one that is too hard to check. One that sends the output to no file ("2>&1", ">&2") adds no item.
  const redirect = (at: number): number => {
    let i = at;
    if (word !== undefined && /^\d+$/.test(word)) word = undefined;
    flush();
    while (command[i + 1] === '>' || command[i + 1] === '|') i++;
    if (command[i + 1] === '&') {
      const copy = /^&(\d+|-)/.exec(command.slice(i + 1));
      if (!copy) return -1;
      return i + copy[0].length;
    }
    out.push({ kind: 'out' });
    return i;
  };
  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    if (char === "'") {
      const end = command.indexOf("'", i + 1);
      if (end < 0) return undefined;
      word = (word ?? '') + literal(command.slice(i + 1, end));
      i = end;
    } else if (char === '"') {
      const quoted = doubleQuoted(command, i);
      if (!quoted) return undefined;
      word = (word ?? '') + quoted.value;
      i = quoted.end;
    } else if (char === '\\') {
      if (i + 1 >= command.length) return undefined;
      if (command[i + 1] !== '\n') word = (word ?? '') + literal(command[i + 1]);
      i++;
    } else if (char === '`' || char === '(' || char === ')') {
      return undefined;
    } else if (char === '$') {
      const length = variableLength(command, i);
      if (!length) return undefined;
      word = (word ?? '') + command.slice(i, i + length);
      i += length - 1;
    } else if (char === '#' && word === undefined) {
      const end = command.indexOf('\n', i);
      i = end < 0 ? command.length : end - 1;
    } else if (char === ' ' || char === '\t' || char === '\r') {
      flush();
    } else if (char === '\n' || char === ';') {
      flush();
      out.push({ kind: 'end' });
    } else if (char === '|') {
      flush();
      if (command[i + 1] === '|') i++;
      out.push({ kind: 'end' });
    } else if (char === '&') {
      if (command[i + 1] === '>') {
        const last = redirect(i + 1);
        if (last === -1 || command[last + 1] === '(') return undefined;
        i = last;
      } else {
        flush();
        if (command[i + 1] === '&') i++;
        out.push({ kind: 'end' });
      }
    } else if (char === '>') {
      const last = redirect(i);
      if (last === -1 || command[last + 1] === '(') return undefined;
      i = last;
    } else if (char === '<') {
      flush();
      if (command[i + 1] === '<' && command[i + 2] === '<') i += 2; // a here-string: its text is a word
      else if ('(<>&'.includes(command[i + 1] ?? ' ')) return undefined; // a process substitution, a here-document or one that reads and writes
    } else {
      word = (word ?? '') + char;
    }
  }
  flush();
  return out;
}

/** The words of each simple command. A redirection of output may only go to /dev/null, and then it is dropped; undefined for one that goes anywhere else. */
function simpleCommands(command: string): string[][] | undefined {
  const all = items(command);
  if (!all) return undefined;
  const commands: string[][] = [[]];
  for (let i = 0; i < all.length; i++) {
    const item = all[i];
    if (item.kind === 'end') {
      commands.push([]);
    } else if (item.kind === 'word') {
      commands[commands.length - 1].push(item.text);
    } else {
      const target = all[++i];
      if (target?.kind !== 'word' || target.text !== '/dev/null') return undefined;
    }
  }
  return commands;
}

const OPTION_WITH = (letters: string): RegExp => new RegExp(`^-[a-zA-Z]*[${letters}]`);
const hasVariable = (args: string[]): boolean => args.some((arg) => arg.includes('$'));

/** A sed script that may write a file or run a command: its `w` and `e` commands, and the `w` and `e` flags of `s`. A guess that leans to "yes, it may". */
function sedMayWrite(script: string): boolean {
  if (/s(.)(?:(?!\1)[^\\]|\\.)*\1(?:(?!\1)[^\\]|\\.)*\1[a-zA-Z0-9]*[we]/.test(script)) return true;
  const withoutPatterns = script.replace(/\/(?:[^\\/]|\\.)*\//g, '');
  return /(^|[;{}\s,])[0-9$]*[we]\s*\S/.test(withoutPatterns);
}

/** The programs that only read, each with the check of its arguments (what would make it write a file or run another command). */
const READERS: Record<string, (args: string[]) => boolean> = {
  echo: () => true, printf: () => true, grep: () => true, egrep: () => true, cat: () => true, ls: () => true, head: () => true, tail: () => true,
  wc: () => true, cut: () => true, tr: () => true, basename: () => true, dirname: () => true, stat: () => true, du: () => true, nl: () => true,
  column: () => true, jq: () => true, diff: () => true, comm: () => true, true: () => true, test: () => true, '[': () => true, apostil: () => true,
  rg: (args) => !hasVariable(args) && !args.some((arg) => /^--(pre|hostname-bin)/.test(arg)),
  sed: (args) => !hasVariable(args) && !args.some((arg) => (OPTION_WITH('i').test(arg) && !arg.startsWith('--')) || /^--(in-place|file)/.test(arg) || arg === '-f' || sedMayWrite(arg)),
  awk: (args) => !hasVariable(args) && !args.some((arg) => /system|getline|print[a-z]*[^;}]*[>|]|^-[a-zA-Z]*[fi]$/.test(arg)),
  sort: (args) => !hasVariable(args) && !args.some((arg) => (OPTION_WITH('o').test(arg) && !arg.startsWith('--')) || /^--(output|compress-program)/.test(arg)),
  uniq: (args) => !hasVariable(args) && args.filter((arg) => !arg.startsWith('-')).length <= 1,
  find: (args) => !hasVariable(args) && !args.some((arg) => /^-(exec|execdir|ok|okdir|delete|fprint|fprint0|fprintf|fls)$/.test(arg)),
  tree: (args) => !hasVariable(args) && !args.some((arg) => OPTION_WITH('o').test(arg) && !arg.startsWith('--')),
  file: (args) => !hasVariable(args) && !args.some((arg) => OPTION_WITH('C').test(arg) && !arg.startsWith('--')),
  git: (args) => gitReads(args),
};
READERS.egrep = READERS.grep;

const GIT_READS = ['log', 'show', 'diff', 'ls-files', 'grep', 'blame', 'status', 'rev-parse', 'cat-file', 'ls-tree'];

/** Whether a git command only reads: a read subcommand, after at most --no-pager and -C <folder>, and no option that writes a file or opens a pager. */
function gitReads(args: string[]): boolean {
  if (hasVariable(args)) return false;
  let at = 0;
  while (args[at] === '--no-pager' || args[at] === '-C') at += args[at] === '-C' ? 2 : 1;
  return GIT_READS.includes(args[at]) && !args.some((arg) => /^--output|^-O|^--open-files-in-pager/.test(arg));
}

/** The shell words that start or end a loop or a condition and run nothing themselves. */
const LEADING_WORDS = ['do', 'then', 'else', 'elif', 'if', 'while', 'until', '!'];

/** Whether one simple command only reads: a loop header, the end of a loop, or a program that only reads with arguments that do not make it write. */
function simpleReads(words: string[]): boolean {
  const rest = [...words];
  while (LEADING_WORDS.includes(rest[0])) rest.shift();
  if (!rest.length) return true;
  const [program, ...args] = rest;
  if (program === 'done' || program === 'fi') return !args.length;
  if (program === 'for') return /^\w+$/.test(args[0] ?? '') && (args.length === 1 || args[1] === 'in');
  return Object.hasOwn(READERS, program) && READERS[program](args);
}

/**
 * Whether a shell command only reads files: each simple command (split on | ; && || & and new lines, and on the words of loops and conditions) starts
 * with a program that only reads, and nothing writes through a redirection, a command substitution or a variable as the program. An empty command reads.
 * It says no when it is unsure.
 */
export function readsOnly(command: string): boolean {
  const commands = simpleCommands(command);
  return !!commands && commands.every(simpleReads);
}
