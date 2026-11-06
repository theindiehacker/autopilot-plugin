#!/usr/bin/env bash
# セッションの開始・再開時に、bun の版を揃えて依存を入れるスクリプト
set -uo pipefail

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

# 🎨 shadcn/ui の公式スキルはセッションのフォルダで設定を読むため、components.json の場所を Claude に伝える
f=$(git ls-files -- components.json '*/components.json' 2> /dev/null | head -1)
[ -z "$f" ] || echo "shadcn/ui の components.json は $f にあります。shadcn の CLI はこのフォルダで実行してください"

# bun を使わないリポジトリでは何もしない
[ -n "$(git ls-files '*bun.lock' 2> /dev/null)" ] || exit 0

# npm で入れた bun をコマンド名だけで呼べるようにする
export PATH="$HOME/.local/bin:$PATH"
[ -z "${CLAUDE_ENV_FILE:-}" ] || echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$CLAUDE_ENV_FILE"

# 🔍 使う版を package.json の packageManager から読む。
# npm に渡すので、数字で始まる数字と . だけを取り出す (URL・npm: の別名・. などのパスで任意のパッケージを入れられるため)
V=$(git ls-files -z -- '*package.json' | xargs -0 sed -n -e 's/.*"packageManager": *"bun@\([0-9][0-9.]*\).*/\1/p' -- | head -1)

# 🥟 版が違うときだけ bun を入れる。Web の既定のネットワークでは bun.sh が通らないため、npm を使う
[ -z "$V" ] || [ "$(bun --version 2> /dev/null)" = "$V" ] || npm i -g --prefix "$HOME/.local" "bun@$V" >&2

# 📦 lock ファイルの版で依存を入れる
git ls-files -z -- '*bun.lock' | xargs -0 -n1 dirname -- | xargs -I{} bun install --frozen-lockfile --cwd {} >&2 ||
  echo "⚠️ 依存を入れられませんでした。ユーザーに伝えてください"

exit 0
