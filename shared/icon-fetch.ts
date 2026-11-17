// `apostil icon`: downloads the picture of a service and checks it. It reaches only the service's own site; the fetch is given, so a test needs no network.

import { fileProblem, iconEndingOf, siteOf } from './marks';

export type Fetcher = (address: string, init: { redirect: 'manual'; signal: AbortSignal }) => Promise<Response>;

const SECONDS = 10;
const MOST_BYTES = 100 * 1024;
const MOST_PAGE = 500 * 1024;
const MOST_REDIRECTS = 4;
const MOST_TRIES = 5;

export interface IconPicture {
  bytes: Buffer;
  ending: string;
  address: string;
}

/** The host part of a site as a service keeps it ("feed.example.org/docs" is feed.example.org). */
const hostOfSite = (site: string): string => siteOf(site).split(/[/:?#]/)[0];

/** Is a host the site, or a host under it? */
export const hostFits = (host: string, site: string): boolean => {
  const base = hostOfSite(site);
  const bare = host.toLowerCase().replace(/^www\./, '');
  return bare === base || bare.endsWith(`.${base}`);
};

/** The links of a web page that name an icon, best first: a scalable one, then the largest. */
export function iconLinks(html: string, page: string): string[] {
  const found: { address: string; score: number }[] = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const attribute = (name: string): string => new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag)?.slice(1).find((one) => one !== undefined) ?? '';
    const rel = attribute('rel').toLowerCase().split(/\s+/);
    if (!rel.includes('icon') && !rel.includes('apple-touch-icon')) continue;
    let address: string;
    try {
      address = new URL(attribute('href'), page).href;
    } catch {
      continue;
    }
    const size = /(\d+)x\d+/.exec(attribute('sizes'));
    const score = /\.svg(\?|$)/i.test(address) || attribute('sizes') === 'any' ? 10000 : size ? Number(size[1]) : rel.includes('apple-touch-icon') ? 180 : 16;
    found.push({ address, score });
  }
  return found.sort((a, b) => b.score - a.score).map((one) => one.address);
}

/** Reads a body of at most `most` bytes; undefined when it is longer. */
async function readBody(response: Response, most: number): Promise<Buffer | undefined> {
  const chunks: Buffer[] = [];
  let size = 0;
  if (!response.body) return Buffer.alloc(0);
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    size += chunk.length;
    if (size > most) return undefined;
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/** What one address gives: the bytes, or a sentence. It follows a redirect only to a host that fits. */
async function get(address: string, fits: (host: string) => boolean, fetcher: Fetcher, signal: AbortSignal): Promise<{ bytes?: Buffer; type?: string; problem?: string; tooLong?: true }> {
  let at = address;
  for (let step = 0; step <= MOST_REDIRECTS; step++) {
    let url: URL;
    try {
      url = new URL(at);
    } catch {
      return { problem: `${at} is no web address.` };
    }
    if (url.protocol !== 'https:') return { problem: `${at} is not an https address. Only https is used.` };
    if (!fits(url.hostname)) return { problem: `${url.hostname} is not the site of this service. Use an address on its own site.` };
    const response = await fetcher(at, { redirect: 'manual', signal });
    if (response.status >= 300 && response.status < 400) {
      const next = response.headers.get('location');
      if (!next) return { problem: `${at} sent a redirect with no address.` };
      at = new URL(next, at).href;
      continue;
    }
    if (!response.ok) return { problem: `${at} answered ${response.status}.` };
    const bytes = await readBody(response, MOST_PAGE);
    if (!bytes) return { problem: `${at} is too large.`, tooLong: true };
    return { bytes, type: response.headers.get('content-type') ?? '' };
  }
  return { problem: `${address} redirects too often.` };
}

/**
 * The icon at an address of the service's own site: a picture, or a web page that names pictures with link rel="icon" and rel="apple-touch-icon".
 * Without `otherSite` the host must be `site` or a host under it, also after a redirect.
 */
export async function fetchIcon(address: string, site: string, otherSite: boolean, fetcher: Fetcher = fetch as Fetcher): Promise<{ icon?: IconPicture; problem?: string }> {
  const signal = AbortSignal.timeout(SECONDS * 1000);
  const fits = (host: string): boolean => otherSite || hostFits(host, site);
  try {
    const first = await get(address, fits, fetcher, signal);
    if (first.problem || !first.bytes) return { problem: first.problem };
    const kind = /html/i.test(first.type ?? '') ? undefined : iconEndingOf(first.bytes);
    const asPicture = (bytes: Buffer, at: string): { icon?: IconPicture; problem?: string } => {
      const ending = iconEndingOf(bytes);
      const bad = ending ? fileProblem(`icon.${ending}`, bytes, 'icon') : 'it is no PNG, SVG, ICO or WebP picture.';
      return bad || !ending ? { problem: `${at}: ${bad}` } : { icon: { bytes, ending, address: at } };
    };
    if (kind) return asPicture(first.bytes, address);
    if (!/html/i.test(first.type ?? '') && !/<html|<head|<link/i.test(first.bytes.subarray(0, 4096).toString('utf8'))) return { problem: `${address} is neither a picture nor a web page.` };
    const links = iconLinks(first.bytes.toString('utf8'), address).slice(0, MOST_TRIES);
    if (!links.length) return { problem: `${address} names no icon (no link rel="icon" or "apple-touch-icon").` };
    const problems: string[] = [];
    for (const link of links) {
      const one = await get(link, fits, fetcher, signal);
      if (one.bytes) {
        const picture = asPicture(one.bytes, link);
        if (picture.icon) return picture;
        problems.push(picture.problem!);
      } else problems.push(one.problem!);
    }
    return { problem: `No icon on ${address} fits. ${problems[0]}` };
  } catch (error) {
    return { problem: `${address} gave no picture: ${signal.aborted ? `it took more than ${SECONDS} seconds` : error instanceof Error ? error.message : String(error)}.` };
  }
}
