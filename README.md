<img src="design/logo/apostil-icon.svg" width="72" alt="">

# Apostil

Understand what coding agents write. An agent draws a map of your repo and writes notes beside the code. Apostil checks them against the code and shows them in VS Code.

https://github.com/user-attachments/assets/c0450212-1249-4625-94b0-078eebad01c3

## Install

1. Download the `.vsix` file from the [latest release](../../releases/latest).
2. In VS Code, press Cmd+Shift+P and run **Extensions: Install from VSIX…**
3. Open a repo and click the Apostil icon at the left.

## What a first map costs

For each 1,000 lines of code (tests included), a first map uses about 2.5M input tokens, mostly read from the cache, and 80k output tokens. That is about $0.25 at API prices, with Claude Code at medium effort (Sonnet leads, Haiku writes).

| Lines of code | Input tokens | Output tokens |
|---|---|---|
| 10,000 | about 25M | about 0.8M |
| 25,000 | about 60M | about 2M |
| 100,000 | about 250M | about 8M |

Measured on two public repos of 12,000 and 24,000 lines. The last row is an estimate.

## Choose what Apostil maps

A file `.apostilignore` at the top of the repo chooses which files get notes. It reads like `.gitignore`: a line gives the files that it matches only their path, and a line that starts with `!` gives them notes, also files that Apostil leaves out by itself. The last line that matches a file wins, and `apostil why <path>` says which line decides.

```gitignore
# Leave the old admin pages out of the map
old-admin/
# Give the JSON schemas notes too
!config/schemas/*.json
```

## Licence

Apostil has no licence. You can read the code here; all rights are reserved.
