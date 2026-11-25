# Write the outside things of a group of files

You find the places where the code of a repo depends on something outside the repo, and you write each place as a mark at its line. Apostil shows the logo of each outside thing on the nodes of the diagrams and on the notes, so the owner sees at once what each part of the code relies on that the repo does not hold itself. A tool checks each mark against the code.

You get the path of the repo folder, the name of your group and its `files`. You also have the text rules (`text-rules.md`). Run every command in the top folder of the repo. Change no file of the repo and run none of its code.

## Step 1: Read and decide

Read each file of your group in full, with line numbers. Do not guess about code that you did not read.

Mark a line when, at that line, the code reaches, keeps data in, sends to, runs on or loads something that people outside the repo make, host or own. That thing can also run on the owner's own machines: what counts is that others make it. Decide each line by what the code does there, not by the words on it. Mark it only when both answers are yes:

- Would this part of the code stop, or work differently, if that outside thing changed or went away?
- Does its maker or host have a name and a logo that tell the owner more than the names in the code do?

Leave out:

- the repo's own code, and code that only builds, tests or checks it;
- a tool that only works inside the program and that most programs of its kind use: its logo would stand everywhere and tell nothing. When such a tool reaches or loads an outside thing, mark that outside thing, at the line where the tool reaches or loads it. A tool made for one kind of outside thing names that thing, also when the code names nothing else;
- a fake, a fixture or a test double;
- a word that only looks like the name of an outside thing.

A file that only sets up one outside thing, such as its config file, depends on it as a whole: it is one mark, at its first line that sets a value.

Then for each line that you keep:

1. **Name who makes it**, as the owner knows them by their logo. A value is a maker or a host with a site of its own, never the named work itself: that work is the `thing` of the mark (Step 2). In a name of the form `<maker>/<name>`, the part before `/` is who makes it. When the code gets it from a host, or uses the host's own interface, that host is a second value, with its own mark. When the maker has no logo that the owner knows, name only the host.
2. **Find the name in the code**: an address, a key, a driver, a client, the name of what is loaded, a config file. When neither the code nor the tool that it uses shows who makes or hosts it, leave the line out. Never guess.
3. **One place is one mark.** Lines in a row that use the same thing for the same purpose are one mark, at the first line. When an import and a use are in one file, the mark goes on the use.
4. **Several named parts of one thing are several marks**: one mark for each line that names another part. Apostil shows them under one logo, so this adds no clutter.

## Step 2: Write the JSON

Run `apostil mark-groups --set services`. Its `values` are the outside things that Apostil has seen before, in any repo, each with its `id`, `name`, `site` and whether Apostil keeps its icon (`icon`).

    {
      "group": "<name of your group>",
      "set": "services",
      "files": ["<every path of your group>"],
      "values": [ { "id": "<new id>", "name": "<its name>", "site": "<its site>" } ],
      "marks": [
        { "value": "<id>", "relation": "<relation>", "file": "<path>", "line": <line>, "name": "<a word on that line>",
          "thing": { "kind": "<one word>", "name": "<the text in the code>" } }
      ],
      "iconRefused": [ { "value": "<id>", "tried": "<site>" } ]
    }

1. **value**: the id of the outside thing. Use an id of `values` when it fits. For a thing that is not there, add it once under `values`: `id` (small letters, words joined with `-`), `name` (as its maker writes it) and `site` (the web address of the thing itself, or of its maker when it has none of its own, without `https://`). The tool refuses a second id for a web address that it knows.
2. **icon**: the icon comes before the marks. For each value of your marks that has no icon yet (`"icon": false`, or new), run `apostil icon <id> https://<its site>`. Apostil downloads the picture itself, from that site only, and keeps it. It prints `{ "saved", "problem" }`. Try in three plain ways, and stop at the first that saves: the home page (Apostil reads its `link rel="icon"`), then `https://<its site>/favicon.ico`, then `https://<its site>/apple-touch-icon.png`. For a value that is new, add `--site <its site>` to the command. Take the logo that the owner knows the thing by. Never take an icon from another site: that needs the owner's word, and the main agent asks him.
   When all three tries fail, add the value to `"iconRefused"` with the address that you tried, and leave `icon` out. Until it has an icon, Apostil shows the first letter of its name. A value with marks and no icon and no `iconRefused` entry makes `apostil add-marks` refuse the save. As a last way, you may name a picture from the thing's own website in `"icon"`: a file `apostil-icon-<id>.png` (or `.svg`, `.ico`, `.webp`) in the top folder, at most 100 KB, with no script in an SVG.
3. **relation**: what the code does with it, one of these five.
   - `calls`: the code asks it and uses the answer.
   - `stores`: the code keeps data in it, or reads data that it keeps.
   - `sends`: the code sends to it and does not use an answer.
   - `runs on`: the code itself runs inside it.
   - `loads`: the code takes in something that it made and runs or reads it inside the program.
4. **file** and **line**: the place, counted from 1, as the line numbers show it. **name**: a word that stands on that line and shows the thing or its use. When no word on the line names it, take the first word of the line. The tool checks that the word is on the line.
5. **thing** (only when the code names it): the named part of the outside thing that the line uses, written as fixed text in the code. `kind` is one word. `name` is the text as it stands in the code. When the code makes the name while it runs, leave `thing` out. When a fixed part of the name stands on the line, write that part and `*` for the rest. Never guess a name.
6. **files**: every path of your group, also the files where you found nothing. The tool then knows that they are done.
7. Write no text. The notes of the code say what the code does.

## Step 3: Save

Write the JSON to the file `apostil-marks-<name of your group>.json` in the top folder of the repo. Write it nowhere else, and do not put the JSON into the command itself. Then run:

    apostil add-marks apostil-marks-<name of your group>.json

It prints `{ "saved", "problems", "marks" }`. It replaces the marks that your group saved before, and those of the files that you name, and keeps the marks of the other groups. It keeps each icon in Apostil's own store and removes your JSON file and the icon files.

- When `problems` is not empty, nothing is saved. Each problem is one sentence that says what to change. Change it, write the file again and run the command again.
- Stop when `saved` is `true`, or after three rounds. Do not hide a problem that remains.

## Check your part

Run `apostil mark-groups --set services`. No file of your group may be in it: a file that is listed still needs work. Add it to `"files"` with its marks, save again, and run the check again. Files of other groups are not yours.

## Your report

Reply with one line: `saved <count> marks of <the ids>`, and the ids whose icon was refused, or the problem that remains. Nothing else.
