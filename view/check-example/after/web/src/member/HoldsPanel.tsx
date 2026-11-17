// The tab "Holds" of the member page: each hold with its place in the line, and what the member can do with it.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { HoldDialog } from './HoldDialog';
import {
  branchName, cancelHold, daysUntil, loadMyHolds, pauseHold, resumeHold, shortDate, stateWords,
  type Answer, type Hold, type Problem,
} from './holdsApi';

interface Props {
  homeBranch: string;
  /** The number of holds changes the label of the tab: "Holds · 3". */
  onCount?: (count: number) => void;
}

type Load = { state: 'loading' } | { state: 'failed'; problem: Problem } | { state: 'ready'; holds: Hold[] };

/** The order of the tab: ready holds first (the member should come), then waiting, then paused. */
const ORDER: Record<string, number> = { ready: 0, waiting: 1, paused: 2 };

export function sortHolds(holds: Hold[]): Hold[] {
  return [...holds].sort((a, b) => (ORDER[a.state] ?? 3) - (ORDER[b.state] ?? 3) || a.place - b.place || a.id - b.id);
}

/** The day that a pause ends by default: two weeks from today. */
function twoWeeksFromToday(today = new Date()): string {
  const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 14, 12);
  return day.toISOString().slice(0, 10);
}

export function HoldsPanel({ homeBranch, onCount }: Props) {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [busy, setBusy] = useState<number | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [dialog, setDialog] = useState(false);
  const [pausing, setPausing] = useState<{ id: number; until: string } | null>(null);

  const reload = useCallback(async () => {
    const answer = await loadMyHolds();
    setLoad(answer.ok ? { state: 'ready', holds: answer.data } : { state: 'failed', problem: answer.problem });
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const holds = useMemo(() => (load.state === 'ready' ? sortHolds(load.holds) : []), [load]);

  useEffect(() => {
    if (load.state === 'ready') onCount?.(load.holds.length);
  }, [load, onCount]);

  /** One change of a hold: the button waits, and the list shows the hold as the server sends it back. */
  async function change(id: number, act: () => Promise<Answer<Hold>>) {
    setBusy(id);
    setProblem(null);
    const answer = await act();
    setBusy(null);
    if (!answer.ok) {
      setProblem(answer.problem);
      return;
    }
    setLoad((before) => {
      if (before.state !== 'ready') return before;
      const others = before.holds.filter((hold) => hold.id !== id);
      const kept = answer.data.state === 'cancelled' ? others : [...others, answer.data];
      return { state: 'ready', holds: kept };
    });
  }

  if (load.state === 'loading') return <p className="quiet holds-loading">Loading your holds…</p>;
  if (load.state === 'failed') {
    return (
      <div className="holds-problem" role="alert">
        <p>{load.problem.message}</p>
        <button type="button" onClick={() => { setLoad({ state: 'loading' }); void reload(); }}>
          Try again
        </button>
      </div>
    );
  }

  return (
    <section className="holds-panel" aria-label="Holds">
      <div className="holds-head">
        <p className="quiet">
          {holds.length === 0 ? 'You wait for no book.' : `You wait for ${holds.length} ${holds.length === 1 ? 'book' : 'books'}.`} A ready book waits for you for seven open days.
        </p>
        <button type="button" className="primary" onClick={() => setDialog(true)}>
          Hold a book
        </button>
      </div>

      {problem && <p className="problem" role="alert">{problem.message}</p>}

      <ul className="holds-list">
        {holds.map((hold) => (
          <li key={hold.id} className={`hold hold-${hold.state}`}>
            <div className="hold-book">
              <b>{hold.title}</b>
              <span className="quiet"> by {hold.author}</span>
            </div>
            <div className="hold-state">
              <span className={`badge badge-${hold.state}`}>{stateWords(hold)}</span>
              {hold.state === 'ready' && hold.pickup_by && (
                <span className="quiet">
                  {' '}· {daysUntil(hold.pickup_by) === 0 ? 'last day today' : `${daysUntil(hold.pickup_by)} days left`}
                </span>
              )}
              {hold.state === 'waiting' && <span className="quiet"> · pick it up at {branchName(hold.branch_id)}</span>}
            </div>

            {pausing?.id === hold.id ? (
              <div className="hold-pause">
                <label>
                  Pause until{' '}
                  <input type="date" value={pausing.until} onChange={(event) => setPausing({ id: hold.id, until: event.target.value })} />
                </label>
                <button type="button" className="primary" disabled={busy === hold.id} onClick={() => { void change(hold.id, () => pauseHold(hold.id, pausing.until)); setPausing(null); }}>
                  Pause
                </button>
                <button type="button" onClick={() => setPausing(null)}>
                  Keep waiting
                </button>
              </div>
            ) : (
              <div className="hold-actions">
                {hold.state === 'waiting' && (
                  <button type="button" disabled={busy === hold.id} onClick={() => setPausing({ id: hold.id, until: twoWeeksFromToday() })}>
                    Pause
                  </button>
                )}
                {hold.state === 'paused' && (
                  <button type="button" disabled={busy === hold.id} onClick={() => change(hold.id, () => resumeHold(hold.id))}>
                    Wait again
                  </button>
                )}
                {hold.state !== 'collected' && (
                  <button type="button" className="quiet-button" disabled={busy === hold.id} onClick={() => change(hold.id, () => cancelHold(hold.id))}>
                    Cancel
                  </button>
                )}
              </div>
            )}
            {hold.state === 'paused' && hold.paused_until && <p className="quiet hold-note">The next copy goes to the member after you until {shortDate(hold.paused_until)}.</p>}
          </li>
        ))}
      </ul>

      <HoldDialog
        open={dialog}
        homeBranch={homeBranch}
        onClose={() => setDialog(false)}
        onPlaced={(hold) => setLoad((before) => (before.state === 'ready' ? { state: 'ready', holds: [...before.holds, hold] } : before))}
      />
    </section>
  );
}
