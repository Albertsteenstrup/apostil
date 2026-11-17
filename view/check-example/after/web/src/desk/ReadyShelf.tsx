// The ready shelf on the desk screen: each copy that waits for its member, with the last pickup day, the nearest first.

import { useCallback, useEffect, useState } from 'react';

interface ShelfItem {
  hold_id: number;
  copy_id: number;
  member: string;
  has_mail: boolean;
  title: string;
  author: string;
  ready_on: string;
  pickup_by: string;
  days_left: number;
}

interface Shelf {
  branch: string;
  items: ShelfItem[];
  last_day_today: number;
  without_mail: string[];
}

interface Props {
  branchId: string;
  /** How often the shelf loads again, in seconds; the night run fills it, the desk empties it during the day. */
  every?: number;
}

/** "today", "tomorrow" or "in 3 days", for the column of the last day. */
export function daysLeftWords(days: number): string {
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

async function loadShelf(branchId: string): Promise<Shelf> {
  const response = await fetch(`/api/desk/${branchId}/ready-shelf`, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`The ready shelf could not be loaded: ${response.status}`);
  return response.json() as Promise<Shelf>;
}

async function giveToNext(branchId: string, holdId: number): Promise<void> {
  const response = await fetch(`/api/desk/${branchId}/ready-shelf/${holdId}/next`, { method: 'POST', credentials: 'same-origin' });
  if (!response.ok) throw new Error(`The copy could not go to the next member: ${response.status}`);
}

export function ReadyShelf({ branchId, every = 120 }: Props) {
  const [shelf, setShelf] = useState<Shelf | null>(null);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState<number | null>(null);

  const reload = useCallback(() => {
    loadShelf(branchId).then(
      (loaded) => {
        setShelf(loaded);
        setProblem('');
      },
      (error: Error) => setProblem(error.message),
    );
  }, [branchId]);

  useEffect(() => {
    reload();
    const timer = window.setInterval(reload, every * 1000);
    return () => window.clearInterval(timer);
  }, [reload, every]);

  async function next(item: ShelfItem) {
    if (!window.confirm(`Give ${item.title} to the next member? ${item.member} goes to the end of the line.`)) return;
    setBusy(item.hold_id);
    try {
      await giveToNext(branchId, item.hold_id);
      reload();
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="ready-shelf" aria-label="The ready shelf">
      <h2>
        Ready shelf <span className="quiet">· {shelf?.items.length ?? '…'}</span>
      </h2>
      {problem && <p className="problem small">{problem}</p>}
      {shelf && shelf.items.length === 0 && <p className="quiet">No copy waits for a member.</p>}
      {shelf && shelf.last_day_today > 0 && (
        <p className="small">
          {shelf.last_day_today === 1 ? 'One copy has' : `${shelf.last_day_today} copies have`} the last day today.
        </p>
      )}
      {shelf && shelf.items.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Book</th>
              <th>Member</th>
              <th>Last day</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {shelf.items.map((item) => (
              <tr key={item.hold_id} className={item.days_left <= 0 ? 'last-day' : ''}>
                <td>
                  <b>{item.title}</b> <span className="quiet">{item.author}</span>
                </td>
                <td>
                  {item.member}
                  {!item.has_mail && <span className="no-mail"> · no mail: call</span>}
                </td>
                <td>{daysLeftWords(item.days_left)}</td>
                <td>
                  <button type="button" className="next" disabled={busy === item.hold_id} onClick={() => next(item)}>
                    Next member
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
