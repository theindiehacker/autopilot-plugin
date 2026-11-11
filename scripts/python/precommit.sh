#!/usr/bin/env bash
# Claude が commit する前に、deptry と import-linter で検査するスクリプト。
# 問題があれば exit 2 で commit を止め、Claude に直させる
set -uo pipefail

export PATH="$HOME/.local/bin:$PATH"
command -v uv > /dev/null 2>&1 || exit 0
BIN="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}/tools"
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

# Claude が読みやすいよう、出力から色のコードを取り除く (Mac の sed でも動く書き方)
ESC=$(printf '\033')
nocolor() { printf '%s' "$1" | sed "s/${ESC}\[[0-9;]*m//g"; }

FAIL=0
# 📦 uv.lock のあるフォルダごとに検査する (setup.sh の uv sync と同じ対象)
while IFS= read -r -d '' LOCK; do
  DIR=$(dirname -- "$LOCK")

  # 🔍 依存の過不足 (使っていない依存・宣言していない import など)。
  # src レイアウトでは src を渡す (. を渡すと、自分のパッケージを宣言していない依存と見なす)
  ROOT=.
  [ ! -d "$DIR/src" ] || ROOT=src
  if ! R=$(cd "$DIR" && "$BIN/deptry" "$ROOT" 2>&1); then
    printf '❌ deptry (%s):\n%s\n' "$DIR" "$(nocolor "$R")" >&2
    FAIL=1
  fi

  # 🧱 import の契約。設定があるときだけ動かす
  if [ -f "$DIR/.importlinter" ] ||
    grep -qs '^\[importlinter' "$DIR/setup.cfg" ||
    grep -qs '^\[tool\.importlinter' "$DIR/pyproject.toml"; then
    if ! R=$(cd "$DIR" && "$BIN/lint-imports" 2>&1); then
      printf '❌ lint-imports (%s):\n%s\n' "$DIR" "$(nocolor "$R")" >&2
      FAIL=1
    fi
  fi
done < <(git ls-files -z -- '*uv.lock')

[ "$FAIL" = 0 ] || { echo '⚠️ 上の問題を直してから commit してください' >&2; exit 2; }
exit 0
