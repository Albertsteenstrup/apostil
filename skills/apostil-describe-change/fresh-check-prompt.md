# Fresh check of one part of a change file

You check the notes of one part of a change file against the code. You were given the path of a worktree and the id of your part. You know nothing else about this change. That is on purpose. Do not ask for the reason, the chat or the writer's report. If a note makes sense only when you know the reason, that is a finding.

## Step 1: Get your material

Run this in the worktree you were given:

    apostil for-check --part <id of your part>

It prints the title of the change, your part with its notes, the code lines that the notes point at, the diagrams of your part that have `before`, each node and arrow of the diagrams of your part with its code (`things`), and each link that leaves your part with its code (`links`). Each code line starts with its line number. A range with `removed: true` holds lines that the change removed. Each of its lines is marked `[removed]`. A range or a place in a Jupyter notebook has `cell`: its lines and their numbers count inside that cell, so read the note against that cell only. Use only what it prints. Do not open other files. Do not run Git. Do not read other change files.

## Step 2: Check each note

For each note, read its code lines and ask: do these lines support the note's title and text?

List a note when:

- the code does something else than the note says, or
- the note leaves out a case that changes what the note means (for example a condition that limits when the lines run, or an error path that the note says does not exist).

Do not list a note only because it leaves out a detail. A note is one line; it cannot say everything.

A note on removed lines says what the change took away. Judge it against the removed lines: do they hold what the note says is gone? Do not judge it against the code that stands now.

Write the line number where the problem sits.

## Step 2b: Check each "before"

`diagrams` lists the diagrams of your part that have `before`: the diagram now, its text before the change, and the old code of its file. Read `before` against the old code. List a diagram when `before` shows a step, message, state or transition that the old code did not have, or leaves out one that the change removed. List it also when a node that is still there has another id in `before` than now. Use the kind `no-note` and the diagram's `file`, with no `lines`. Name the diagram and the old line in the text.

## Step 2c: Check every node and every arrow of the diagrams

`things` lists every node and every arrow of each diagram of your part: its words (`thing`), its id (`node`, or `edge` and `name`), and its `places`, each with its file, its lines and their code, or its `reason`. A place with `removed: true` holds removed lines. An arrow with `filledIn` has the code of its decision; the tool gave it.

Read every one, as you read a note: do these lines do what the thing says? The lines of a step do that step; the lines of an arrow make that transition, that call or that choice; removed lines hold what a removed thing did. In a schema diagram (`erDiagram`), a node is a table and an arrow is a relation: the lines of a table make, alter or drop that table, with the columns and types that the diagram shows; the lines of a relation make that reference, from that column when the relation names one. A reason must be true: `outside` is outside the repo, `order` only says what comes next, `no-line` is a name that the code never declares.

What does not fit is an open point at that thing: the kind `thing-not-supported`, the `diagram` id, and `node`, or `edge` with `name`. Say in the text what the lines do instead, with the line number.

When you have read every node and arrow of a diagram, say so, so that the owner sees that the diagram was checked:

    apostil checked <diagram id> [<diagram id> ...]

Run it once, after you saved your points. A new save of the change file takes the mark away.

## Step 2d: Check each link that leaves your part

`links` lists each link from your part to another part: its words (`link`), its two parts (`edge`), its label (`name`), and its `places` with their code, or its `reason`.

Read each one against its places: does this line make the one part use the other, as the link says? The line of an import or a call fits; a line that only names a thing of the other part in a comment does not. A reason must be true, as for a thing of a diagram.

What does not fit is an open point at that link: the kind `thing-not-supported`, `edge` with the two part ids, and `name` when the link has a label. Give no `diagram`. Say in the text what the line does instead, with the line number.

When you have read every link that leaves your part, say so:

    apostil checked links --part <id of your part>

When every link of the change was read, the page says "checked" beside the title of the diagram of the change. Run it once, after you saved your points, also when your part has no diagram. A new save of the change file takes the mark away.

## Step 3: Find behaviour that no note mentions

Read the printed code. List behaviour that a reviewer would want to know and that no note mentions. Examples: a silent catch, a changed default, a removed check, a write to a store or a file, a call to an outside service.

## How many points

The owner reads every point, so a long list hides the points that matter. Save at most 5 points for your part, not counting the points at nodes, arrows and links. Choose in this order:

1. A note, a node, an arrow or a link that says something that the code does not do.
2. Behaviour that can lose data, hide an error, or change who can do what.
3. Other behaviour that a reviewer would stop at.

If you find nothing of these kinds, save fewer points, or none.

## What not to do

- Do not suggest fixes.
- Do not praise.
- Do not guess what code outside the printed lines does. If the lines call a function that you cannot see, say nothing about its inside.
- Do not list style problems.

## Step 4: Save the points

Write your list as JSON to the file `apostil-points-<id of your part>.json` in the top folder of the repo. The id of your part is in the name, because other checkers write their files at the same time. Then save it:

    apostil open-points apostil-points-<id of your part>.json --part <id of your part>

Write the file nowhere else, and do not put the JSON into the command itself: some apps refuse both. The command leaves this file out of the change. It removes the file when the save worked. After a repair, write the file again and save again.

Each entry has these fields:

| Field | Value |
|---|---|
| `kind` | `note-not-supported`, `no-note` or `thing-not-supported` |
| `text` | One sentence. Say what is wrong or what the code does. Follow the text rules: subject or verb first, plain words. |
| `file` | The file of the note or of the code. Required for `note-not-supported`. |
| `cell` | In a notebook: the cell of the note or the code, as `for-check` prints it (`cell`). |
| `lines` | `[first, last]`, counted from 1, as printed by `for-check`; in a notebook, counted inside the cell. Required for `note-not-supported`. |
| `diagram` | For `thing-not-supported` at a node or an arrow: the id of the diagram. A point at a link has none. |
| `node`, or `edge` and `name` | For `thing-not-supported`: the id of the node, or the ids of the two ends of the arrow and its label; for a link, the ids of its two parts and its label. |

Example:

    [
      { "kind": "note-not-supported", "text": "The note says the tick skips inactive rows; the query keeps paused rows.", "file": "src/service.py", "lines": [40, 52] },
      { "kind": "no-note", "text": "A failed run is logged and counted as blocked.", "file": "src/service.py", "lines": [88, 96] },
      { "kind": "thing-not-supported", "text": "Lines 61-63 only log the error; the retry is on line 70.", "diagram": "send-flow", "edge": ["send", "wait"], "name": "error" },
      { "kind": "thing-not-supported", "text": "Line 3 imports the fee type only; nothing in the part calls feeOf.", "edge": ["reminders", "fees"], "name": "uses feeOf" }
    ]

If you find nothing, save an empty list: `[]`.

## Your answer

Reply with one line: the number of points of each kind that you saved, and the ids of the diagrams that you marked as checked, and whether you marked the links of your part. Nothing else.
