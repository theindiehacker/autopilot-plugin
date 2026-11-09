#!/usr/bin/env bash
# git に入るファイルだけを一時フォルダに写して、そこで検査のコマンドを動かすスクリプト。
# gitleaks と trivy は .gitignore を見ないため、そのまま動かすと .env やビルドの生成物で commit・push が止まる
set -uo pipefail
cd "$CLAUDE_PROJECT_DIR" || exit 0

# git のリポジトリでないフォルダは、全体を検査する
if git rev-parse --is-inside-work-tree > /dev/null 2>&1; then
  TMP=$(mktemp -d) || exit 0
  trap 'rm -rf "$TMP"' EXIT
  # 追跡中のファイルと、無視していない新規ファイルを写す (git add -A && git commit では、hook が add より先に動くため)。
  # 消した追跡中のファイルは tar のエラーになるが、写さなくてよいので無視する
  git ls-files -coz --exclude-standard | tar --null --no-recursion -T - -cf - 2> /dev/null | tar -xf - -C "$TMP" 2> /dev/null
  cd "$TMP" || exit 0
fi

"$@" 1>&2
