#!/usr/bin/env bash
# Claude が .go を編集したあとに、gofmt で整えるスクリプト。
# 構文の誤りで整えられなければ exit 2 で Claude に伝え、直させる (編集は取り消さない)
set -uo pipefail

# 📝 フックの入力から、編集したファイルを取り出す。jq は Mac に無いことがあるため、sed で読む
FILE=$(sed -n 's/.*"file_path": *"\([^"]*\)".*/\1/p' | head -1)
case "$FILE" in *.go) ;; *) exit 0 ;; esac
case "$FILE" in /*) ;; *) FILE="$PWD/$FILE" ;; esac
[ -f "$FILE" ] && [ ! -L "$FILE" ] || exit 0

# プロジェクトの外は見ない (よそのフォルダのファイルを書き換えないため)。.. とシンボリックリンクを解決して比べる
ROOT=$(cd -P -- "${CLAUDE_PROJECT_DIR:-$PWD}" && pwd -P) || exit 0
DIR=$(cd -P -- "$(dirname -- "$FILE")" && pwd -P) || exit 0
FILE="$DIR/$(basename -- "$FILE")"
case "$FILE" in "$ROOT"/*) ;; *) exit 0 ;; esac

# gofmt は Go に付いている。PATH に無ければ Go の中を探し、無ければ何もしない
GOFMT=$(command -v gofmt 2> /dev/null) || GOFMT="$(go env GOROOT 2> /dev/null)/bin/gofmt"
[ -x "$GOFMT" ] || exit 0

# 🧹 整える。整えられないとき (構文の誤り) だけを Claude に伝える
OUT=$("$GOFMT" -w -- "$FILE" 2>&1) && exit 0
printf '⚠️ %s に問題が残っています。直してください\n%s\n' "$FILE" "$OUT" >&2
exit 2
