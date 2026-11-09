#!/usr/bin/env bash
# Claude が .py を編集したあとに、ruff で整えてから、ruff と ty で検査するスクリプト。
# 直せない問題が残ったら exit 2 で Claude に伝え、直させる (編集は取り消さない)
set -uo pipefail

export PATH="$HOME/.local/bin:$PATH"
command -v uv > /dev/null 2>&1 || exit 0

# 📝 フックの入力から、編集したファイルを取り出す。jq は Mac に無いことがあるため、uv の Python で読む
FILE=$(uv run --no-project --no-config --quiet python -I -c \
  'import json, sys; print(json.load(sys.stdin).get("tool_input", {}).get("file_path", ""))' 2> /dev/null) || exit 0
case "$FILE" in *.py | *.pyi) ;; *) exit 0 ;; esac
case "$FILE" in /*) ;; *) FILE="$PWD/$FILE" ;; esac
[ -f "$FILE" ] && [ ! -L "$FILE" ] || exit 0

# プロジェクトの外は見ない (よそのフォルダの設定や .venv の ruff を動かさないため)。.. とシンボリックリンクを解決して比べる
ROOT=$(cd -P -- "${CLAUDE_PROJECT_DIR:-$PWD}" && pwd -P) || exit 0
DIR=$(cd -P -- "$(dirname -- "$FILE")" && pwd -P) || exit 0
FILE="$DIR/$(basename -- "$FILE")"
case "$FILE" in "$ROOT"/*) ;; *) exit 0 ;; esac

# 📂 pyproject.toml のあるフォルダで動かす。設定と .venv をそこから読む。無ければ何もしない
until [ -f "$DIR/pyproject.toml" ]; do
  [ "$DIR" != "$ROOT" ] || exit 0
  DIR=$(dirname -- "$DIR")
done
cd "$DIR" || exit 0

# プロジェクトの .venv の版を優先し、無ければプラグインで入れた版を使う
tool() { if [ -x ".venv/bin/$1" ]; then echo ".venv/bin/$1"; else command -v "$1"; fi; }
RUFF=$(tool ruff)
TY=$(tool ty)

# 🧹 整えて、直せるものは直す。残った問題だけを Claude に伝える
OUT=""
if [ -n "$RUFF" ]; then
  # ruff の推奨の順 (check --fix → format)。報告は整えた後の状態で出す
  "$RUFF" check --fix --force-exclude --quiet -- "$FILE" > /dev/null 2>&1
  "$RUFF" format --force-exclude --quiet -- "$FILE" > /dev/null 2>&1
  R=$("$RUFF" check --force-exclude --quiet --output-format concise -- "$FILE" 2>&1) || OUT+="ruff check:"$'\n'"$R"$'\n'
fi
if [ -n "$TY" ]; then
  R=$("$TY" check --output-format concise -- "$FILE" 2>&1) || OUT+="ty check:"$'\n'"$R"$'\n'
fi
[ -z "$OUT" ] && exit 0
printf '⚠️ %s に問題が残っています。直してください\n%s' "$FILE" "$OUT" >&2
exit 2
