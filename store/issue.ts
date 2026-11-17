// "apostil issue": an issue about Apostil that a person submits on GitHub under their own account. Nothing here writes to GitHub.
// --facts gives the versions and the lines of doctor; with --kind and --title the body comes on standard input, gets the facts at its end
// and a guard that takes private text out; --open opens GitHub's page for a new issue with it filled in. No `vscode` import.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { arch, homedir, hostname, platform, release, userInfo } from 'node:os';
import { join, resolve } from 'node:path';
import { APP_NAMES, APP_PROGRAMS, findOnPath } from '../shared/agents';
import { storeFolder } from '../shared/store';
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

/** What the guard replaces: the home folder, the user name and the names of the computer. */
export interface Who {
  home: string;
  user: string;
  computers: string[];
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

/** The rules in their order: secrets and e-mail addresses first, then the home folder and the computer, the user name last. */
function rules(who: Who): { what: string; pattern: RegExp; to: string }[] {
  const slashed = who.home.replace(/\\/g, '/');
  const homes = [...new Set([who.home, slashed, encodeURI(slashed)])].filter((home) => home.length > 1);
  const homeFlags = platform() === 'win32' ? 'gi' : 'g'; // Windows paths are the same in any case
  const computers = who.computers.filter((name) => name.length > 1).sort((a, b) => b.length - a.length);
  return [
    ...TOKENS.map((pattern) => ({ what: 'a key or token', pattern, to: '<removed>' })),
    { what: 'a key or password after its name', pattern: NAMED_SECRET, to: '$1<removed>' },
    { what: 'an e-mail address', pattern: EMAIL, to: '<removed>' },
    ...homes.map((home) => ({ what: 'the home folder', pattern: new RegExp(`${escape(home)}(?![A-Za-z0-9_-])`, homeFlags), to: '<home>' })),
    { what: 'the home folder', pattern: /(?<![A-Za-z0-9_.~/-])~(?=\/)/g, to: '<home>' }, // the short form of doctor
    ...computers.map((name) => ({ what: 'the name of the computer', pattern: wholeWord(name), to: '<computer>' })),
    // The user name as a whole word; a common account name (admin, dev, test…) only in a path or before "@", so the same word in the text stays.
    ...(who.user.length > 1 ? [{ what: 'the user name', pattern: GENERIC_USERS.has(who.user.toLowerCase())
      ? new RegExp(`(?<=[\\\\/])${escape(who.user)}(?=[\\\\/\\s"'),;:]|$)|(?<![A-Za-z0-9._-])${escape(who.user)}(?=@)`, 'gi')
      : wholeWord(who.user), to: '<user>' }] : []),
  ];
}

/** The text with private text replaced, and one line for each kind of thing that was replaced, with its count. It never repeats what it took out. */
export function cleanText(text: string, who: Who): { text: string; changed: string[] } {
  const counts = new Map<string, number>();
  for (const rule of rules(who)) {
    text = text.replace(rule.pattern, (...match) => {
      const line = `${rule.what} → ${rule.to.replace('$1', '')}`;
      counts.set(line, (counts.get(line) ?? 0) + 1);
      return rule.to.replace('$1', () => String(match[1])); // the name before a secret stays
    });
  }
  return { text, changed: [...counts].map(([line, count]) => `${line} (${count})`) };
}

/** The home folder, the user name and the names of this computer. */
export function whoIsHere(home = homedir()): Who {
  let user = '';
  try {
    user = userInfo().username;
  } catch { /* no user entry: nothing to replace */ }
  const names = [hostname(), hostname().split('.')[0]];
  if (platform() === 'darwin') {
    for (const key of ['ComputerName', 'LocalHostName']) names.push(spawnSync('/usr/sbin/scutil', ['--get', key], { encoding: 'utf8', timeout: 5000 }).stdout?.trim() ?? '');
  }
  return { home, user, computers: [...new Set(names)].filter((name) => name && name !== 'localhost') };
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
    doctor: doctor(run).lines.map((line) => cleanText(line, run.who).text.replace(/(?<![\w>])(?:\/[\w.@+-]+){2,}\/?/g, '<path>')),
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

/** The issue as it goes: the text (or the empty headings), the facts at its end, all of it through the guard, and the address. */
export function prepareIssue({ kind, title, text, facts, who, issues }: { kind: IssueKind; title: string; text: string; facts: Facts; who: Who; issues: string }): Issue {
  // A text far over the limit is refused before the guard reads it: the guard's patterns get slow on very long text.
  if (title.length + text.length > 4 * MAX_ADDRESS) return { title, body: '', changed: [], address: '', problems: [`The issue is too long: ${title.length + text.length} characters. Shorten the body: keep the first and last lines of a long error or output.`] };
  const cleanTitle = cleanText(title.trim(), who);
  const cleanBody = cleanText(`${text.trim() || emptyHeadings(kind).trim()}\n\n${factsText(facts)}\n`, who);
  const address = newIssueAddress(issues, cleanTitle.text, cleanBody.text);
  const problems = address.length > MAX_ADDRESS
    ? [`The issue is too long for GitHub's address: ${address.length} characters, at most ${MAX_ADDRESS}. Shorten the body: keep the first and last lines of a long error or output.`]
    : [];
  const changed = [...cleanTitle.changed.map((line) => `title: ${line}`), ...cleanBody.changed];
  return { title: cleanTitle.text, body: cleanBody.text, changed, address, problems };
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
  const who = whoIsHere(machine.home);
  const print = (output: unknown, ok: boolean): void => {
    console.log(JSON.stringify(output, null, 1));
    if (!ok) process.exitCode = 1;
  };
  const facts = (): Facts => issueFacts({ folder: resolve(value('--folder') ?? process.cwd()), machine, install: thisInstall(), cli, store: storeFolder(), who });
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
