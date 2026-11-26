# Write the look of a repo

The owner asked, in his own words, to change how the diagrams, the nodes, the arrows or the notes of this repo look. You turn his words into a look: a list of rules that Apostil keeps for this repo and applies each time it draws. Nothing goes into the repo. Run every command in the top folder of the repo.

## How a look works

- With no look, the default look applies: the icons of the services at the upper right of each node and step whose code reaches a service, and at the left of each service line of a note.
- A rule picks things and changes one or more slots of them. All that no rule names keeps the default.
- When two rules set the same slot of the same thing, the rule that names the thing most closely wins: a node id, then a mark, then a path, then a kind. Between two rules of the same kind of pick, the later one wins.
- A rule that fills the upper right corner of a thing takes the place of the icons of the services there.
- A new look replaces the old one. So first run `apostil look`, start from the look that it prints, and change only what the owner asked for. `{ "rules": [] }` brings back the default look.

## Step 1: Find the names

Run `apostil look-slots`. It prints the core, which most looks need, and one index line for each area. For a thing that the core does not hold, read the index line that fits and run `apostil look-slots <area>`. When no line fits, run `apostil look-slots --find "<the owner's words for it>"`. Never guess a name. When nothing fits, tell the owner, and leave it out.

## Step 2: Write the rules

For each thing in his words, find how to pick it: `apostil map` lists the ids of the diagrams and the paths of their nodes; a drawn process is `process:<id>`. A pick always gives a `kind`, and all that it gives must fit. Pick as narrowly as his words, and no wider. A rule names only the slots, and the fields, that he asked to change. Make one rule for each group of things that change in the same way.

A file of the look (a picture, a film, an icon) is a file of the repo, or a file that you put in the top folder as `apostil-look-<name>.<ending>`. Apostil keeps it in its own store and removes the `apostil-look-` files after the save. When the owner names a picture that is not in the repo, ask him for it. Do not take one from the web unless he says where.

## Step 3: A new kind of mark

When he wants icons for lines that no set marks yet, add a set to `sets`: `apostil look-slots marks` gives its form. The built-in set `services` already marks each line where the code depends on something outside the repo that others make, host or own, and that the owner knows by its name and logo. Lines that fit that rule are no new set: the service writers mark them, and their icons stand with the other services, side by side in the default corner. When the owner asks about the icons or the corner of such a set that the look already has, take that set out of the look, with its corners, and tell him that its icons now stand with the services. Put the icons of a new set in a top corner of a node, the upper left, and use a lower corner only when the owner asks for one. A writer who does not know the owner reads its `rule`: say in plain words which lines get a mark, and which value each gets. After the save, start the mark writers (Step 8 of the skill).

## Step 4: Check, then save

Write `{ "sets": [ … ], "rules": [ … ] }` to `apostil-look.json` in the top folder of the repo, and run `apostil set-look --check apostil-look.json`. It saves nothing. Each problem is one sentence that says what to change, with the nearest right name when one is close. Correct the look and check again, at most three rounds. Then run `apostil set-look apostil-look.json`. Tell the owner in one or two lines what its `changes` say, and what you left out of his words and why. A rule in `notes` picks nothing yet: say so, unless Step 3 brings its marks.
