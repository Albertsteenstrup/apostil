# Write the processes of a group of files

You write the processes that start in some files of one repo. A process is one job of the code, from its start to its result: for example "split the responses of one results file". Its steps are the notes that the map holds for the code. The owner opens a process in Apostil Home and follows it step by step, also into other files. Be faithful to the code. Draw only what you saw in the code. A tool checks each arrow against the code, and you repair what it lists.

You get the path of the repo folder and your group: its `name`, and its `files`, each with its count of notes. You also have the text rules (`text-rules.md`). Run every command below in the top folder of the repo. Change no file of the repo and run none of its code. Write only your JSON file.

## Step 1: Read your files and their notes

For each file of your group:

- Read the whole file, with line numbers.
- Run `apostil notes <path>`. It prints the notes of the file. Each note has a `key`, the file and its first and last line: `scripts/run.py:118-131`. A note in a cell of a notebook has the cell after `#`: `analysis.ipynb#3:1-9`, with the lines counted inside the cell. `processes` names the processes that a note is a step of already.

## Step 2: Find the processes

- A process starts in one of your files: the main block of a script, a command, a route, a job, or a function that code outside the repo calls. Write one process for each job. There is no limit on the count of processes or of steps.
- Follow each call into the other files of the repo, also outside your group. Read the code that is called, run `apostil notes <path>` for its file, and take the key of the note of that code. A note of any file of the repo may be a step. A helper is a step of each process that calls it.
- A helper that only code of other groups calls starts no process of yours: the writers of those groups make it a step. Do not set it aside for that reason.
- Leave out tests: a test file needs no process.

## Step 3: Write the JSON

    {
      "group": "<name of your group>",
      "processes": [
        {
          "id": "split-responses",
          "title": "Split responses into steps",
          "summary": "Reads one results file, splits each response into steps and saves the file again.",
          "steps": ["scripts/split.py:228-330", "scripts/split.py:240-262", "scripts/split.py:264-280", "scripts/split.py:92-225", "utils/text.py:10-40"],
          "arrows": [
            { "from": "scripts/split.py:240-262", "to": "scripts/split.py:92-225", "label": "split each file", "fromLine": 251, "toLine": 92, "name": "split_file" },
            { "from": "scripts/split.py:92-225", "to": "utils/text.py:10-40", "label": "split the text", "fromLine": 163, "toLine": 10, "name": "split_reasoning" },
            { "kind": "branch", "from": "scripts/split.py:264-280", "to": "scripts/split.py:240-262", "label": "next file", "fromLine": 238 }
          ],
          "outside": [ { "from": "scripts/split.py:92-225", "to": "pandas", "label": "read the table", "fromLine": 96, "name": "read_json" } ]
        }
      ],
      "handoffs": [
        { "from": "generate-responses", "to": "split-responses", "label": "results file", "name": "results_", "fromLine": { "file": "scripts/generate.py", "line": 400 }, "toLine": { "file": "scripts/split.py", "line": 110 } }
      ],
      "notInProcess": [ { "note": "scripts/split.py:27-29", "why": "Sets the import path for the imports below." } ]
    }

The lines and names in this example are made up. Use the real ones.

1. **Steps.** The keys of notes, in the order the code runs them. The first step is where the process starts. List a note that covers a whole function and the notes inside it: the tool puts each inner note in its outer note by their lines, and joins the inner notes in the order that you list them.
2. **Arrows.** Write an arrow wherever the code goes from one function or file to another: a call, the start of a script, an import of a value, a file that one step writes and another step reads. Two whole functions in one file need an arrow too. `fromLine` is a line inside the `from` step, where the code calls, starts or writes. `toLine` is a line inside the `to` step, where the target is defined or reads. `name` is a word that stands on both lines: the function name, the script name, a key, or a part of a file name. `label` has at most 4 words.
3. **Branches.** Inside one function the steps follow the order of the list. Where the code jumps (an error, the next row of a loop, an early return), add `{ "kind": "branch", "from", "to", "label", "fromLine" }` between two steps inside the same outer step. `fromLine` is the line of the condition or the loop. A branch has no `name`. The label says when the jump happens: "on error", "next row", "if empty".
4. **Calls out of the repo.** A call of a library or a program is `outside`: `to` is its name, and the line `fromLine` of the step holds `name`. A call into a file of this repo is never `outside`: make the code that it calls a step, with an arrow.
5. **Handoffs** join two processes: a file or a value that one process makes and another reads. Each end is `{ "file", "line" }` inside a step of its process (add `"cell"` in a notebook), and `name` stands on both lines. The other process may belong to another group: `apostil notes <path>` names it in `processes`. When it is not in the map yet, leave the handoff out: its writer adds it.
6. **Every note of your files** is a step of at least one process, yours or another group's, or it is in `notInProcess` with a `why` of at most 12 words. Use `notInProcess` only for code that takes part in no job, for example a path set-up or a constant that nothing reads. Never draw an arrow that is not in the code to make a note fit.
7. **Words.** A title is a bare verb and what it acts on, at most 6 words. A summary is one sentence of at most 20 words. Follow `text-rules.md`.

## Correct the notes

For each arrow, read both of its lines. The processes must be faithful to the code, and so must the notes.

- A note that the code shows is wrong, or that says too little to be a step: send new words in the same JSON, with `"noteFixes": [ { "note": "<key>", "title": "...", "text": "..." } ]`. Give `title`, `text` or both. They follow the rules of notes in `text-rules.md`.
- Code that takes part in a process and has no note: add a note with `"newNotes": [ { "file": "...", "lines": [first, last], "title": "...", "text": "..." } ]`, and use its key `<file>:<first>-<last>` as a step.
- A note whose lines are wrong: add a new note with the right lines in `newNotes`, and send `{ "note": "<old key>", "remove": true, "by": "<new key>" }` in `noteFixes`. The tool puts the new key in place of the old key in every process.

## Step 4: Save

Write the JSON to the file `apostil-processes-<name of your group>.json` in the top folder of the repo. Write it nowhere else, and do not put the JSON into the command itself: some apps refuse both. Then run:

    apostil add-processes apostil-processes-<name of your group>.json

It prints `{ "saved", "problems", "processes", "steps", "notes", "left", "style" }`. It replaces the processes, handoffs and set-aside notes that your group saved before, and keeps those of all other groups. Other writers save at the same time, and their work stays.

- When `problems` is not empty, nothing is saved. Each problem is one sentence that says what to change. Change it, write the file again and run the command again. A process "in pieces" has steps that no order and no arrow joins: find the call or the file in the code that joins them, or split the process.
- `notes` says what the save changed in the notes.
- `left` lists notes of your files that are in no process and not in `notInProcess`. Put each one into a process, with its arrows, or into `notInProcess`, and save again. Leave a note only when the code that calls it starts in another group: its writer makes it a step.
- `style` lists words of your notes that may be passive or -ing words. Change them if you can, and save once more.
- Stop when `saved` is `true` and each note that is `left` is called from another group, or after three rounds. Do not hide a problem that remains.

When it is saved, the command removes the file.

## Your report

At most ten lines: the name of your group, the count of processes and of steps, each note that you corrected, added or removed and why, each note that is left and why, and what was hard.
