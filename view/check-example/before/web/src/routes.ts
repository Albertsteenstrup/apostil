// The addresses of the web pages, and the page that each one shows.

export type Page = { name: 'member'; tab: string } | { name: 'desk'; branch: string } | { name: 'not-found' };

/** The page of an address: /member#loans, /desk/north. */
export function pageOf(path: string, hash = ''): Page {
  const parts = path.split('/').filter(Boolean);
  if (parts[0] === 'member') return { name: 'member', tab: hash.replace(/^#/, '') || 'loans' };
  if (parts[0] === 'desk' && parts[1]) return { name: 'desk', branch: parts[1] };
  return { name: 'not-found' };
}

/** The address of a tab of the member page, for a link in a mail. */
export function memberTabPath(tab: 'loans' | 'history' | 'lists' | 'reservations'): string {
  return `/member#${tab}`;
}

/** The address of the desk screen of a branch. */
export function deskPath(branch: string): string {
  return `/desk/${branch}`;
}
