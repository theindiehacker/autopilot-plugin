#!/usr/bin/env bash
# Claude がファイルを編集したあとに、biome で整えて検査するスクリプト。
# 直せない問題が残ったら exit 2 で Claude に伝え、直させる (編集は取り消さない)
set -uo pipefail

BIOME="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}/bin/biome"

# 📝 フックの入力から、編集したファイルを取り出す。jq は Mac に無いことがあるため、sed で読む
FILE=$(sed -n 's/.*"file_path": *"\([^"]*\)".*/\1/p' | head -1)
[ -f "$FILE" ] && [ ! -L "$FILE" ] || exit 0

# プロジェクトの外は見ない (よそのフォルダの設定や biome を動かさないため)。.. とシンボリックリンクを解決して比べる
ROOT=$(cd -P -- "${CLAUDE_PROJECT_DIR:-$PWD}" && pwd -P) || exit 0
DIR=$(cd -P -- "$(dirname -- "$FILE")" && pwd -P) || exit 0
FILE="$DIR/$(basename -- "$FILE")"
case "$FILE" in "$ROOT"/*) ;; *) exit 0 ;; esac

# 📂 biome の設定があるフォルダで動かす。無ければ何もしない (既定のタブ書式で書き換えないため)
until [ -f "$DIR/biome.json" ] || [ -f "$DIR/biome.jsonc" ]; do
  [ "$DIR" != "$ROOT" ] || exit 0
  DIR=$(dirname -- "$DIR")
done
cd "$DIR" || exit 0

# biome を動かせないとき (Mac で node の版が決まっていないなど) は何もしない。直すべき問題として Claude に伝えないため
"$BIOME" --version > /dev/null 2>&1 || exit 0

# 🧹 整えて、直せるものは直す。残った問題だけを Claude に伝える
OUT=$("$BIOME" check --write --no-errors-on-unmatched --files-ignore-unknown=true --colors=off --reporter=concise -- "$FILE" 2>&1) && exit 0
printf '⚠️ %s に問題が残っています。直してください\n%s\n' "$FILE" "$OUT" >&2
exit 2
