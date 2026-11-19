---
name: apostil-map-repo
description: Use when the owner asks for the map of a repo, when he asks for notes on code and no file changed, when he asks for the processes of a repo, when he asks for another look of the diagrams or notes of a repo, or when Apostil Home shows no map. It starts an overview writer, one area writer for each large area, notes writers, process writers and then service and mark writers, so the map points at real folders and files, holds notes on the code of every file, draws the jobs of the code with those notes as their steps, and shows the services that the code reaches.
---

# Map a repo

Apostil Home shows a map of the whole repo: a top diagram of its areas, and one diagram for each large area. Each node says which folders and files it stands for, so the owner can click from a folder or file to the diagrams it belongs to. The map also holds notes for the code of every file: about one note for each 8 to 15 lines of code. The owner sees them beside the code, also when no change is described. Then the map holds the processes of the repo: each job of the code, from its start to its result, with the notes as its steps, across files. Home draws them under the areas. Last, the map holds marks at lines of code: the services that the code reaches, whose icons stand on the nodes and notes, and the marks of any set that the look of the repo adds. You do not write the map yourself. Writer subagents write it. The command `apostil` checks and saves it.

Do this when the owner asks for a map of the repo, when he asks for notes and no file changed, or when Home has none. Check with `apostil map`: it exits with 1 when no map is saved. Do not redo a map that exists unless the owner asks, or the repo has changed a lot since the map's commit.

## Notes for a map

Notes do not need a change. `apostil map` says how many notes the map holds (`notes`) and in how many files (`notedFiles`), and gives a `hint` when code files need notes. When the owner asks for notes, or `apostil map` gives that `hint`, keep the top diagram and the diagrams of the areas and do only Step 3. A second run is small: `apostil note-groups` lists only the files with no notes, and the files whose code changed since their notes. Never ask the owner for a commit for this. When the map holds processes, do Steps 4 and 5 after Step 3: notes that are written again can leave a process stale.

## Processes for a map

A process is made of notes, so the notes come first. `apostil map` says how many processes the map holds (`processes`), and gives a `hint` when notes are in no process or a process is stale. When the owner asks for processes, or `apostil map` gives that `hint` and no code file needs notes, keep the diagrams and the notes and do only Steps 4 to 8. A second run is small: `apostil process-groups` lists only the groups with work left.

## The look and the marks

Apostil draws every repo in the default look, with the icons of the services at the upper right of each node and step whose code reaches a service, and at the left of each service line of a note. Keep the default unless the owner asks for another look. When he asks, in his own words, to change how the diagrams, nodes, arrows or notes of this repo look, write the look yourself with `apostil set-look`, as `look-writer-prompt.md` says. A look is kept for the repo, and every later map run keeps it: never write a look that the owner did not ask for, and never drop one that he asked for. `apostil look` prints the look of the repo, or says that the default applies. When the owner asks only for a look, keep the map and do only that, then Step 7 when the look adds a set of marks.

Marks are written at lines of code by writers, as notes are. The services are marked on every map run (Step 7). A set that the look adds is marked too. A second run is small: `apostil mark-groups` lists only the files that no writer of the set has read, and the files whose lines changed since. `apostil marks` prints the counts.

## A big repo, and a run that stops

The top diagram is drawn first, from folders and a few files, so the owner sees it soon. Step 6 corrects it when the notes and the processes show that it is wrong. A run that stops can go on: `apostil note-groups`, `apostil process-groups` and `apostil mark-groups` list only what is left, so a new session starts at Step 3 and does the groups that they list. Apostil keeps the plan of the work of a run and shows the owner on Home how much is done and about how long the rest takes.

## Why several kinds of writer, and which model

You are the lead. You start the writers, check what they save, and correct them by starting a writer again. You never write a part of the map yourself.

When Apostil starts the run, its prompt names the model and the effort of every writer: use the model that Apostil names for each writer below, also for the overview writer and the process writers. You check their work with `apostil map --fit` (Step 6) and with the commands of each step.

When no model is named (a person started this skill by hand), choose by the work. The overview needs judgment about the whole repo: what belongs together, and what flows between the areas. A medium or large model does that better. The diagram of one area, and the notes of one group of files, are local work: read the files, write what they hold. A small model does that well, and many writers can run at the same time. A process follows calls across files and must judge what a job is, so a medium model writes it. Use the newest model of each size that the app offers.

## Step 1: Start the overview writer

Use the model that Apostil names. When it names none, use a medium or large model.

Give the writer:

- the full text of `overview-writer-prompt.md` and of `../apostil-describe-change/text-rules.md`,
- the full text of `example-map.json`,
- the path of the repo folder,
- one line of the owner's wish, if he gave one (for example "focus on the server").

Do not paste code or the chat into the brief. The writer saves the top diagram with `apostil save-map`. Its report names each area that needs a diagram of its own, with the id of its node and its paths.

