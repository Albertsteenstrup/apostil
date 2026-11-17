// The tabs of the member page and their labels.

export const TABS = ['loans', 'history', 'lists', 'reservations'] as const;

export type MemberTab = (typeof TABS)[number];

const LABELS: Record<MemberTab, string> = {
  loans: 'Loans',
  history: 'History',
  lists: 'Reading lists',
  reservations: 'Reservations',
};

/** The label of a tab, with a count after it when there is one: "Loans · 3". */
export function tabLabel(tab: MemberTab, count: number | null = null): string {
  return count ? `${LABELS[tab]} · ${count}` : LABELS[tab];
}

/** The tab that an address opens: "#holds" opens the holds, anything else the loans. */
export function tabOfHash(hash: string): MemberTab {
  const name = hash.replace(/^#/, '');
  return (TABS as readonly string[]).includes(name) ? (name as MemberTab) : 'loans';
}
