// The queue at the desk: the members who wait at the desk now, with the ready hold of each one when there is one.

import { useEffect, useState } from 'react';

interface Props {
  branchId: string;
}

interface Waiting {
  number: number;
  name: string;
  since: string;
  /** The title of a book that waits on the ready shelf for this member, so the desk can bring it at once. */
  ready_title?: string | null;
}

export function QueuePanel({ branchId }: Props) {
  const [waiting, setWaiting] = useState<Waiting[]>([]);
  const [lost, setLost] = useState(false);

  useEffect(() => {
    const source = new EventSource(`/api/desk/${branchId}/queue`);
    source.onmessage = (event) => {
      setLost(false);
      setWaiting(JSON.parse(event.data) as Waiting[]);
    };
    source.onerror = () => setLost(true);
    return () => source.close();
  }, [branchId]);

  return (
    <section className="desk-queue" aria-label="The queue at the desk">
      <h2>
        At the desk now <span className="quiet">· {waiting.length}</span>
      </h2>
      {lost && <p className="problem small">The queue is not live now. It comes back by itself.</p>}
      {waiting.length === 0 && <p className="quiet">Nobody waits at the desk.</p>}
      <ol>
        {waiting.map((one) => (
          <li key={one.number}>
            <b>{one.number}</b> {one.name} <span className="quiet">since {one.since}</span>
            {one.ready_title && <span className="ready-for"> · {one.ready_title} waits on the ready shelf</span>}
          </li>
        ))}
      </ol>
    </section>
  );
}
