// The dialog that places a hold: the book, the branch where the member picks it up, and a note for the desk.

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { BRANCHES, placeHold, type Hold, type Problem } from './holdsApi';
import { searchBooks, type BookHit } from '../api/generated/holds';

interface Props {
  homeBranch: string;
  open: boolean;
  onPlaced: (hold: Hold) => void;
  onClose: () => void;
  /** A book to start with, when the member came from the page of a book. */
  book?: BookHit;
}

const NOTE_MAX = 200;
const SEARCH_DELAY_MS = 250;

/** The hits of a search, after a short wait, so that each key does not send a call. */
function useBookSearch(text: string): { hits: BookHit[]; searching: boolean } {
  const [hits, setHits] = useState<BookHit[]>([]);
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    const words = text.trim();
    if (words.length < 2) {
      setHits([]);
      return undefined;
    }
    setSearching(true);
    const timer = window.setTimeout(async () => {
      const found = await searchBooks({ q: words, onlyOut: true, limit: 8 });
      setHits(found.ok ? found.data : []);
      setSearching(false);
    }, SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [text]);
  return { hits, searching };
}

export function HoldDialog({ homeBranch, open, onPlaced, onClose, book }: Props) {
  const titleId = useId();
  const [query, setQuery] = useState(book?.title ?? '');
  const [chosen, setChosen] = useState<BookHit | undefined>(book);
  const [branch, setBranch] = useState(homeBranch);
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<Problem | null>(null);
  const [sending, setSending] = useState(false);
  const { hits, searching } = useBookSearch(chosen ? '' : query);
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) first.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !sending) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, sending, onClose]);

  const waitWords = useMemo(() => {
    if (!chosen) return '';
    if (chosen.waiting === 0) return 'Nobody waits for this book yet. You would be first in the line.';
    if (chosen.waiting === 1) return 'One member waits for this book. You would be number 2 in the line.';
    return `${chosen.waiting} members wait for this book. You would be number ${chosen.waiting + 1} in the line.`;
  }, [chosen]);

  if (!open) return null;

  const fieldProblem = (field: string) => (problem?.field === field ? problem.message : '');
  const tooLong = note.length > NOTE_MAX;

  async function send() {
    if (!chosen || tooLong) return;
    setSending(true);
    setProblem(null);
    const answer = await placeHold({ bookId: chosen.id, branchId: branch, note: note.trim() });
    setSending(false);
    if (answer.ok) {
      onPlaced(answer.data);
      onClose();
    } else {
      setProblem(answer.problem);
    }
  }

  return (
    <div className="hold-dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !sending && onClose()}>
      <div className="hold-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId}>Hold a book</h2>

        <label className="field">
          <span>Book</span>
          {chosen ? (
            <span className="chosen-book">
              <b>{chosen.title}</b> by {chosen.author}
              <button type="button" className="link" onClick={() => { setChosen(undefined); setQuery(''); }} disabled={sending}>
                Choose another
              </button>
            </span>
          ) : (
            <input ref={first} type="search" value={query} placeholder="Title or author" onChange={(event) => setQuery(event.target.value)} aria-describedby={`${titleId}-hint`} />
          )}
        </label>
        {!chosen && (
          <div className="book-hits" id={`${titleId}-hint`}>
            {searching && <p className="quiet">Looking for books that are out…</p>}
            {!searching && query.trim().length >= 2 && hits.length === 0 && <p className="quiet">No book that is out has these words. A book on the shelf can be borrowed at the desk.</p>}
            <ul>
              {hits.map((hit) => (
                <li key={hit.id}>
                  <button type="button" onClick={() => setChosen(hit)}>
                    <b>{hit.title}</b> <span className="quiet">by {hit.author}, {hit.waiting} waiting</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {fieldProblem('book_id') && <p className="field-problem">{fieldProblem('book_id')}</p>}

        <label className="field">
          <span>Pick it up at</span>
          <select value={branch} onChange={(event) => setBranch(event.target.value)} disabled={sending}>
            {BRANCHES.map((one) => (
              <option key={one.id} value={one.id}>
                {one.name}
                {one.id === homeBranch ? ' (your branch)' : ''}
              </option>
            ))}
          </select>
        </label>
        {fieldProblem('branch_id') && <p className="field-problem">{fieldProblem('branch_id')}</p>}

        <label className="field">
          <span>A note for the desk (optional)</span>
          <textarea value={note} rows={2} onChange={(event) => setNote(event.target.value)} disabled={sending} />
          <span className={tooLong ? 'count over' : 'count'}>
            {note.length} of {NOTE_MAX}
          </span>
        </label>

        {waitWords && <p className="wait-words">{waitWords}</p>}
        {problem && !problem.field && <p className="problem" role="alert">{problem.message}</p>}

        <div className="buttons">
          <button type="button" onClick={onClose} disabled={sending}>
            Cancel
          </button>
          <button type="button" className="primary" onClick={send} disabled={!chosen || tooLong || sending}>
            {sending ? 'Placing the hold…' : 'Place the hold'}
          </button>
        </div>
      </div>
    </div>
  );
}