## How many writers run at once, and when you end your turn

Up to 16 writers run at the same time, of all kinds together. Start up to 16, and start the next as soon as one ends. Notes writers come first, then process writers, then service and mark writers. The steps below say when each kind may start; a kind does not wait for a whole earlier step when its own work is ready. Never leave a place free while work is ready.

The commands list their groups largest first. Start the groups in that order, so that the longest work starts with the first writers, not at the end.

Start several writers in one message: one tool call for each writer, at most 10 in one message (Claude Code runs at most 10 tool calls at once), and the rest in the next message.

Each writer checks its own part before it reports, and reports one line: what it saved, or the problem. When a writer ends, run at most one command for it (the steps below name it), and start the next writers in the same message.

The run waits for its writers. End your turn only when no writer runs, or when you wait for writers that you started: each writer reports to you when it ends, and you then check its save and start the next. Never end the run while a writer still works. In an app whose run ends with your turn (Codex), wait for the writers inside your turn, with its tool that waits for agents.

## Step 2: Start one area writer for each named area

Use the model that Apostil names. When it names none, use a small model. Start them as soon as the overview is saved, together with the notes writers of Step 3.

Give each writer:

- the full text of `area-writer-prompt.md` and of `../apostil-describe-change/text-rules.md`,
- the full text of `example-area-diagram.json`,
- the path of the repo folder,
- the id of the node of its area, the paths of that node, and the id of the top diagram.

Each writer adds its diagram with `apostil add-diagram`. It writes no notes. The command keeps the diagrams that the other writers add. If the overview writer named no area, skip this step.

## Step 3: Start the notes writers

Run `apostil note-groups` in the repo. It prints `{ "groups": [ ... ], "skipped": { ... } }`: each group has a `name` and its `files`, about 400 lines in sum, largest first. A file is never split: a file longer than that is a group of its own, whole, and it comes first, so start it with the first writers. It lists only the files that need notes. When it lists more than 80 groups, tell the owner the count of groups and of lines (the sum of `lines` of the files) and ask whether to map all of it or only the paths that he names. Use `apostil note-groups --all` only when the owner wants the notes of every file written again.

Use the model that Apostil names. When it names none, use a small model. Start one notes writer for each group, in the order listed: up to 16 at once with the area writers, and the next when one ends.

Give each writer:

- the full text of `notes-writer-prompt.md` and of `../apostil-describe-change/text-rules.md`,
- the path of the repo folder,
- its group: the `name` and the `files` of that group, as the command printed them.

Each writer saves its notes with `apostil add-notes`. The command keeps the notes of the other writers. If `groups` is empty, skip this step.

## Step 4: Start the process writers of an area as soon as its notes are saved

After each notes writer ends, run `apostil process-groups`: that is the one command for an ended notes writer. It prints `{ "groups": [ ... ], "waiting": <n> }`: each group has a `name`, its `area` and its `files` with their count of notes, largest first. It lists only the groups of areas whose notes are all saved, and only the groups with work left; `waiting` says how many areas still wait for notes. Start one process writer for each group that it lists and that you have not started yet, in the places that the notes writers leave free. When `waiting` went down, the notes of an area are all saved, and its service and mark writers may start too (Step 7). Use `apostil process-groups --all` only when the owner wants all processes written again.

When all notes writers have ended, run `apostil note-groups`: when it lists a group, a notes writer failed, so start that one again. Then run `apostil process-groups` once more for the groups that are left.

Use the model that Apostil names. When it names none, use a medium model. Give each writer:

- the full text of `process-writer-prompt.md` and of `../apostil-describe-change/text-rules.md`,
- the path of the repo folder,
- its group: the `name` and the `files` of that group, as the command printed them.

Each writer saves its processes with `apostil add-processes`. The command keeps the processes of the other writers. If no group is listed, skip this step.

## Step 5: The second round of each group, as soon as its writer ends

When a process writer ends, run `apostil processes --group <name of its group>`: that is the one command for an ended process writer. It prints `{ "group", "processes", "notInProcess", "stale", "again" }`: in `notInProcess.files` the files of that group whose notes are in no process yet, with up to five keys for each file, and in `stale` the processes of that group whose steps name notes that are gone. When `again` is true, start one process writer again for that group at once, with the same three things as in Step 4 and this part at the end, with the keys of `notInProcess`:

    These notes of your files are in no process yet: <the keys>.
    Put each of these notes into a process, with its arrows, or set it aside in "notInProcess" with a reason.
    Never draw an arrow that the code does not have.
    Add "add": true to your JSON: the save then keeps the processes of your group that you do not name.
    To change a process that exists, run apostil process <id>, and send it again with the same id.

When `stale` lists processes, add this line with their ids:

    These processes of your group name notes that are gone: <the ids>. Write them again with the notes as they are now.

