// "apostil issue": an issue about Apostil that a person submits on GitHub under their own account. Nothing here writes to GitHub.
// --facts gives the versions and the lines of doctor; with --kind and --title the body comes on standard input, gets the facts at its end
// and a guard that takes private text out; --open opens GitHub's page for a new issue with it filled in.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { arch, homedir, hostname, platform, release, userInfo } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { APP_NAMES, APP_PROGRAMS, findOnPath } from '../shared/agents';
import { tryGit } from '../shared/git';
import { storeFolder } from '../shared/store';
import { DRAFT_LINES } from './connect-claude-code';
import { doctor, exitOf, type DoctorRun } from './doctor';
import { thisInstall, type Machine } from './setup';

export type IssueKind = 'bug' | 'feedback';

/** The headings of the body of each kind, in their fixed order. Facts comes last. The two forms in .github/ISSUE_TEMPLATE have the same. */
export const HEADINGS: Record<IssueKind, string[]> = {
  bug: ['What I tried', 'Steps to see it again', 'What I expected', 'What I saw'],
  feedback: ['What I used Apostil for', 'What helped', 'What was in my way', 'What I missed'],
};
const FACTS_HEADING = 'Facts';

/** The form of each kind. Its label comes with it, also for a person who may not add labels: the query parameter `labels` needs that right. */
export const TEMPLATES: Record<IssueKind, string> = { bug: 'something-does-not-work.md', feedback: 'what-i-think.md' };

/** GitHub names no number; a longer address gets "414 URI Too Long". This limit stays clear of it. */
export const MAX_ADDRESS = 8000;

/** What an issue may tell about this machine. */
export interface Facts {
  apostil: string;
  vscode?: string;
  node: string;
  system: string; // for example "macOS 15.3 (arm64)", never the name of the computer
  apps: { name: string; version?: string }[];
  doctor: string[];
}

/** What the guard replaces: the home folder, the user name, the names of the computer and, in the person's text only, the names of the open repo. */
export interface Who {
  home: string;
  user: string;
  computers: string[];
  repo?: RepoNames;
}

/** The open repo as git names it: its top folder, the names of the repo and its owners, its branches and its tracked files. */
export interface RepoNames {
  top: string;
  names: string[];
  branches: string[];
  files: string[];
}

// ----- the guard -----

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A name as a whole word, in any case: not a piece of a longer word. */
const wholeWord = (name: string): RegExp => new RegExp(`(?<![A-Za-z0-9])${escape(name)}(?![A-Za-z0-9])`, 'gi');

