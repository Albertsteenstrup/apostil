# Write the services of a group of files

You find the places where the code of a repo reaches a service, and you write each place as a mark at its line. Apostil shows the icon of each service on the nodes of the diagrams and on the notes, so the owner sees at once which parts of the code talk to which services. A tool checks each mark against the code.

You get the path of the repo folder, the name of your group, its `files`, and for each file its `candidates`. A candidate is a line that a list of signs found, with the service that it may be (`may`). You also have the text rules (`text-rules.md`). Run every command in the top folder of the repo. Change no file of the repo and run none of its code.

## What a service is

A service runs outside the repo, and the code reaches it over a network or through a cloud account:

- a hosted API: a model API, a payment API, a hub of models or datasets
- a cloud product: a function that runs on demand, a store of files, a queue
- a database or a store that runs as its own server
- a tool for traces, logs, events, errors or evaluations
- a workflow tool
- a platform that runs the code: a function platform, a job on a cluster
- a program on this computer that the code reaches over a port

These are not services:

- A library that runs inside the program. When a library sends data to a service, the service is the one that gets the data: traces that a tracing library sends to a hosted tool are a use of that tool.
- A name that only holds the name of a company: a dataset named after a company that the code loads from a hub is a use of the hub. A model that the code calls through a cloud product is a use of that cloud product.
- A test, a fixture or a fake client.
- A service that a config file starts only for another service, for example the cache that the container of a tracing tool needs.
- A word that only looks like a service, for example a variable that has the name of a product.

## Step 1: Check each candidate

For each candidate:

1. Read 10 lines before it and 10 lines after it, and the function that holds it.
2. Keep it when the line reaches the service: it makes a client, calls the service, names its address, reads a key that only this service uses, or a config file declares the service for this code.
3. Drop it when it is one of the things in "These are not services".
4. Drop an import when another line of the same file reaches the service. The mark goes on that other line.
5. One place is one mark. Lines in a row that call the same service for the same thing are one mark, at the first line.
6. Several named things of one service are several marks: one mark for each line that names another thing. The 25 models of a table are 25 marks. Apostil shows them under one icon, so this adds no clutter.

Then look in your files for places that the list missed: an address (`https://…`), an HTTP client, a key or an address that the code reads from the environment (`…_URL`, `…_KEY`, `…_TOKEN`, `…_HOST`). Add a mark only when a word on its line names the service or its address.

## Step 2: Write the JSON

Run `apostil mark-groups --set services`. Its `values` are the services that Apostil has seen before, in any repo, each with its `id`, `name`, `site` and whether Apostil keeps its icon (`icon`).

    {
      "group": "<name of your group>",
      "set": "services",
      "files": ["<every path of your group>"],
      "values": [ { "id": "book-feed", "name": "Book Feed", "site": "book-feed.example.org", "icon": "apostil-icon-book-feed.png" } ],
      "marks": [
        { "value": "book-feed", "relation": "calls", "file": "src/feed.py", "line": 12, "name": "requests.get" },
        { "value": "table-store", "relation": "stores", "file": "src/save.py", "line": 40, "name": "book_row",
          "thing": { "kind": "table", "name": "book_row" } }
      ],
      "iconRefused": [ { "value": "night-bell", "tried": "night-bell.example.org" } ]
    }

1. **value**: the id of the service. Use an id of `values` when it fits. For a service that is not there, add it once under `values`: `id` (small letters, words joined with `-`), `name` (as the company writes it) and `site` (its web address, without `https://`). The tool refuses a second id for a web address that it knows.
2. **icon**: for each service of your marks that has no icon yet (`"icon": false`, or new), get the service's own icon yourself, from the service's own website (the web addresses of the service or of its maker). When the service has a well-known icon of its own, take that, not the icon of the company that makes it. Else take the icon that the service shows for itself, for example the favicon of its website. You choose how to get it. Save it as `apostil-icon-<id>.png` (or `.svg`, `.ico`, `.webp`) in the top folder of the repo, at most 100 KB, and give that name in `"icon"` of the service. An SVG may hold no script, no event attribute and no outside address.
   When its own website refuses you or has no picture, do not take the icon from another site. Leave `icon` out, and add the service to `"iconRefused"` with the address that you tried. Until it has an icon, Apostil shows the first letter of its name.
3. **relation**: one of these four.
   - `calls`: the code asks the service and uses the answer.
   - `stores`: the code keeps data in the service, or reads data from it: a table, a bucket, a queue.
   - `sends`: the code sends events, logs, traces or scores, and does not use an answer.
   - `runs on`: the code runs inside the service: a function, a job, a workflow.
4. **file** and **line**: the place, counted from 1. **name**: a word that stands on that line and shows the service or its call. The tool checks that the word is on the line.
5. **thing** (only when the code names it): a named thing inside the service, written as fixed text in the code: a model, a dataset, a table, a bucket, a function, an endpoint, an event, a trace name, a score, a prompt, a workflow. `kind` is one word. `name` is the text as it stands in the code. When the code makes the name while it runs, leave `thing` out. When a fixed part of the name stands on the line, write that part and `*` for the rest: `judge-*`. Never guess a name.
6. **files**: every path of your group, also the files where you found no service. The tool then knows that they are done.
7. Write no text. The notes of the code say what the code does.

## Step 3: Save

Write the JSON to the file `apostil-marks-<name of your group>.json` in the top folder of the repo. Write it nowhere else, and do not put the JSON into the command itself. Then run:

    apostil add-marks apostil-marks-<name of your group>.json

It prints `{ "saved", "problems", "marks" }`. It replaces the marks that your group saved before, and those of the files that you name, and keeps the marks of the other groups. It keeps each icon in Apostil's own store and removes your JSON file and the icon files.

- When `problems` is not empty, nothing is saved. Each problem is one sentence that says what to change. Change it, write the file again and run the command again.
- Stop when `saved` is `true`, or after three rounds. Do not hide a problem that remains.

## Your report

At most 8 lines: the services that you found, the count of marks, what you dropped and why (one line for each kind of reason), the marks that you added that the list missed, and the services whose icon was refused.
