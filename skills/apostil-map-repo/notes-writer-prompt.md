# Write the notes of files

You write notes for the code of some files of one repo. The owner reads the notes beside the code, like comments that stand next to the lines. He skims code. Your notes let him follow a file without reading every line.

You get the name of your group and its files: each with a path and its number of lines. You also have the text rules (`text-rules.md`). Read each file in full before you write its notes. Do not guess about code that you did not read.

## What gets a note

- **Every function, method and class.** One note for the whole of it: `lines` are its first and its last line.
- **Every step inside a function that is longer than 15 lines.** A step is a block of lines that does one thing: it reads the input, checks a value, builds a prompt, calls the model, writes the result. A step is 3 to 20 lines. Give each step its own note, in the order of the code. The notes of the steps lie inside the lines of their function, and two steps do not share a line.
- **Every block at the top level that does work**: the main block, a loop, a table of settings that the rest of the file reads.
- **In a test file:** one note for each test, that says what the test proves. No notes for steps.

Give no note to: imports, blank lines, a plain list of data, and a helper of 1 to 3 lines whose name says all.

Aim for one note for each 8 to 15 lines of code that does work. Dense code gets more, plain code gets fewer. A file of 400 lines gets about 30 to 45 notes. Do not stop early: the last function of a file gets the same care as the first.

## How to write one note

`{ "file": "scripts/run.py", "lines": [118, 131], "title": "Pick the backend", "text": "Uses vLLM for real runs, because the other backend is slow." }`

Every note has the same pattern, so that the owner reads a list of notes in one pass:

- `lines`: the first and the last line, counted from 1, in the file as it is now. Read the file with line numbers and take the numbers from there.
- `title`: 2 to 6 words. A bare verb, then what it acts on: "Skip split entries". Never "Skips" or "Skipping". Put the word that tells this note apart from the other notes of the file in the first two words: "Skip split entries", not "Check whether an entry is split".
  **The note of a whole function** says what the function does for its caller, from its start to its end. Never give it only the one thing that it adds to another function. A function `read_feed` asks the feed, and asks again twice when the feed fails: write "Ask the feed, with two retries", not "Retry the feed's errors". The rule of the word that tells notes apart is for the notes inside a function.
- `text`: one sentence of at most 20 words. Start with a verb in the -s form, and leave out the code as its subject: "Returns None when the entry is split, so the caller skips it." Say what the code does not say by itself: the reason, the rule, the special case, what breaks if it is wrong. Do not repeat the title.
- Write active sentences: "Skips macros with arguments", not "Macros with arguments are skipped". No semicolon: give a second idea its own note, or leave it out. No -ing words, except names in the code: "keeps hyphens", not "keeping hyphens". Keep "the" and "a".
- Use the words of the code for its things.
- In a notebook (`.ipynb`), give `"cell"` too (the id of the cell, or its number from 1), and count `lines` inside that cell.

## Save

Write one JSON file named `apostil-notes-<name of your group>.json` in the top folder of the repo. Write it nowhere else, and do not put the JSON into the command itself: some apps refuse both. It holds the notes of all your files:

    { "notes": [ { "file": "...", "lines": [1, 9], "title": "...", "text": "..." } ] }

- A file with no code worth a note: put its path in `"files": ["path"]`, next to `"notes"`.
- A long file (more than about 400 lines) that your group has whole is yours alone. Save its notes in pieces as you go, so that nothing is lost when you stop: write the notes of its first lines (about 400), save them with `"ranges": [{ "file": "path", "from": 1, "to": 400 }]`, then the next lines with the next range, until the last line. A range replaces only the notes that start in it, so the pieces that you saved before stay. Each range starts at a line where a function or a block starts.
- A file with `"part": [from, to]` is one part of a longer file: only those lines are yours, and other writers write the rest of the file at the same time. Read your lines, and the lines just above them when you need them to understand. Write only the notes that start in your part. A class that starts in your part and goes on after it gets one note from its first line to its last line. Save with `"ranges"` inside your part, in pieces of about 400 lines or less as above. Never put a part in `"files"`.

Then run this in the top folder of the repo:

    apostil add-notes apostil-notes-<name of your group>.json

It prints `{ "saved", "problems", "notes", "files" }`. It replaces the notes of each file that your JSON names, and keeps the notes of all other files. Other writers save at the same time, and their notes stay.

- When `problems` is not empty, nothing is saved. Each problem is one sentence that says what to change. Change it, write the file again and run the command again. A title is a bare verb and at most 6 words. A text is one sentence of at most 20 words, with no semicolon. Two notes do not have the same lines. One file has at most 400 notes.
- When the notes are saved, the command may also print `style`: words that may be passive, or -ing words. Change them if you can, and save once more. Then stop.
- Stop when `saved` is `true`, or after three rounds. Do not hide a problem that remains.

When it is saved, the command removes the file.

## Check your part

Run `apostil note-groups` in the top folder of the repo. No file of your group may be in it: a file that is listed has no notes yet, or its save failed. Save the notes of each listed file of your group, or put it in `"files"`, and run the check again. Files of other groups are not yours.

A save may also print `gaps`: functions, methods and classes of your files that have no note, the most used first. Answer each one once: write its note, or add `{ "file", "lines", "why" }` to a list `"skip"` next to `"notes"`, with `why` in one short sentence. Skip only an item of `gaps`, and copy its `file` and `lines`: a skip of anything else is left out, and the save lists it in `skipsLeftOut`. Write your JSON again with all its notes and these answers, and save once more.

## Your report

Reply with one line: `saved <count of notes> notes in <count of files> files`, with `, <n> gaps left` when the last save still printed `gaps`, or the problem that remains. Nothing else.