Do this round once for each group: when the writer of the second round ends, start no third. The other groups do not wait for it. When every process writer has ended, run `apostil processes` once for the counts of the report.

## Step 6: Correct the top diagram

The top diagram was drawn before the notes and the processes existed. Run `apostil map --fit`. It prints four short lists: `filesInNoNode` (files with notes that stand in no node of a diagram), `nodesWithNoFile` (nodes whose paths hold no file with a note or a process), `callsWithNoArrow` (calls of the processes between two nodes of the top diagram that have no arrow between them, with an example line for each), and `usedWithNoNote` (functions, methods and classes that other code files use and that have no note, the most used first). Each list has at most 20 entries and the count of the rest.

Do this step once, when the last process writer has ended, also of a second round; the service and mark writers of Step 7 may still run beside it. When the first three lists are empty, skip this step. Else start the overview writer once more, on the model of Step 1, with the same things as in Step 1, the four lists as `apostil map --fit` printed them, and this sentence: "Correct only what these facts show, and keep the ids of the nodes that stay." Start the area writer of Step 2 again only for an area whose node the top diagram changed (new paths, or a new node). Do this round once.

## Step 7: Start the service writers and the mark writers of an area as soon as its notes are saved

The groups of an area are ready as soon as the notes of that area are saved, as in Step 4: a service writer marks lines of code and needs no process. So this step runs at the same time as the notes writers of other areas, the process writers and Steps 5 and 6. Its writers share the 16 places with the others; notes come first.

Run `apostil mark-groups --set services` when `apostil process-groups` shows that the notes of another area are all saved (`waiting` went down), in the same message as the process writers that you start then, and once more when all notes writers have ended. It prints `{ "set", "values", "groups": [ ... ], "waiting": <n> }`: each group has a `name`, its `area` and its `files`, each file with its `candidates` (lines that a list of signs found, with the service that each may be), largest first. It lists only the groups of areas whose notes are all saved, and only the files that need work; `waiting` says how many areas still wait for notes. Use `--all` only when the owner wants all services written again.

Use the model that Apostil names. When it names none, use a small model. Start one service writer for each group that it lists and that you have not started yet, in the order listed, in the places that are free, and the next when one ends. Give each writer:

- the full text of `service-writer-prompt.md` and of `../apostil-describe-change/text-rules.md`,
- the path of the repo folder,
- its group: the `name` and the `files` of that group with their candidates, as the command printed them.

Then, for each set of `apostil look` other than `services`, run `apostil mark-groups --set <id of the set>` at the same times, and start one mark writer for each group it lists that you have not started yet, on the model that Apostil names, else a small model. Give each writer the full text of `mark-writer-prompt.md` and of `../apostil-describe-change/text-rules.md`, the path of the repo folder, its group as the command printed it, and the id, the name, the rule and the values of the set, as `apostil look` printed them, in place of the words in `<…>` of the prompt.

Each writer saves its marks with `apostil add-marks`. The command keeps the marks of the other writers. If `groups` is empty, skip that set.

When all writers have ended, run `apostil marks`. When its `noIcon` is not empty, each of those services has marks and no icon. Try `apostil icon <id> https://<its site>` once for each, then `/favicon.ico` and `/apple-touch-icon.png` of its site. Run `apostil marks` again. For each service that is left, the own website gave no icon. Ask the owner in one message, for all of them, whether you may take each icon from another site, and from which. Fetch nothing from another site without his yes. With his yes, run `apostil icon <id> <address> --other-site`. Report to the owner in one line the services that are left with no icon: letters stand in their place until he gives one.

## Step 8: Wait for the reports

Wait until every writer that you started has ended. Run `apostil map` to see the stored map. If a writer failed or left a problem, start that writer again once. Run `apostil note-groups` again: a group that is still listed had a failed writer. Do not draw a diagram, write a note, write a process or write a mark yourself.

## Step 9: Report to the owner

Tell the owner in 2 or 3 lines: the map is saved, the areas it shows and which areas have their own diagram, how many notes the map holds and in how many files (`notes` and `notedFiles` of `apostil map`), the counts of `apostil processes` (`processes`, `steps`, `setAside`, `notInProcess.count` and the stale processes), the count of notes that the process writers corrected or added, the services of `apostil marks` and their counts, and the problems that the writers reported. Do not repeat the map file.

## When the app has no subagents

Tell the owner: "This app has no subagents, so I did not write the map." Do not write it yourself in a long session. A map written from a full context follows what you did, not what the repo is.

## Why subagents

A fresh writer reads the repo as it is. It does not carry the story of your last task. The tool checks the facts (each path exists, one top map, each key of `nodePaths` is a node, no file in two nodes, each note points at real lines, each arrow of a process names a line of the code in both of its steps). The writer supplies the meaning.
