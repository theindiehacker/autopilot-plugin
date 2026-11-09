#!/usr/bin/env bash
# git に入るファイルだけを一時フォルダに写して、そこで検査のコマンドを動かすスクリプト。
# gitleaks と trivy は .gitignore を見ないため、そのまま動かすと .env やビルドの生成物で commit・push が止まる
set -uo pipefail
cd "$CLAUDE_PROJECT_DIR" || exit 0

# 追跡中のファイルと、無視していない新規ファイルを写す (git add -A && git commit では、hook が add より先に動くため)。
# 消した追跡中のファイルは tar のエラーになるので、一覧から除く
copy() {
  git ls-files -coz --exclude-standard |
    while IFS= read -r -d '' f; do
      if [ -e "$f" ] || [ -L "$f" ]; then printf '%s\0' "$f"; fi
    done |
    tar --null --no-recursion -T - -cf - 2> /dev/null | tar -xf - -C "$1" 2> /dev/null
}

# git のリポジトリでないフォルダは、全体を検査する。写せないときも、検査を素通りさせないよう全体を検査する
if git rev-parse --is-inside-work-tree > /dev/null 2>&1; then
  TMP=$(mktemp -d) && trap 'rm -rf "$TMP"' EXIT && copy "$TMP" && cd "$TMP" ||
    echo '⚠️ git に入るファイルを一時フォルダに写せなかったので、フォルダ全体を検査します' >&2
fi

"$@" 1>&2
