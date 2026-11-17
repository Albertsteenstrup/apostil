---
name: apostil-review-remarks
description: Use when the owner says "address my remarks", or points at something that he selected or commented on in Apostil. It gets the remarks and acts on each at its place.
---

# Act on the owner's remarks

In Apostil, the owner adds a remark to the thing he looks at: a part, a note, a diagram or one of its nodes and arrows, a file, a test or some code lines. A remark can be a question, a request or a doubt. Apostil keeps each remark with its place.

## Steps

1. Get the review context.
   - Helper tool: `review_context` with `folder` set to your worktree and `mark_sent` true.
   - Command: `apostil context --mark-sent`.
   - You get the open change, what the owner has open and selected, the unsent remarks (each with its `id` and `state`) and the open points of the fresh check.
   - `mark_sent` marks the remarks as sent, so the next call does not repeat them. If you only want to look, call without it.
2. Go through the remarks one at a time. For each remark:
   - Read its place: a part, a note, a diagram, a file with lines.
   - `about` says what the owner pointed at; answer about that thing.
   - Open that place in the code. For a diagram, use the skill `apostil-read-diagrams`.
   - Decide what the remark asks:
     - A question: answer it from the code.
     - A request: make the change.
     - A doubt about the notes or the diagram: check the code. Fix the code if it is wrong. If the notes are wrong, the change file needs an update (see step 4).
3. Do not touch anything that no remark points at.
4. If you changed files, run the skill `apostil-describe-change` again, so the change file matches the code.
5. Answer each remark in the chat (see below), and also store the answer in Apostil: run `apostil answer <id> "<one to three sentences>"`, or use the helper tool `answer_remark` (`folder`, `id`, `text`). The id is in the context. Apostil then marks the remark as done. The answer goes to the remark that was sent, also when it is a reply inside a thread; `earlier` holds what the thread said before it.
6. When a remark asked for a change and you made it and answered, resolve its thread: `apostil resolve <id>`. Leave a question open for the owner.

## How to answer

Answer in the chat, one short block for each remark. Start with the place, for example "Note: Skip a missing author". Then say what you did or found, in one to three sentences. Name the file and lines that changed. If you did not act, say why in plain words. A remark that you cannot act on also gets a stored answer that says why.

Write short sentences, in active voice. One word for one thing. No praise and no apology.

## Open points

The context also lists open points: notes that the code does not support, and behaviour that no note mentions. Treat an open point as a remark when the owner turned it into one. Otherwise, mention it only when it affects a remark.

## When there is nothing

If the context holds no remarks and no selection, say so in one line. Do not guess what the owner meant.
