#!/usr/bin/env bash
# Claude が commit する前に、terraform fmt と tflint で検査するスクリプト。
# 問題があれば exit 2 で commit を止め、Claude に直させる
set -uo pipefail

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

FAIL=0
# 🧹 書式。.tf・.tfvars のあるフォルダごとに検査する (Claude が Bash で書いたファイルも見るため)
if command -v terraform > /dev/null 2>&1; then
  while IFS= read -r DIR; do
    if ! R=$(terraform fmt -check -list=true -no-color "$DIR" 2>&1); then
      printf '❌ terraform fmt (%s): 次のファイルを terraform fmt で整えてください\n%s\n' "$DIR" "$R" >&2
      FAIL=1
    fi
  done < <(git ls-files -- '*.tf' '*.tfvars' | sed -e 's|/[^/]*$||' -e 't' -e 's|.*|.|' | sort -u)
fi

# 🔍 tflint。.tflint.hcl があるフォルダで、その下をまとめて検査する
if command -v tflint > /dev/null 2>&1; then
  while IFS= read -r -d '' CONF; do
    DIR=$(dirname -- "$CONF")
    # --recursive では設定のパスをフォルダごとに読むため、絶対パスで渡す
    ABS="$(cd "$DIR" && pwd -P)/.tflint.hcl"
    # プラグインが無いとき (ネットワークが無く入れられなかったなど) は飛ばす。直すべき問題として Claude に伝えないため
    if ! (cd "$DIR" && tflint --init --config "$ABS" > /dev/null 2>&1); then
      echo "⚠️ $CONF のプラグインを入れられないため、tflint を飛ばしました。ユーザーに伝えてください" >&2
      continue
    fi
    if ! R=$(cd "$DIR" && tflint --recursive --config "$ABS" --format compact --no-color 2>&1); then
      printf '❌ tflint (%s):\n%s\n' "$DIR" "$R" >&2
      FAIL=1
    fi
  done < <(git ls-files -z -- .tflint.hcl '*/.tflint.hcl')
fi

[ "$FAIL" = 0 ] || { echo '⚠️ 上の問題を直してから commit してください' >&2; exit 2; }
exit 0
