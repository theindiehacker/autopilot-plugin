#!/usr/bin/env bash
# Claude が commit する前に、golangci-lint と依存の向きの検査 (internal/architecture_test.go) を動かすスクリプト。
# 問題があれば exit 2 で commit を止め、Claude に直させる
set -uo pipefail

command -v go > /dev/null 2>&1 || exit 0
BIN="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}/tools"
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

# Go を使わないリポジトリでは何もしない (golangci-lint をビルドしないため)
[ -n "$(git ls-files -- go.mod '*/go.mod' 2> /dev/null)" ] || exit 0

# Claude が読みやすいよう、出力から色のコードを取り除く (Mac の sed でも動く書き方)
ESC=$(printf '\033')
nocolor() { printf '%s' "$1" | sed "s/${ESC}\[[0-9;]*m//g"; }

# golangci-lint を用意できないとき (ネットワークが無いなど) は lint を飛ばす。直すべき問題として Claude に伝えないため
LINT=1
"$BIN/golangci-lint" --version > /dev/null 2>&1 || LINT=0

# 変えたところだけを lint する (前からある問題で commit を止めないため)。最初の commit の前は全体を見る
NEW=
git rev-parse -q --verify HEAD > /dev/null 2>&1 && NEW=--new-from-rev=HEAD

FAIL=0
# 📦 go.mod のあるフォルダごとに検査する
while IFS= read -r -d '' MOD; do
  DIR=$(dirname -- "$MOD")

  # 🔍 lint (.golangci.yml があれば、その設定で動く)
  if [ "$LINT" = 1 ] && ! R=$(cd "$DIR" && "$BIN/golangci-lint" run ${NEW:+"$NEW"} ./... 2>&1); then
    printf '❌ golangci-lint (%s):\n%s\n' "$DIR" "$(nocolor "$R")" >&2
    FAIL=1
  fi

  # 🧱 依存の向き。テンプレートを置いたときだけ動かす
  if [ -f "$DIR/internal/architecture_test.go" ] &&
    ! R=$(cd "$DIR" && go test -count=1 -run '^TestArchitecture' ./internal/ 2>&1); then
    printf '❌ internal/architecture_test.go (%s):\n%s\n' "$DIR" "$(nocolor "$R")" >&2
    FAIL=1
  fi
done < <(git ls-files -z -- go.mod '*/go.mod')

[ "$FAIL" = 0 ] || { echo '⚠️ 上の問題を直してから commit してください' >&2; exit 2; }
exit 0
