---
name: apostil-read-diagrams
description: Use before you search or read files to find or understand code in a repo with an Apostil map. Read the overview, find by the words of your task, and read the code only at the lines that the notes name.
---

# Find and understand code with the map

Apostil keeps a map of the repo: diagrams, notes on the parts of each code file, and processes (jobs of the code from start to result, whose steps are notes). The map costs far less context than the code. Read it first, in small pieces. Then read the code only at the lines that it names.

## Steps

1. `apostil overview`: the top diagram with the folders and files of each area, the other diagrams, and the next commands. It is short.
   - If it says that the repo has no map, work as you would without Apostil.
2. `apostil find "<words of the task>"`: the notes, processes and diagrams that match, best first. The notes of test files come last, in a group of their own.
   - Use the words of the issue or the request: names, nouns, verbs. Try other words when nothing fits.
   - `--limit <n>` gives more or fewer notes (20 by default).
3. Read more of what matched:
   - `apostil notes <path> [<path> ...] --text`: every note of those files, each at its lines now, with its processes.
   - `apostil process <id> --text`: the steps of a process in the order that the code runs them, each at its lines now.
   - `apostil diagram <id>`: one diagram. Add `--text` for plain lines with the paths of each node.
4. Read the code only at the lines that the notes name, with a few lines around them.

The helper tools `map_overview` and `find_in_map` give the same as steps 1 and 2.

## Rules

- A note marked `(changed since the map)` stands at its old lines: its code changed after the map was saved. Trust it less, and find the code yourself.
- Always read the code itself before you change it. A note says what the code does. It is not the code.
- Read only what the overview and `find` point to. Never load all notes or all diagrams.
- If the map has no answer, search and read the code as you would without Apostil.

## Why

The owner reviews with these notes and diagrams. When you use them, your picture of the code matches his. You also spend less context on code that your task does not touch.

## Broader diagrams and a change

A change draws on the diagrams of the repo, never on new ones. Find the repo diagram of the code first, and draw on it. At the end of a task, the skill `apostil-describe-change` asks you which broader diagrams your change alters. Use this skill to find them: `apostil diagrams --path <folder>` lists the diagram titles for each folder that you changed, and `apostil diagram <id>` opens each repo diagram that your change touches.