/** Keys and tokens of the common forms. */
const TOKENS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g, // GitHub
  /\bsk-[A-Za-z0-9_-]{20,}/g, // Anthropic (sk-ant-), OpenAI (sk-proj-)
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, // AWS
  /\bxox[abposr]-[A-Za-z0-9-]{10,}/g, // Slack
  /\bAIza[0-9A-Za-z_-]{35}/g, // Google
  /\b[spr]k_(?:live|test)_[A-Za-z0-9]{10,}/g, // Stripe
  /\bnpm_[A-Za-z0-9]{30,}/g, // npm
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, // JSON web token
  /\bglpat-[A-Za-z0-9_-]{20,}/g, // GitLab
  /\bhf_[A-Za-z0-9]{30,}/g, // Hugging Face
  /(?<=\bhttps?:\/\/)[^\s/:@]+:[^\s/@]+(?=@)/g, // a name and password inside an address
];
/** A value after a name such as password or token: 8 or more signs with a letter and a digit. The name stays. */
const NAMED_SECRET = /(?<![A-Za-z0-9])((?:api[_-]?key|access[_-]?key|secret[_-]?key|client[_-]?secret|secret|token|password|passwd|pwd|bearer)["']?[ \t]*[:=]?[ \t]*["']?)(?=[^\s"']*\d)(?=[^\s"']*[A-Za-z])[^\s"',;]{8,}/gi;
const EMAIL = /(?<![A-Za-z0-9._%+-])(?!git@)[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

/** Account names that are also common words: the guard replaces them only where they name the account. */
const GENERIC_USERS = new Set(['admin', 'administrator', 'user', 'users', 'root', 'dev', 'developer', 'test', 'tester', 'guest', 'owner', 'default', 'ubuntu', 'runner', 'vagrant', 'pi', 'builder', 'app', 'code']);

/** Names of repos, owners and branches that are also common words, or that Apostil itself uses: the guard keeps them. */
const GENERIC_NAMES = new Set(['main', 'master', 'develop', 'dev', 'trunk', 'head', 'release', 'staging', 'production', 'app', 'code', 'test', 'tests',
  'api', 'web', 'src', 'docs', 'site', 'backend', 'frontend', 'server', 'client', 'apostil']);
/** Files of a repo that Apostil writes or names, and a few that every repo has: the guard keeps them. */
const KEPT_FILES = new Set(['.apostilignore', 'CLAUDE.md', 'AGENTS.md', 'package.json', 'package-lock.json', 'README.md', 'LICENSE', '.gitignore', 'tsconfig.json']);
const APOSTIL_FOLDERS = /^(?:\.claude|\.agents|\.codex)\//;
const DRAFT_FILES = DRAFT_LINES.map((line) => new RegExp(`^${line.slice(1).split('*').map(escape).join('.*')}$`));
/** A path or file name in the text, also right after "<repo>/". */
const PATH_WORD = /(?:(?<=<repo>\/)|(?<![\w.\/@+<-]))[\w.@+-](?:[\w.\/@+-]*[\w-])?(?![\w@+>-])/g;

/** Any of these names as a whole word, in any case, the longest first; never a piece of a placeholder such as <repo>. */
const anyWord = (names: string[]): RegExp =>
  new RegExp(`(?<![A-Za-z0-9<])(?:${[...names].sort((a, b) => b.length - a.length).map(escape).join('|')})(?![A-Za-z0-9>])`, 'gi');
const ownNames = (names: string[]): string[] => [...new Set(names)].filter((name) => name.length > 2 && !GENERIC_NAMES.has(name.toLowerCase()));
const pathForms = (path: string): string[] => {
  const slashed = path.replace(/\\/g, '/');
  return [...new Set([path, slashed, encodeURI(slashed)])].filter((form) => form.length > 1);
};

interface Rule { what: string; pattern: RegExp; to: string; only?: (found: string) => boolean }

/** The names, branches and files of the repo. A file is a path or a name with a dot: a lone word is often a common one. */
function repoNameRules(repo: RepoNames): Rule[] {
  const names = ownNames(repo.names);
  const branches = ownNames(repo.branches);
  const files = new Set(repo.files.filter((file) => !APOSTIL_FOLDERS.test(file)).flatMap((file) => [file, basename(file)])
    .filter((name) => name.length > 2 && /[./]/.test(name) && !KEPT_FILES.has(name) && !DRAFT_FILES.some((draft) => draft.test(name))));
  return [
    ...(names.length ? [{ what: 'a name of the repo', pattern: anyWord(names), to: '<repo>' }] : []),
    ...(branches.length ? [{ what: 'a branch name', pattern: anyWord(branches), to: '<branch>' }] : []),
    ...(files.size ? [{ what: 'a file of the repo', pattern: PATH_WORD, to: '<file>', only: (found: string) => files.has(found) }] : []),
  ];
}

/** The rules in their order: secrets and e-mail addresses first, then the folder of the repo (often inside the home folder), the home folder, the computer
 * and the user name, the names of the repo last. */
function rules(who: Who): Rule[] {
  const pathFlags = platform() === 'win32' ? 'gi' : 'g'; // Windows paths are the same in any case
  const folder = (path: string, what: string, to: string): Rule[] =>
    pathForms(path).map((form) => ({ what, pattern: new RegExp(`${escape(form)}(?![A-Za-z0-9_-])`, pathFlags), to }));
  const computers = who.computers.filter((name) => name.length > 1).sort((a, b) => b.length - a.length);
  return [
    ...TOKENS.map((pattern) => ({ what: 'a key or token', pattern, to: '<removed>' })),
    { what: 'a key or password after its name', pattern: NAMED_SECRET, to: '$1<removed>' },
    { what: 'an e-mail address', pattern: EMAIL, to: '<removed>' },
    ...(who.repo ? folder(who.repo.top, 'the folder of the repo', '<repo>') : []),
    ...folder(who.home, 'the home folder', '<home>'),
    { what: 'the home folder', pattern: /(?<![A-Za-z0-9_.~/-])~(?=\/)/g, to: '<home>' }, // the short form of doctor
    ...computers.map((name) => ({ what: 'the name of the computer', pattern: wholeWord(name), to: '<computer>' })),
    // The user name as a whole word; a common account name (admin, dev, test…) only in a path or before "@", so the same word in the text stays.
    ...(who.user.length > 1 ? [{ what: 'the user name', pattern: GENERIC_USERS.has(who.user.toLowerCase())
      ? new RegExp(`(?<=[\\\\/])${escape(who.user)}(?=[\\\\/\\s"'),;:]|$)|(?<![A-Za-z0-9._-])${escape(who.user)}(?=@)`, 'gi')
      : wholeWord(who.user), to: '<user>' }] : []),
    ...(who.repo ? repoNameRules(who.repo) : []),
  ];
}

/** Replaces by the rules and counts each kind of thing replaced in `counts`. */
function replaceAll(text: string, who: Who, counts: Map<string, number>): string {
  for (const rule of rules(who)) {
    text = text.replace(rule.pattern, (...match) => {
      if (rule.only && !rule.only(match[0])) return match[0];
      const line = `${rule.what} → ${rule.to.replace('$1', '')}`;
      counts.set(line, (counts.get(line) ?? 0) + 1);
      return rule.to.replace('$1', () => String(match[1])); // the name before a secret stays
    });
  }
  return text;
}

const changedLines = (counts: Map<string, number>): string[] => [...counts].map(([line, count]) => `${line} (${count})`);

/** The text with private text replaced, and one line for each kind of thing that was replaced, with its count. It never repeats what it took out. */
export function cleanText(text: string, who: Who): { text: string; changed: string[] } {
  const counts = new Map<string, number>();
  return { text: replaceAll(text, who, counts), changed: changedLines(counts) };
}

/** The guard without the rules of the repo, for the facts: they name no repo, and they must stay as they are. */
const machineOnly = (who: Who): Who => ({ ...who, repo: undefined });

/** The open repo of a folder as git names it, or undefined when the folder is in no repo or git is missing. */
export function repoNamesOf(folder: string): RepoNames | undefined {
  const top = tryGit(folder, 'rev-parse', '--show-toplevel');
  if (!top) return undefined;
  const remotes = (tryGit(top, 'remote', '-v') ?? '').split('\n').map((line) => /[:/]([^/:\s]+)\/([^/\s]+?)(?:\.git)?\/?\s/.exec(line)).filter((found) => found !== null);
  return {
    top,
    names: [basename(top), ...remotes.flatMap((found) => [found[1], found[2]])],
    branches: (tryGit(top, 'for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes') ?? '').split('\n')
      .map((ref) => ref.replace(/^refs\/(?:heads|remotes\/[^/]+)\//, '')).filter(Boolean),
    files: (tryGit(top, 'ls-files') ?? '').split('\n').filter(Boolean),
  };
}

/** The home folder, the user name and the names of this computer, and the open repo of a folder when one is given. */
export function whoIsHere(home = homedir(), folder?: string): Who {
  let user = '';
  try {
    user = userInfo().username;
  } catch { /* no user entry: nothing to replace */ }
  const names = [hostname(), hostname().split('.')[0]];
  if (platform() === 'darwin') {
    for (const key of ['ComputerName', 'LocalHostName']) names.push(spawnSync('/usr/sbin/scutil', ['--get', key], { encoding: 'utf8', timeout: 5000 }).stdout?.trim() ?? '');
  }
  return { home, user, computers: [...new Set(names)].filter((name) => name && name !== 'localhost'), repo: folder ? repoNamesOf(folder) : undefined };
}

// ----- the facts -----

/** The name and version of the system, and its processor kind. */
export function systemName(): string {
  const kind = platform();
  if (kind === 'darwin') return `macOS ${spawnSync('/usr/bin/sw_vers', ['-productVersion'], { encoding: 'utf8', timeout: 5000 }).stdout?.trim() || release()} (${arch()})`;
  if (kind === 'linux') {
    try {
      const pretty = /^PRETTY_NAME="?([^"\n]+)"?/m.exec(readFileSync('/etc/os-release', 'utf8'))?.[1];
      if (pretty) return `${pretty} (${arch()})`;
    } catch { /* no file: the kernel below */ }
  }
  return `${kind === 'win32' ? 'Windows' : kind === 'linux' ? 'Linux' : kind} ${release()} (${arch()})`;
}

/** The first version number in the output of `<program> --version`, or undefined. */
function versionOf(machine: Machine, program: string): string | undefined {
  return /\d+\.\d+(?:\.\d+)*/.exec(exitOf(machine, program, ['--version'])?.out ?? '')?.[0];
}

/** The version of VS Code: from its terminal, else from `code --version`. */
function vscodeVersion(machine: Machine, env: Record<string, string | undefined>): string | undefined {
  if (env.TERM_PROGRAM === 'vscode' && env.TERM_PROGRAM_VERSION) return env.TERM_PROGRAM_VERSION;
  return versionOf(machine, 'code');
}

/** The facts of this machine. The lines of doctor go through the guard, though doctor is made to hold no paths and no names. */
export function issueFacts(run: DoctorRun & { vscode?: string; who: Who; env?: Record<string, string | undefined> }): Facts {
  const apps = Object.entries(APP_PROGRAMS)
    .filter(([, program]) => findOnPath(program, run.machine.path))
    .map(([id, program]) => ({ name: APP_NAMES[id], version: versionOf(run.machine, program) }));
  return {
    apostil: run.install.version,
    vscode: run.vscode ?? vscodeVersion(run.machine, run.env ?? process.env),
    node: run.node ?? process.versions.node,
    system: systemName(),
    apps,
    // Doctor is made to hold no paths; a path that slips in (for example of another install) becomes <path>.
    doctor: doctor(run).lines.map((line) => cleanText(line, machineOnly(run.who)).text.replace(/(?<![\w>])(?:\/[\w.@+-]+){2,}\/?/g, '<path>')),
  };
}

/** The facts as the last section of the body. */
export function factsText(facts: Facts): string {
  const apps = facts.apps.map((app) => `${app.name} ${app.version ?? '(version not known)'}`).join(', ') || 'none found';
  return [
    `### ${FACTS_HEADING}`, '',
    `- Apostil ${facts.apostil}`,
    `- VS Code ${facts.vscode ?? 'not known'}`,
    `- Node ${facts.node}`,
    `- ${facts.system}`,
    `- Agent apps: ${apps}`, '',
    '`apostil doctor`:', '', '```text', ...facts.doctor, '```',
  ].join('\n');
}

// ----- the issue and its address -----

/** The address of the issues of Apostil, from package.json: `bugs.url`, else `repository`. Nothing else in the code names the repo. */
export function issuesAddress(root = join(__dirname, '..', '..')): string | undefined {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const repository = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  const address = pkg.bugs?.url ?? (repository ? `${repository.replace(/^git\+/, '').replace(/\.git$/, '')}/issues` : undefined);
  return /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues$/.test(address ?? '') ? address : undefined; // only GitHub's page goes to the browser
}

/** GitHub's page for a new issue with the title and body filled in. No `template`: with it GitHub may show the form in place of the body,
 * and no `labels`: a person who may not add labels gets an error page. The makers add the label. */
export const newIssueAddress = (issues: string, title: string, body: string): string =>
  `${issues}/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;

/** The headings of a kind with nothing under them. */
export const emptyHeadings = (kind: IssueKind): string =>
  `<!-- Leave out names, paths, the names of repos and branches, code and keys. -->\n\n${HEADINGS[kind].map((heading) => `### ${heading}\n`).join('\n')}`;

export interface Issue {
  title: string;
  body: string;
  changed: string[];
  address: string;
  problems: string[];
}

/** The issue as it goes: the text (or the empty headings) and the facts at its end through the guard, the rules of the repo on the text only, and the address. */
export function prepareIssue({ kind, title, text, facts, who, issues }: { kind: IssueKind; title: string; text: string; facts: Facts; who: Who; issues: string }): Issue {
  // A text far over the limit is refused before the guard reads it: the guard's patterns get slow on very long text.
  if (title.length + text.length > 4 * MAX_ADDRESS) return { title, body: '', changed: [], address: '', problems: [`The issue is too long: ${title.length + text.length} characters. Shorten the body: keep the first and last lines of a long error or output.`] };
  const cleanTitle = cleanText(title.trim(), who);
  const counts = new Map<string, number>();
  const body = `${replaceAll(text.trim() || emptyHeadings(kind).trim(), who, counts)}\n\n${replaceAll(factsText(facts), machineOnly(who), counts)}\n`;
  const address = newIssueAddress(issues, cleanTitle.text, body);
  const problems = address.length > MAX_ADDRESS
    ? [`The issue is too long for GitHub's address: ${address.length} characters, at most ${MAX_ADDRESS}. Shorten the body: keep the first and last lines of a long error or output.`]
    : [];
  const changed = [...cleanTitle.changed.map((line) => `title: ${line}`), ...changedLines(counts)];
  return { title: cleanTitle.text, body, changed, address, problems };
}

/** Opens an address in the browser and does not wait. APOSTIL_BROWSER names another program, for a check. */
export function openInBrowser(address: string, env: Record<string, string | undefined> = process.env): void {
  const [program, ...args] = env.APOSTIL_BROWSER ? [env.APOSTIL_BROWSER]
    : platform() === 'darwin' ? ['open'] : platform() === 'win32' ? ['rundll32', 'url.dll,FileProtocolHandler'] : ['xdg-open'];
  spawn(program, [...args, address], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
}

// ----- the command -----

/** Runs `apostil issue` and prints its JSON. `cli` is the cli.js of this install, for doctor. */
export function runIssue(words: string[], cli: string): void {
  const value = (flag: string): string | undefined => {
    const at = words.indexOf(flag);
    return at >= 0 ? words[at + 1] : undefined;
  };
  const machine = { home: homedir(), path: process.env.PATH ?? '' };
  const folder = resolve(value('--folder') ?? process.cwd());
  const who = whoIsHere(machine.home, folder);
  const print = (output: unknown, ok: boolean): void => {
    console.log(JSON.stringify(output, null, 1));
    if (!ok) process.exitCode = 1;
  };
  const facts = (): Facts => issueFacts({ folder, machine, install: thisInstall(), cli, store: storeFolder(), who });
  if (words.includes('--facts')) return print(facts(), true);

  const kind = value('--kind');
  // --file: the issue as a file whose first line is "# <title>", which an agent writes with its file tool. No quoting in a shell, no here-document.
  const file = value('--file');
  const written = file && existsSync(file) ? readFileSync(file, 'utf8') : undefined;
  if (file && written === undefined) return print({ problems: [`There is no file ${file}.`] }, false);
  const head = written !== undefined ? /^#[ \t]+(.+)\n?/.exec(written) : null;
  const title = (head ? head[1] : value('--title')) ?? '';
  const issues = issuesAddress();
  if (kind !== 'bug' && kind !== 'feedback') return print({ problems: ['Give --kind bug (something does not work) or --kind feedback (what I think).'] }, false);
  if (!title.trim()) return print({ problems: [file ? `The first line of ${file} must be "# <a few plain words that name the part and the fault>".` : 'Give --file <issue.md> (its first line "# <title>") or --title "<title>".'] }, false);
  if (!issues) return print({ problems: ['package.json of Apostil names no issues page on GitHub (bugs.url or repository).'] }, false);
  const text = written !== undefined ? written.slice(head ? head[0].length : 0) : process.stdin.isTTY ? '' : readFileSync(0, 'utf8');
  const issue = prepareIssue({ kind, title, text, facts: facts(), who, issues });
  const { address, problems, ...shown } = issue;
  if (problems.length) return print({ ...shown, problems }, false);
  if (!words.includes('--open')) return print(shown, true);
  openInBrowser(address);
  if (file) rmSync(file, { force: true }); // the issue is on its way; the file must not stay in the repo
  print({ ...shown, address, opened: 'The browser was asked to open GitHub\'s page for a new issue with this title and body. The person reads it there and presses "Submit new issue". When no browser opened, give the person the address.' }, true);
}
