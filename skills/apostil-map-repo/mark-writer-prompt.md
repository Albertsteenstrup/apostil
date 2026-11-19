# Write the marks of one set for a group of files

You put marks at lines of code of one repo. Apostil shows the icon of each mark on the nodes of the diagrams and on the notes that hold its line, at a corner that the look of the repo gives it. The owner asked for this kind of mark. A tool checks each mark against the code.

You get the path of the repo folder, the name of your group, its `files`, and the set of marks that you write:

- the id of the set: `<id of the set>`
- its name: `<name of the set>`
- its rule, in the owner's words, made plain: `<rule of the set>`
- its values, each with an id and a name: `<values of the set>`

You also have the text rules (`text-rules.md`). Run every command in the top folder of the repo. Change no file of the repo and run none of its code.

## Step 1: Read and mark

1. Read each file of your group in full before you mark it. Do not guess about code that you did not read.
2. Put a mark on each line that the rule names, and on no other line. When you are not sure that a line fits the rule, leave it out.
3. Give each mark the value of the set that fits it. Use the ids of the values. When a line fits the rule and no value fits it, add one new value under `values` with an `id` (small letters, words joined with `-`) and a `name`.
4. One line gets at most one mark of one value. Lines in a row that do one thing get one mark, at the first line.
5. When the code names a thing with fixed text that the mark is about (a table, a model, an event), add it as `thing`: `kind` is one word, `name` is the text as it stands in the code. Never guess a name.

## Step 2: Write the JSON

    {
      "group": "<name of your group>",
      "set": "<id of the set>",
      "files": ["<every path of your group>"],
      "values": [ { "id": "<new value>", "name": "<its name>" } ],
      "marks": [ { "value": "<id of a value>", "file": "src/one.py", "line": 12, "name": "<a word on that line>" } ]
    }

- **file** and **line**: the place, counted from 1, in the file as it is now. Read the file with line numbers and take the numbers from there.
- **name**: a word that stands on that line and shows why the line has the mark. The tool checks that the word is on the line.
- **files**: every path of your group, also the files with no mark. The tool then knows that they are done.
- Leave out `values` when you add no value. Write no text: the notes of the code say what the code does.

## Step 3: Save

Write the JSON to the file `apostil-marks-<name of your group>.json` in the top folder of the repo. Write it nowhere else, and do not put the JSON into the command itself. Then run:

    apostil add-marks apostil-marks-<name of your group>.json

It prints `{ "saved", "problems", "marks" }`. It replaces the marks of this set that your group saved before, and those of the files that you name, and keeps all other marks. It removes your JSON file.

- When `problems` is not empty, nothing is saved. Each problem is one sentence that says what to change. Change it, write the file again and run the command again.
- Stop when `saved` is `true`, or after three rounds. Do not hide a problem that remains.

## Check your part

Run `apostil mark-groups --set <id of the set>`. No file of your group may be in it: a file that is listed still needs work. Add it to `"files"` with its marks, save again, and run the check again. Files of other groups are not yours.

## Your report

Reply with one line: `saved <count> marks`, and the values that you added, or the problem that remains. Nothing else.
