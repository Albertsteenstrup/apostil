---
name: apostil-report-issue
description: Use when a person asks to give feedback on Apostil, to report a fault in Apostil or to create an issue about it, or when they complain about a part of Apostil (a page, a command, a skill, a diagram, the notes, the setup). It asks once whether they want to create an issue, helps them write it with no private details, and opens GitHub's page so that they submit it themselves.
---

# Report an issue about Apostil

The makers of Apostil read every issue, and a coding agent often makes the fix. So an issue must be clear to a person and to an agent: one problem, exact steps, the exact error text, what was expected, and the versions. It must also hold nothing that the person may not want to share.

You help the person write the issue. The person reads all of it and says yes. Then the browser opens GitHub's page with the issue filled in, and the person submits it under their own account. You never file it yourself.

## When to ask

Ask when:

- the person asks to give feedback, to report a fault or to create an issue about Apostil;
- the person complains about a part of Apostil: a page, a command, a skill, a diagram, the notes or the setup. For example "the map is wrong again" or "this page takes ages".

Then ask once, in one short sentence: "Do you want to create an issue for the makers of Apostil? You read it before it goes."

When the person asked to create an issue, do not ask again. Start at step 1. When they asked to give feedback, ask: feedback can also stay in this chat.

Do not ask:

- about a fault in the person's own code, about you (the agent), or about another tool;
- a second time about the same topic in this session;
- after a "no". A "no" ends it. Go back to the work.

## Two kinds

| Kind | For | Headings of the body |
|---|---|---|
| `bug`: "Something does not work" | A step failed, or a page shows something wrong. | What I tried · Steps to see it again · What I expected · What I saw · Facts |
| `feedback`: "What I think" | What helped, what was in the way, what is missing. | What I used Apostil for · What helped · What was in my way · What I missed · Facts |

You write the headings before Facts. The command adds Facts.

## Steps

1. Pick the kind. When it is not clear, ask: "Is something broken, or is it what you think of Apostil?"
2. Gather what the issue needs. Use what the person already said and what you saw in this session. Ask only for what is missing, one short question at a time.
   - For a fault: what they tried, the steps to see it again, what they expected, what they saw, and the exact error text. Copy the error text from the output. Do not write it from memory.
   - For feedback: what they used Apostil for, what helped, what was in the way, and what they missed.
   - The versions and the lines of `apostil doctor`: run `apostil issue --facts`. Do not ask the person for them.
3. Write the title and the body (see "The form" and "What stays out").
4. Make the final text. With your file tool, write the file `apostil-issue.md` in the top folder of the repo (else in the current folder): its first line is `# ` and the title, then the body. Then run:

   ```
   apostil issue --kind bug --file apostil-issue.md
   ```

   Never put the title or the body into the command itself: a title with a backtick or `$(` would run as a command in the shell. In a repo set up with Apostil, Git does not show the file; elsewhere, never commit it. The command removes it after `--open`.

   The command puts the facts at the end and runs a guard over all of it. The guard replaces the home folder, the user name and the name of the computer with `<home>`, `<user>` and `<computer>`, and e-mail addresses and things that look like keys or tokens with `<removed>`. It prints the final `title`, the `body` and `changed`, the list of what the guard replaced. The guard is a second line of defence: write the text clean yourself first. When `changed` is not empty, look at those places again.
5. Show the whole issue to the person: the title and the whole body, as the command printed it. Say in one line what you left out on purpose, for example "I left out the names of your files and your branch." Then ask: "Shall I open it on GitHub?" Change it as they say, run step 4 again and show it again. Without a yes, nothing goes. When they say no or want to stop, remove `apostil-issue.md` and go back to the work.
6. After the yes, run the same command with `--open`. It opens the browser at GitHub's page for a new issue in the Apostil repo, with the title and the body. When no browser opens, give the person the `address` that the command printed, as a link. Tell the person: "Read it there. Add a picture if you want. Then press Submit new issue." Never press it for them, and never file the issue in another way (no `gh issue create`, no API call).

When the command says that the issue is too long, shorten the body: keep the first and last lines of a long error or output, and cut the rest. Then show it again.

When GitHub says that the page is not found (the repo may not be open to the person) or the person has no GitHub account, give them the text to send to the makers another way.

When the command `apostil` is not there, show the issue as text. Tell the person to run "Apostil: Report an Issue" in VS Code, which opens the same page with the facts, and to paste the text there.

## The form

- One problem in one issue. Two problems are two issues; ask which one comes first.
- A title of a few plain words that names the part and the fault, for example "Notes: a note stands on the wrong lines". No "Bug:" and no "Please".
- The headings in the fixed order, each as `### ` and its words. Under a heading that the person cannot fill, write "Not known".
- Numbered steps, one action each, from a start that anyone can make: a new repo, the example of Apostil, a new window.
- The exact error text in a code block, whole when it is short.
- Plain short sentences. No guess about the cause, unless the person asks for one; then mark it as a guess.

## Made-up names in the steps

The makers must be able to make the same case without seeing the person's work. Describe the shape, not the content:

- "a Python file with one function of 400 lines", not the name of the file;
- "a repo of about 2,000 files in TypeScript and Go", not the name of the repo;
- "a branch with 3 commits that renames a folder", not the name of the branch;
- "a pull request with 40 comments and 2 reviews", not its number or title.

## What stays out

Never put these into the title or the body:

- names of people, user names, e-mail addresses, the name of the computer;
- paths: write `<home>` for the home folder and `<repo>` for the top folder of the repo, and keep only the part of a path that Apostil made, for example `<repo>/.claude/skills/apostil-map-repo`;
- the names of repos, branches, companies, customers and services of the person's work;
- code and the contents of files of their repo, also inside an error text or the text of a note or a diagram;
- commit ids of their repos;
- keys, tokens and passwords;
- anything the person says is private.

Never add a picture. The person may add one on GitHub after they look at it.

The facts of `apostil issue --facts` may stay. They hold versions and the lines of `apostil doctor`; the command replaces any path in those lines with `<path>`.

## An example

The title "Notes: a note stands on the wrong lines", and this body before the command adds the facts:

````
### What I tried
I read the notes beside the code in a repo with a map.

### Steps to see it again
1. In a repo with a map, open a Python file with one function of 400 lines.
2. Add 10 lines above the function and save.
3. Look at the note of the first loop of the function.

### What I expected
The note moves down with its lines.

### What I saw
The note stays on the old lines. The status bar says:
```
Notes: 12 in this file
```
````
