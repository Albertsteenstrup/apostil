// The calls of the Holds tab to the server. Each call returns the data or a Problem with the sentence of the server.

import type { Hold, HoldState } from '../api/generated/model';

export type { Hold, HoldState };

/** A refusal of the server: one sentence for the member, and the field it is about. */
export interface Problem {
  message: string;
  field?: string;
}

export type Answer<T> = { ok: true; data: T } | { ok: false; problem: Problem };

const HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json' };

/** One call: the data on success, else the problem of the server, or a sentence when the network failed. */
async function call<T>(path: string, init: RequestInit = {}): Promise<Answer<T>> {
  let response: Response;
  try {
    response = await fetch(path, { credentials: 'same-origin', ...init, headers: { ...HEADERS, ...init.headers } });
  } catch {
    return { ok: false, problem: { message: 'The library cannot be reached. Check the network and try again.' } };
  }
  const body = await response.json().catch(() => ({}));
  if (response.ok) return { ok: true, data: body as T };
  return { ok: false, problem: { message: body.message ?? `The server answered ${response.status}.`, field: body.field } };
}

/** The holds of the member who is signed in, the oldest first. */
export function loadMyHolds(): Promise<Answer<Hold[]>> {
  return call<Hold[]>('/api/holds/mine');
}

export interface NewHold {
  bookId: number;
  branchId: string;
  note?: string;
}

/** Puts the member at the end of the line for a book. */
export function placeHold(hold: NewHold): Promise<Answer<Hold>> {
  return call<Hold>('/api/holds/', { method: 'POST', body: JSON.stringify({ book_id: hold.bookId, branch_id: hold.branchId, note: hold.note ?? '' }) });
}

/** Keeps the place in the line until the given day; the next copy goes to the member after. */
export function pauseHold(id: number, until: string): Promise<Answer<Hold>> {
  return call<Hold>(`/api/holds/${id}/pause`, { method: 'POST', body: JSON.stringify({ until }) });
}

export function resumeHold(id: number): Promise<Answer<Hold>> {
  return call<Hold>(`/api/holds/${id}/resume`, { method: 'POST' });
}

export function cancelHold(id: number): Promise<Answer<Hold>> {
  return call<Hold>(`/api/holds/${id}`, { method: 'DELETE' });
}

/** The branches where a member can pick up a book, for the choice in the dialog. */
export const BRANCHES: { id: string; name: string }[] = [
  { id: 'north', name: 'North' },
  { id: 'harbour', name: 'Harbour' },
  { id: 'old-town', name: 'Old Town' },
  { id: 'station', name: 'Station' },
];

export function branchName(id: string): string {
  return BRANCHES.find((branch) => branch.id === id)?.name ?? id;
}

/** The words of a state, as the tab shows them. */
export function stateWords(hold: Hold): string {
  switch (hold.state) {
    case 'waiting':
      return hold.place === 1 ? 'You are next' : `Number ${hold.place} in the line`;
    case 'paused':
      return hold.paused_until ? `Paused until ${shortDate(hold.paused_until)}` : 'Paused';
    case 'ready':
      return hold.pickup_by ? `Ready at ${branchName(hold.branch_id)} until ${shortDate(hold.pickup_by)}` : 'Ready';
    case 'collected':
      return 'Picked up';
    case 'cancelled':
      return 'Cancelled';
    default:
      return hold.state;
  }
}

/** A day as "Tue 3 Mar", in the language of the browser. */
export function shortDate(iso: string): string {
  const day = new Date(`${iso}T12:00:00`);
  return day.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

/** The days from today until a day, for "2 days left"; a day in the past gives 0. */
export function daysUntil(iso: string, today = new Date()): number {
  const day = new Date(`${iso}T12:00:00`);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12);
  return Math.max(0, Math.round((day.getTime() - start.getTime()) / 86_400_000));
}
