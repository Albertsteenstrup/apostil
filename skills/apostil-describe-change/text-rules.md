# Rules for text in a change file

These rules apply to every title, name, note and reason that you write for Apostil. The owner reads fast and reads many notes in a row. He wants to see at once what each item is. Every note has the same pattern, so that a list of notes reads in one pass.

## Rules

1. **A note title is a bare verb and what it acts on.** 2 to 6 words: "Skip split entries", "Pick the backend". Always the bare verb: "Check", never "Checks" or "Checking".
2. **Put the word that tells this note apart from the others in the first two words.** Among the notes of one file, "Skip split entries" beats "Check whether an entry is split". Avoid a title that starts like another title of the same file.
3. **A note text is one sentence of at most 20 words.** One idea. Give a second idea its own note, or leave it out. No semicolon.
4. **Start the text with a verb in the -s form.** The code is the subject, and you leave it out: "Returns None when the entry is split, so the caller skips it." Start with another subject only when the sentence is about that thing: "A file with no results counts as success."
5. **Use active voice and present tense.** Write "Skips macros with arguments", not "Macros with arguments are skipped".
6. **No -ing words**, except names in the code. Write "keeps hyphens", not "keeping hyphens"; "files that match", not "matching files".
7. **Keep "the" and "a" in a text.** Write "Reads the results file", not "Reads results file".
8. **Use one word for one thing.** If you write "hold" once, never write "reservation" or "booking" for the same thing. Use the names that the code uses.
9. **Say what the code does and why it matters.** Do not say how good it is. No praise ("clean", "robust", "nicely") and no filler ("basically", "in order to", "simply"). No "this function" or "this code".
10. **Write plain text.** No Markdown, no HTML, no code fences in any field.
11. **Do not state what you cannot see in the code lines.** Do not guess.

## Examples

| Poor | Good |
|---|---|
| It should be noted that this function is responsible for handling retries. | Retries a failed upload up to 3 times. |
| Robust error handling for the missing author case | Skip a missing author |
| Checks replay version and constraints | Rescore a changed replay |
| Updates the stuff in the table | Sets the next run time |
| Crops only when the caption sits high; otherwise the full page is kept. | Crops only when the caption sits in the upper 60 percent of the page. |
| Macros with arguments are skipped. | Skips macros with arguments. |
| Keeping the order of the matching rows. | Keeps the order of the rows that match. |

## Field sizes

- `title` of the change: one line, what the change does.
- `reason`: one or two sentences, why it was made. Take it from the brief.
- part `name`: 1 to 3 words. Part `note`: one line.
- note `title`: 2 to 6 words, a bare verb first. Note `text`: one sentence of at most 20 words. For a change it is optional: add it only when the title does not say enough.

`apostil add-notes` refuses a note of a file whose title starts with an -s form or has more than 6 words, and a text with more than one sentence, a semicolon or more than 20 words. It also prints `style`: words that may be passive or -ing words. Change those when you can.

## How to run commands

- Run each command as its own Bash call: one command alone, with no `;`, `&&`, `||`, `|`, loop, `$( )`, `$?` or redirect. The run refuses such a command.
- Read a file with Read, and search with Grep or Glob. Write or change a draft with Write or Edit, never with a script.
- `apostil notes` takes several paths at once: `apostil notes a.py b.py`.
- When a command is refused, do the same work again with plain commands and these tools. Never stop before your part is saved.
- Report a refusal only when a plain `apostil` command alone is refused.
