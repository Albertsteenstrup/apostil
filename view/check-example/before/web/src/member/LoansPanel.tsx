// The tab "Loans": the books that the member has at home, with their due days and "Renew".

import { useEffect, useState } from 'react';

interface Loan {
  id: number;
  title: string;
  author: string;
  due_on: string;
  renewals: number;
  may_renew: boolean;
}

export function LoansPanel() {
  const [loans, setLoans] = useState<Loan[] | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    fetch('/api/member/loans', { credentials: 'same-origin' })
      .then((response) => response.json())
      .then(setLoans)
      .catch(() => setMessage('Your loans cannot be loaded now. Try again later.'));
  }, []);

  async function renew(id: number) {
    const response = await fetch(`/api/member/loans/${id}/renew`, { method: 'POST', credentials: 'same-origin' });
    const body = await response.json();
    if (!response.ok) {
      setMessage(body.message);
      return;
    }
    setLoans((before) => before?.map((loan) => (loan.id === id ? { ...loan, renewals: loan.renewals + 1 } : loan)) ?? null);
  }

  if (message) return <p className="problem">{message}</p>;
  if (!loans) return <p className="quiet">Loading your loans…</p>;
  if (loans.length === 0) return <p className="quiet">You have no book at home.</p>;

  return (
    <ul className="loans">
      {loans.map((loan) => (
        <li key={loan.id}>
          <b>{loan.title}</b> <span className="quiet">by {loan.author}, due on {loan.due_on}</span>
          {loan.may_renew && (
            <button type="button" onClick={() => renew(loan.id)}>
              Renew
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
