// Pictures of a private repo need a login, which the page does not have. The extension fetches them with the login of gh and hands them
// to the page as data addresses. A picture that cannot be fetched becomes its text and a link: never a broken icon.

import { execFile } from 'node:child_process';
import type { PullRequestView } from './read-pull-request';

/** Fetches one picture: a data address, or undefined when it cannot. */
export type FetchPicture = (url: string) => Promise<string | undefined>;

const MOST_BYTES = 5 * 1024 * 1024;
const MOST_PICTURES = 40;
// GitHub hosts whose pictures of a private repo need a login. Avatars, emoji and proxied pictures from the open web do not.
const NEEDS_LOGIN = /^https:\/\/(github\.com|[a-z0-9-]+\.githubusercontent\.com)\//;
const OPEN = /^https:\/\/(avatars|camo)\.githubusercontent\.com\//;
const PICTURE = /<img src="(https:[^"]+)"([^>]*)>/g;

const unescapeAttr = (value: string): string => value.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const escapeAttr = (value: string): string => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Every cleaned HTML of the pull request, to read and to replace. */
function htmlFields(pull: PullRequestView): { get: () => string; set: (html: string) => void }[] {
  const fields = [{ get: () => pull.html, set: (html: string) => { pull.html = html; } }];
  const comments = new Set<{ html: string }>();
  for (const item of pull.items) {
    if (item.kind === 'comment' || item.kind === 'review') comments.add(item);
    if (item.kind === 'review') item.threads.forEach((thread) => thread.comments.forEach((one) => comments.add(one)));
    if (item.kind === 'thread' || item.kind === 'reply') item.thread.comments.forEach((one) => comments.add(one));
  }
  for (const one of comments) fields.push({ get: () => one.html, set: (html: string) => { one.html = html; } });
  return fields;
}

/** In a private repo, puts each picture that needs a login into the HTML as a data address, or its text and a link when that fails. */
export async function inlinePictures(pull: PullRequestView, fetchPicture: FetchPicture): Promise<void> {
  if (!pull.private) return;
  const fields = htmlFields(pull);
  const urls = new Set<string>();
  for (const field of fields) for (const match of field.get().matchAll(PICTURE)) if (NEEDS_LOGIN.test(unescapeAttr(match[1])) && !OPEN.test(unescapeAttr(match[1]))) urls.add(match[1]);
  const fetched = new Map<string, string | undefined>();
  await Promise.all([...urls].slice(0, MOST_PICTURES).map(async (url) => fetched.set(url, await fetchPicture(unescapeAttr(url)).catch(() => undefined))));
  for (const field of fields) {
    field.set(field.get().replace(PICTURE, (whole, url: string, rest: string) => {
      if (!urls.has(url)) return whole;
      const data = fetched.get(url);
      if (data) return `<img src="${escapeAttr(data)}"${rest}>`;
      const alt = /alt="([^"]*)"/.exec(rest)?.[1] || 'a picture';
      return `<a data-link="${url}" class="nopic">Picture: ${alt}</a>`;
    }));
  }
}

/** The login of gh, read once. */
function ghToken(): Promise<string | undefined> {
  return new Promise((done) => execFile('gh', ['auth', 'token'], { encoding: 'utf8', timeout: 5000 }, (error, out) => done(error ? undefined : out.trim() || undefined)));
}

const TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };

/**
 * A picture of a file in a repo ("github.com/owner/name/blob/main/a.png?raw=true", "/raw/", or raw.githubusercontent.com)
 * is read through the API, which takes the login of gh; GitHub's web pages do not.
 */
export function apiAddress(url: string): string | undefined {
  const web = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/(?:blob|raw)\/([^/]+)\/([^?#]+)/.exec(url);
  const raw = /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/([^?#]+)/.exec(url);
  const match = web ?? raw;
  return match ? `https://api.github.com/repos/${match[1]}/${match[2]}/contents/${match[4]}?ref=${match[3]}` : undefined;
}

/** Fetches pictures with the login of gh. The login goes only to GitHub's own hosts. */
export function ghPictures(): FetchPicture {
  let token: Promise<string | undefined> | undefined;
  return async (url) => {
    if (!NEEDS_LOGIN.test(url)) return undefined;
    token ??= ghToken();
    const login = await token;
    const api = apiAddress(url);
    const headers: Record<string, string> = login ? { Authorization: `token ${login}` } : {};
    if (api) headers.Accept = 'application/vnd.github.raw';
    const answer = await fetch(api ?? url, { headers, signal: AbortSignal.timeout(15_000) });
    const extension = (/\.([a-z]+)(?:[?#]|$)/i.exec(new URL(url).pathname)?.[1] ?? '').toLowerCase();
    const sent = answer.headers.get('content-type') ?? '';
    const type = sent.startsWith('image/') ? sent : TYPES[extension] ?? '';
    if (!answer.ok || !type) return undefined;
    const bytes = Buffer.from(await answer.arrayBuffer());
    return bytes.length > MOST_BYTES ? undefined : `data:${type.split(';')[0]};base64,${bytes.toString('base64')}`;
  };
}
