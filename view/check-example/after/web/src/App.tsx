// The app: the page of the address, with the member who is signed in.

import { useEffect, useState } from 'react';
import { DeskScreen } from './desk/DeskScreen';
import { MemberPage, tabOfHash } from './member';
import { pageOf } from './routes';
import './member/member.css';
import './desk/desk.css';

interface SignedIn {
  name: string;
  cardNumber: string;
  homeBranch: string;
}

const BRANCH_NAMES: Record<string, string> = { north: 'North', harbour: 'Harbour', 'old-town': 'Old Town', station: 'Station' };

/** The old address of the reservations goes to the holds, so that links in older mails still work. */
function movedHash(hash: string): string {
  return hash === '#reservations' ? '#holds' : hash;
}

export function App() {
  const [address, setAddress] = useState(() => ({ path: window.location.pathname, hash: movedHash(window.location.hash) }));
  const [member, setMember] = useState<SignedIn | null>(null);

  useEffect(() => {
    const onChange = () => setAddress({ path: window.location.pathname, hash: movedHash(window.location.hash) });
    window.addEventListener('popstate', onChange);
    window.addEventListener('hashchange', onChange);
    return () => {
      window.removeEventListener('popstate', onChange);
      window.removeEventListener('hashchange', onChange);
    };
  }, []);

  useEffect(() => {
    fetch('/api/member/me', { credentials: 'same-origin' })
      .then((response) => (response.ok ? response.json() : null))
      .then(setMember, () => setMember(null));
  }, []);

  const page = pageOf(address.path, address.hash);
  if (page.name === 'desk') return <DeskScreen branchId={page.branch} branchName={BRANCH_NAMES[page.branch] ?? page.branch} />;
  if (page.name === 'member') {
    if (!member) return <p className="quiet">Sign in with your card to see your page.</p>;
    return <MemberPage member={member} start={tabOfHash(address.hash)} />;
  }
  return <p className="quiet">This page does not exist.</p>;
}
