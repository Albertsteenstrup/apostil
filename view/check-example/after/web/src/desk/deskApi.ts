// The calls of the desk screen: the board of the morning and the queue at the desk. The ready shelf has its own calls.

export interface DeskTask {
  kind: 'overdue' | 'lost' | 'call_member' | 'put_aside';
  title: string;
  member_id: number | null;
  copy_id: number | null;
  since: string | null;
}

export interface DeskBoard {
  branch_id: string;
  day: string;
  tasks: DeskTask[];
  counts: Record<string, number>;
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`The desk could not load ${path}: ${response.status}`);
  return response.json() as Promise<T>;
}

export function loadBoard(branchId: string): Promise<DeskBoard> {
  return getJson<DeskBoard>(`/api/desk/${branchId}/board`);
}

/** The words of a kind of task, for the heads of the board. */
export const KIND_WORDS: Record<DeskTask['kind'], string> = {
  overdue: 'Overdue',
  lost: 'Lost',
  call_member: 'Call the member',
  put_aside: 'Put aside',
};
