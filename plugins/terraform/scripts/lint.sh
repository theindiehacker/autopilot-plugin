#!/usr/bin/env bash
# Claude が .tf・.tfvars を編集したあとに、terraform fmt で整えるスクリプト。
# 構文の誤りで整えられなければ exit 2 で Claude に伝え、直させる (編集は取り消さない)
set -uo pipefail

command -v terraform > /dev/null 2>&1 || exit 0

# 📝 フックの入力から、編集したファイルを取り出す。jq は Mac に無いことがあるため、sed で読む
FILE=$(sed -n 's/.*"file_path": *"\([^"]*\)".*/\1/p' | head -1)
case "$FILE" in *.tf | *.tfvars | *.tftest.hcl) ;; *) exit 0 ;; esac
case "$FILE" in /*) ;; *) FILE="$PWD/$FILE" ;; esac
[ -f "$FILE" ] && [ ! -L "$FILE" ] || exit 0

# プロジェクトの外は見ない (よそのフォルダのファイルを書き換えないため)。.. とシンボリックリンクを解決して比べる
ROOT=$(cd -P -- "${CLAUDE_PROJECT_DIR:-$PWD}" && pwd -P) || exit 0
DIR=$(cd -P -- "$(dirname -- "$FILE")" && pwd -P) || exit 0
FILE="$DIR/$(basename -- "$FILE")"
case "$FILE" in "$ROOT"/*) ;; *) exit 0 ;; esac

# 🧹 整える。整えられないとき (構文の誤り) だけを Claude に伝える
OUT=$(terraform fmt -no-color "$FILE" 2>&1 > /dev/null) && exit 0
printf '⚠️ %s に問題が残っています。直してください\n%s\n' "$FILE" "$OUT" >&2
exit 2
