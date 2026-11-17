// The links that open Apostil from outside VS Code: the first line of a pull request description, the last line of an agent's report, the band of the Claude mod.
// A link names only "owner/name", a number and a branch, never a path of the computer. One switch turns every link and nudge off.

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { storeFolder } from './store';

/** Apostil's icon, 32 × 32 (view/media/apostil-icon-32.png), as a file of the public repo on raw.githubusercontent.com. With an empty address the line has no icon. */
export const ICON_URL = 'https://raw.githubusercontent.com/Albertsteenstrup/apostil/main/view/media/apostil-icon-32.png';

const HANDLER = 'vscode://apostil.apostil'; // the publisher and the name of the extension
// GitHub drops a vscode:// link from its markdown, and Claude Code Desktop does not open one. So a link that leaves Apostil is this https address, which redirects to it.
const REDIRECT = 'https://vscode.dev/redirect?url=';

/** What a link opens: a pull request by number or by branch, or the change of a branch. */
export interface LinkTarget {
  open: 'pull' | 'change';
  repo: string; // "owner/name" on GitHub
  number?: number;
  branch?: string;
}

// ----- the checks of each field -----

/** "owner/name" as GitHub allows it. */
export const isRepo = (text: string): boolean => /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/.test(text) && !/\/\.\.?$/.test(text);

const isNumber = (text: string): boolean => /^[1-9]\d{0,9}$/.test(text);

/**
 * A branch name as `git check-ref-format --branch` allows it. Also no "&": VS Code decodes the query before the handler reads it,
 * so a "&" in a value would split it. Such a branch gets no link.
 */
export function isBranch(name: string): boolean {
  return name.length > 0 && name.length <= 255 && name !== '@' && name !== 'HEAD'
    && !/[\x00-\x20\x7f~^:?*[\\&]/.test(name) // no control character, space or sign that Git refuses
    && !/\.\.|@\{|\/\/|^[-/.]|[/.]$|\/\.|\.lock(\/|$)/.test(name); // no "..", "@{" or "//"; no part that starts with a dot or ends with ".lock"
}

// ----- building and reading -----

// Also "(" and ")", which encodeURIComponent keeps: one alone would end the markdown link of a pull request description early.
const encode = (text: string): string => encodeURIComponent(text).replace(/\(/g, '%28').replace(/\)/g, '%29');
// "/" stays readable in a field; everything else that is not a letter or a digit is encoded.
const field = (value: string): string => encode(value).replace(/%2F/g, '/');

/** The vscode:// link. Its fields are repo, number and branch: never "url", which vscode.dev adds on its way. */
export function appLink(target: LinkTarget): string {
  const fields: [string, string | undefined][] = [['repo', target.repo], ['number', target.number?.toString()], ['branch', target.branch]];
  return `${HANDLER}/${target.open}?${fields.filter(([, value]) => value !== undefined).map(([name, value]) => `${name}=${field(value!)}`).join('&')}`;
}

/** The https link that every line outside VS Code uses. */
export const webLink = (target: LinkTarget): string => REDIRECT + encode(appLink(target));

/**
 * Reads a link as VS Code hands it to the handler: its path and its query, already decoded.
 * Undefined when the path is unknown or a field is missing or wrong. A field it does not know is passed over,
 * such as the "url" that vscode.dev adds: that one holds the whole link again, so the first of two fields of one name counts.
 */
export function readLink(path: string, query: string): LinkTarget | undefined {
  const fields = new Map<string, string>();
  for (const part of query.split('&')) {
    const at = part.indexOf('=');
    const name = at < 0 ? part : part.slice(0, at);
    if (!fields.has(name)) fields.set(name, at < 0 ? '' : part.slice(at + 1));
  }
  const repo = fields.get('repo') ?? '';
  const number = fields.get('number');
  const branch = fields.get('branch');
  if (!isRepo(repo) || (number !== undefined && !isNumber(number)) || (branch !== undefined && !isBranch(branch))) return undefined;
  if (path === '/pull' && number !== undefined) return { open: 'pull', repo, number: Number(number) };
  if ((path === '/pull' || path === '/change') && branch !== undefined) return { open: path === '/pull' ? 'pull' : 'change', repo, branch };
  return undefined;
}

/** The first line of a pull request description: the icon when ICON_URL is set, the link, and what Apostil shows of the change. */
export function markdownLine(link: string, parts: number | undefined, icon = ICON_URL): string {
  const shows = parts ? `diagrams of its ${parts} part${parts === 1 ? '' : 's'}` : 'its conversation and checks';
  return `${icon ? `<img src="${icon}" width="16" height="16" alt=""> ` : ''}[**Read this change in Apostil**](${link}) · ${shows}`;
}

// ----- the switch -----

/** The file in Apostil's store that turns the links off while it is there. */
export const linksOffFile = (folder = storeFolder()): string => join(folder, 'links-off');

/** False when the person turned the links and nudges off: "apostil links off", the command in VS Code, or APOSTIL_NO_LINKS=1. */
export const linksOn = (env: NodeJS.ProcessEnv = process.env, folder = storeFolder()): boolean => env.APOSTIL_NO_LINKS !== '1' && !existsSync(linksOffFile(folder));

export function setLinks(on: boolean, folder = storeFolder()): void {
  if (on) return rmSync(linksOffFile(folder), { force: true });
  mkdirSync(folder, { recursive: true });
  writeFileSync(linksOffFile(folder), 'Apostil shows no links and no nudges while this file is here. "apostil links on" removes it.\n');
}
