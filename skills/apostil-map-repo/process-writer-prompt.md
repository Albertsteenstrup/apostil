# Write the processes of a group of files

You write the processes that start in some files of one repo. A process is one job of the code, from its start to its result: for example "split the responses of one results file". Its steps are the notes that the map holds for the code. The owner opens a process in Apostil Home and follows it step by step, also into other files. Be faithful to the code. Draw only what you saw in the code. A tool checks each arrow against the code, and you repair what it lists.

You get the path of the repo folder and your group: its `name`, and its `files`, each with its count of notes. A fold writer gets a process `into` and the processes that fold into it in place of a group, and follows "Fold processes into one" at the end. You also have the text rules (`text-rules.md`). Run every command below in the top folder of the repo. Change no file of the repo and run none of its code. Write only your JSON file.

## Step 1: Read your files and their notes

For each file of your group:

- Read the whole file, with line numbers.
- Run `apostil notes <path>`. It prints the notes of the file. Each note has a `key`, the file and its first and last line: `scripts/run.py:118-131`. A note in a cell of a notebook has the cell after `#`: `analysis.ipynb#3:1-9`, with the lines counted inside the cell. `processes` names the processes that a note is a step of already.

## Step 2: Find the processes

- A process starts in one of your files, only where nothing in this repo calls the code: the main block of a script, a command, a route, a job, a handler, or a function that only code outside the repo calls. Write one process for each job. There is no limit on the count of processes or of steps.
- A function that other code of this repo calls is never the start of a process. It is a step of the process that calls it: follow the call and list its notes there, also when the function lies in a file of another group.
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
7. **Words.** A title is a bare verb and what it acts on, at most 6 words. A summary is one sentence of at most 20 words. Follow `text-rules.md`. The title of a step that is a whole function says what that function does for its caller, from start to end ("Ask the feed, with two retries"), not only the one thing that it adds to another function ("Retry the feed's errors"). The label of an arrow names what the call hands over or asks for, so that a reader does not take the arrow for a start after another step. When a note of a whole function has a title that names only one part of it, send a better title with `noteFixes`.

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

## Check your part

Run `apostil processes --group <name of your group>`. It prints `{ "group", "processes", "notInProcess", "stale", "fold", "again" }` for your group only. `notInProcess` lists the notes of your files that are in no process and not set aside, and `stale` the processes of your group that name notes that are gone. Put each listed note into a process or into `notInProcess` of your JSON, write each stale process again, and save again. Leave a note only when the code that calls it starts in another group. `fold` lists the processes of your group that can fold into another process, or that another process can fold into. The fold writers join them later: leave them as they are.

## Your report

Reply with one line: `saved <count> processes with <count> steps, <count> notes corrected or added`, and the keys of the notes that are left for another group, or the problem that remains. Nothing else.

## Fold processes into one

A fold writer gets a process `into` and the processes that fold into it, each as `{ "process", "into", "why" }`. `why` says why it folds: "starts inside" (its first step is a later step of a process), "mostly inside" (most of its steps are steps of a bigger process) or "same job" (two writers wrote one job). You write `into` again, with the steps of the folded processes in it. The rules of Steps 3 and 4 and of the notes hold.

1. Run `apostil process <into>`, and `apostil process <id>` for each process that folds in. Each prints its `group`, `steps`, `arrows`, `outside` and `handoffs`. Read the code of their steps.
2. Write `into` again, with its id and all of its steps, arrows and calls out of the repo. Put the steps of each folded process at the step of `into` whose code calls them, in the order the code runs them, and add the arrow of that call, with its lines and its name. Keep the arrows, the branches and the calls out of the repo of the folded process. List each note once: a step that both processes have stays at its place in `into`.
3. For "same job", the two processes are one job: keep the steps of both, each once, in the order the code runs them.
4. Each step of a folded process is a step of `into`, or it goes into `notInProcess` with a reason. Never draw an arrow that the code does not have: when no code of `into` calls a folded process, leave that process out of `fold`.
5. The save moves the handoffs of each folded process to `into`. Change a title or a summary of `into` when it no longer says what the whole job does.
6. Write the JSON to `apostil-processes-fold-<into>.json` in the top folder of the repo, with the `group` of `into` as `apostil process <into>` printed it, `"add": true`, and the ids of the processes that you folded in as `"fold"`:

        { "group": "<the group of into>", "add": true, "fold": ["<id>", "<id>"], "processes": [ { "id": "<into>", "title": "...", "summary": "...", "steps": [ ... ], "arrows": [ ... ] } ] }

   Run `apostil add-processes apostil-processes-fold-<into>.json`. The save takes the folded processes out of the map, and it prints them in `folded`. It refuses an id that does not fold into a process of your JSON, and a step of a folded process that would be in no process and not set aside. Each problem says what to change. Correct it and save again, at most three rounds.

Reply with one line: `folded <count> processes into <into>, with <count> steps`, and each id that you left out, with the reason. Nothing else.
