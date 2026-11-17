# Write the look of a repo

The owner asked, in his own words, to change how the diagrams, the nodes, the arrows or the notes of this repo look. You turn his words into a look: a list of rules that Apostil keeps for this repo and applies each time it draws. You save it with `apostil set-look`. Nothing goes into the repo. Run every command in the top folder of the repo.

## How a look works

- With no look, the default look applies: today's look, with the icons of the services at the upper right of each node, step and note whose code reaches a service.
- A rule picks things and changes one or more slots of them. Everything that no rule names keeps the default.
- When two rules set the same slot of the same thing, the rule that names the thing most closely wins: a node id, then a mark, then a path, then a kind. Between two rules of the same kind of pick, the later one wins.
- A rule that fills the upper right corner of a thing takes the place of the icons of the services there. The services then show only in the window of the node.
- A new look replaces the old one. So first run `apostil look`, start from the look that it prints, and change only what the owner asked for. `{ "rules": [] }` brings back the default look.

## Step 1: Read what a look can change

Run `apostil look-slots`. It prints the one list of what a look can change:

- `components`: the kinds of things that a rule picks, each with what it is and its `slots`.
- `picks`: what a rule can pick by, besides its kind.
- `slots`: each slot with what it changes and its `fields`, each field with the kind of value that it takes. A slot with `"one": true` takes exactly one of its fields.
- `values`: each kind of value in words: a colour, a width, a shape, a file, a button, a corner.
- `actions`: what a button can do on a click, each with its `form`. Nothing else runs.

Use only what this list holds. When the owner asks for a change that the list does not hold, tell him so, and leave it out.

## Step 2: Find what the owner names, and name what changes

For each thing in his words, find how to pick it. Run `apostil map` for the ids of the diagrams and the paths of their nodes; a drawn process is `process:<id>` (`apostil processes` counts them). A pick always gives a `kind`; all that a pick gives must fit. Pick as narrowly as the words of the owner, and no wider.

A rule names only the slots that the owner asked to change, and in each slot only the fields that he asked to change. Make one rule for each group of things that change in the same way.

Give one colour for each colour field. Apostil makes the colour of the dark theme and the colour of the words itself, so that both themes read. Do not give a second colour for the dark theme.

A file of the look (a picture, a film, an icon) is a file in the repo folder: a file of the repo, or a file that you put in the top folder as `apostil-look-<name>.<ending>`. Apostil checks it and keeps it in its own store; it removes the `apostil-look-` files after the save. When the owner names a picture that is not in the repo, ask him for it. Do not take a picture from the web unless he says where.

## Step 3: A new kind of mark

When the owner wants icons for lines of a kind that no set holds yet, add a set to `sets`:

    { "id": "<small letters and ->", "name": "<a short name>", "rule": "<one or two plain sentences that tell a writer which lines to mark>",
      "values": [ { "id": "<id>", "name": "<name>", "icon": "<file of an icon>" } ], "corner": { "node": "<corner>", "note": "<corner>" } }

The `rule` is read by a writer that does not know the owner: say which lines get a mark, and which value each gets, in plain words. The corner of the set is where its icons stand on a node and on a note, unless a rule says another corner. After the save, start the mark writers (Step 6 of the skill).

## Step 4: Save

    {
      "sets": [ … ],
      "rules": [ { "pick": { "kind": "<kind>", … }, "<slot>": { … } } ]
    }

Write it to `apostil-look.json` in the top folder of the repo, and run:

    apostil set-look apostil-look.json

It prints `{ "saved", "problems", "rules", "sets", "files" }`. When `problems` is not empty, nothing is saved: each problem is one sentence that says what to change. Change it and run the command again, at most three rounds. Then tell the owner in one or two lines what the look changes, and what you left out of his words and why.
