// The desk screen of a branch: the board of the morning at the left, the queue at the desk at the right.

import { useEffect, useState } from 'react';
import { KIND_WORDS, loadBoard, type DeskBoard } from './deskApi';
import { QueuePanel } from './QueuePanel';

interface Props {
  branchId: string;
  branchName: string;
}

export function DeskScreen({ branchId, branchName }: Props) {
  const [board, setBoard] = useState<DeskBoard | null>(null);
  const [failed, setFailed] = useState('');

  useEffect(() => {
    loadBoard(branchId).then(setBoard, (error: Error) => setFailed(error.message));
  }, [branchId]);

  return (
    <main className="desk-screen">
      <header className="desk-head">
        <h1>Desk of {branchName}</h1>
        {board && <p className="quiet">{board.day}</p>}
      </header>
      <div className="desk-columns">
        <section className="desk-board" aria-label="The board of the morning">
          {failed && <p className="problem">{failed}</p>}
          {!board && !failed && <p className="quiet">Loading the board…</p>}
          {board &&
            Object.entries(KIND_WORDS).map(([kind, words]) => {
              const tasks = board.tasks.filter((task) => task.kind === kind);
              if (!tasks.length) return null;
              return (
                <div key={kind} className="desk-group">
                  <h2>
                    {words} <span className="quiet">· {tasks.length}</span>
                  </h2>
                  <ul>
                    {tasks.map((task, index) => (
                      <li key={`${kind}-${index}`}>{task.title}</li>
                    ))}
                  </ul>
                </div>
              );
            })}
        </section>
        <QueuePanel branchId={branchId} />
      </div>
    </main>
  );
}
