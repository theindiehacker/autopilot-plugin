#!/usr/bin/env bash
# Claude が commit する前に、TypeScript の型を検査するスクリプト。
# 問題があれば exit 2 で commit を止め、Claude に直させる
set -uo pipefail

# setup.sh が npm で入れた bun をコマンド名だけで呼べるようにする
export PATH="$HOME/.local/bin:$PATH"
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

# Claude が読みやすいよう、出力から色のコードを取り除く (Mac の sed でも動く書き方)
ESC=$(printf '\033')
nocolor() { printf '%s' "$1" | sed "s/${ESC}\[[0-9;]*m//g"; }

# プロジェクトに入っている tsc を探す (プロジェクトの版で検査するため)。monorepo で巻き上げた tsc も見る
findtsc() {
  d=$(cd -P -- "$1" && pwd -P) || return 1
  while [ "$d" != / ]; do
    [ -x "$d/node_modules/.bin/tsc" ] && { echo "$d/node_modules/.bin/tsc"; return 0; }
    # リポジトリの外は見ない (よそのフォルダの tsc を動かさないため)
    [ ! -e "$d/.git" ] || break
    d=$(dirname -- "$d")
  done
  return 1
}

FAIL=0
# 📦 tsconfig.json のあるフォルダごとに検査する
while IFS= read -r -d '' CONF; do
  DIR=$(dirname -- "$CONF")

  # 🔍 typecheck スクリプトがあれば、それを使う (Next.js の型の生成などを任せるため)。無ければ tsc で検査する
  if grep -qs '"typecheck" *:' "$DIR/package.json" && command -v bun > /dev/null 2>&1; then
    NAME="bun run typecheck"
    R=$(cd "$DIR" && bun run typecheck 2>&1)
  elif TSC=$(findtsc "$DIR"); then
    NAME="tsc --noEmit"
    R=$(cd "$DIR" && "$TSC" --noEmit --pretty false 2>&1)
  else
    continue
  fi || {
    printf '❌ %s (%s):\n%s\n' "$NAME" "$DIR" "$(nocolor "$R")" >&2
    FAIL=1
  }
done < <(git ls-files -z -- tsconfig.json '*/tsconfig.json' 2> /dev/null)

[ "$FAIL" = 0 ] || { echo '⚠️ 上の型の問題を直してから commit してください' >&2; exit 2; }
exit 0
