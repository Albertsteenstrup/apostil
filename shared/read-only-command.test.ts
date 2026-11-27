// Tests for readsOnly: which shell commands only read files.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readsOnly } from './read-only-command';

const FROM_MAP_RUN = `for d in shared store helper; do echo "== $d"; grep -rhoE "from ['\\"]\\.\\.?/[^'\\"]+['\\"]" "$d" --include='*.ts' | sed -E "s/from //" | sort | uniq -c | sort -rn | head -8; done; echo; cat claude-mod/hooks/hooks.json; cat skills/README.md | head -c 1500`;

test('readsOnly: the command that a map run asked about, pipes, loops, quotes and the redirections that write nothing', () => {
  assert.equal(readsOnly(FROM_MAP_RUN), true);
  for (const command of ['', '   ', 'ls', 'ls -la src | head', 'git log --oneline -5 && git status', 'git -C other diff --stat', 'git --no-pager show HEAD:README.md',
    'cat a.ts 2>/dev/null', 'grep x file > /dev/null', 'ls missing 2>&1', 'echo hi >&2', 'grep -c x <<< "some text"', 'cat < file.txt', 'echo ";" "|" \'&&\' \'$(not run)\' \\$HOME',
    'if [ -f a ]; then cat a; else echo none; fi', 'for f in *.ts; do wc -l "$f"; done', 'find . -name "*.ts" -not -path "./node_modules/*"', 'find src -type f | sort | uniq -c',
    'sed -n "1,20p" file', "sed -n '/error/p' log", "sed 's/a/b/' file", 'awk \'$1 > 5 {print $2}\' file', "sed 's/$/x/' file", 'sort -rn file', 'uniq -c file', 'echo a\\\nb', 'ls # a comment; rm x',
    'echo "a\\"b" | tr a-z A-Z', 'echo "${HOME}/x"', 'apostil find "tests"', 'jq .name package.json', 'git ls-files | wc -l', 'echo ok & ls', 'test -d x || echo none']) {
    assert.equal(readsOnly(command), true, command);
  }
});

test('readsOnly: no for a command that may write, delete or run another program, and for what is too hard to check', () => {
  for (const command of ['rm -rf x', 'ls; rm x', 'ls && rm x', 'ls | xargs rm', 'echo x > file', 'echo x >> file', 'echo x 2> err.txt', 'echo x &> file', 'echo x >| file', 'echo x > /dev/null; echo y > out',
    'echo $(rm x)', 'echo "$(rm x)"', 'echo `rm x`', 'echo "`rm x`"', 'cat <(rm x)', 'echo x > >(tee f)', 'cat <<EOF\nrm x\nEOF', 'ls\nrm x', 'for d in a b; do rm "$d"; done', 'for d in $(ls); do echo; done',
    'sed -i s/a/b/ file', 'sed -i.bak s/a/b/ file', 'sed -ni p file', 'sed --in-place s/a/b/ file', "sed 's/a/b/w out' file", "sed 's/a/b/e' file", "sed -n '1w out' file", "sed -n '/x/w out' file", "sed 'e rm x'", 'sed -f script.sed file', 'sed "$script" file',
    'find . -delete', 'find . -exec rm {} \;', 'find . -execdir rm {} +', 'find . -ok rm {} \;', 'find . -fprint out', 'find . -fprintf out x', 'find . -fls out', 'find . $flag',
    'awk \'BEGIN{system("rm x")}\'', 'awk \'{print > "out"}\' file', 'awk \'{print | "sh"}\' file', 'awk -f prog.awk file', 'sort -o out file', 'sort --output=out file', 'sort -ro out file', 'uniq in out',
    'git push', 'git commit -m x', 'git checkout main', 'git -c core.pager=x log', 'git diff --output=out', 'git grep -O x', 'git', 'git log "$ref"', 'curl example.com', 'env ls', 'sudo ls', 'xargs ls', 'tee f', 'tree -o out',
    'FOO=1 ls', 'FOO=1', '$cmd file', '"$d" file', '(ls)', '{ ls; }', 'case x in x) ls;; esac', 'while true; do rm x; done', 'echo "unfinished', "echo 'unfinished", 'echo trailing\\', 'echo ${x:-$(rm y)}', 'echo $((1+2))', 'rg --pre rm x',
    'bash -c ls', 'sh script.sh', 'python3 x.py', 'cat file | sh', 'cp a b', 'mv a b', 'touch a', 'mkdir a', 'rg x | tee out']) {
    assert.equal(readsOnly(command), false, command);
  }
});
