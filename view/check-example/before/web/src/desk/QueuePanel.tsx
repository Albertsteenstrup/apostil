// The queue at the desk: the members who wait at the desk now, and the reservations whose book should be put aside.

import { useEffect, useState } from 'react';
import { loadReservationsToPutAside, type Reservation } from './deskApi';

interface Props {
  branchId: string;
}

interface Waiting {
  number: number;
  name: string;
  since: string;
}

export function QueuePanel({ branchId }: Props) {
  const [waiting, setWaiting] = useState<Waiting[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);

  useEffect(() => {
    const source = new EventSource(`/api/desk/${branchId}/queue`);
    source.onmessage = (event) => setWaiting(JSON.parse(event.data) as Waiting[]);
    return () => source.close();
  }, [branchId]);

  useEffect(() => {
    loadReservationsToPutAside(branchId).then(setReservations, () => setReservations([]));
  }, [branchId]);

  return (
    <section className="desk-queue" aria-label="The queue at the desk">
      <h2>
        At the desk now <span className="quiet">· {waiting.length}</span>
      </h2>
      {waiting.length === 0 && <p className="quiet">Nobody waits at the desk.</p>}
      <ol>
        {waiting.map((one) => (
          <li key={one.number}>
            <b>{one.number}</b> {one.name} <span className="quiet">since {one.since}</span>
          </li>
        ))}
      </ol>

      <h2>
        Put aside for a member <span className="quiet">· {reservations.length}</span>
      </h2>
      {reservations.length === 0 && <p className="quiet">No reserved book came back.</p>}
      <ul className="put-aside">
        {reservations.map((reservation) => (
          <li key={reservation.id}>
            <b>{reservation.title}</b> for {reservation.member_name}
            {reservation.told_on && <span className="quiet"> · told on {reservation.told_on}</span>}
          </li>
        ))}
      </ul>
      <p className="quiet small">Write the name of the member on a slip, and put the book on the shelf behind the desk.</p>
    </section>
  );
}
