// The member page: the tabs of one member, and the card number and branch at the top.

import { useState } from 'react';
import { HoldsPanel } from './HoldsPanel';
import { LoansPanel } from './LoansPanel';
import { TABS, type MemberTab, tabLabel } from './memberModel';

interface Props {
  member: { name: string; cardNumber: string; homeBranch: string };
  start?: MemberTab;
}

export function MemberPage({ member, start = 'loans' }: Props) {
  const [tab, setTab] = useState<MemberTab>(start);
  const [holdCount, setHoldCount] = useState<number | null>(null);

  return (
    <main className="member-page">
      <header className="member-head">
        <h1>{member.name}</h1>
        <p className="quiet">
          Card {member.cardNumber} · {member.homeBranch}
        </p>
      </header>

      <nav className="member-tabs" role="tablist">
        {TABS.map((one) => (
          <button key={one} type="button" role="tab" aria-selected={tab === one} className={tab === one ? 'on' : ''} onClick={() => setTab(one)}>
            {tabLabel(one, one === 'holds' ? holdCount : null)}
          </button>
        ))}
      </nav>

      <div className="member-body" role="tabpanel">
        {tab === 'loans' && <LoansPanel />}
        {tab === 'history' && <p className="quiet">Your history of the last two years.</p>}
        {tab === 'lists' && <p className="quiet">Your reading lists.</p>}
        {tab === 'holds' && <HoldsPanel homeBranch={member.homeBranch} onCount={setHoldCount} />}
      </div>
    </main>
  );
}
