// Which notes the editor of VS Code shows on which line, when a file has many notes and a step lies inside its function (notes-beside-code.ts).

type Lines = { lines: [number, number] };
const size = ({ lines }: Lines): number => lines[1] - lines[0];

/** The notes whose title shows, each at the end of its first line: of notes that start on one line, the narrowest. */
export function titledNotes<T extends Lines>(notes: T[]): Set<T> {
  const best = new Map<number, T>();
  for (const note of notes) {
    const other = best.get(note.lines[0]);
    if (!other || size(note) < size(other)) best.set(note.lines[0], note);
  }
  return new Set(best.values());
}

/** The notes that the pointer on a line shows, the narrowest first: the narrowest note that holds the line, and the notes whose first line it is. */
export function notesAtLine<T extends Lines>(notes: T[], line: number): T[] {
  const here = notes.filter((note) => note.lines[0] <= line && line <= note.lines[1]).sort((a, b) => size(a) - size(b));
  return here.filter((note, at) => at === 0 || note.lines[0] === line);
}
