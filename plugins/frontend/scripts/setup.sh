#!/usr/bin/env bash
# セッションの開始・再開時に、bun の版を揃えて依存を入れるスクリプト
set -uo pipefail

# プラグインのコマンド (biome) をコマンド名だけで呼べるようにする。Mac の mise の biome より先に見つかるよう、先頭に足す
PLUGIN_BIN="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}/bin"
[ -z "${CLAUDE_ENV_FILE:-}" ] || echo "export PATH=\"$PLUGIN_BIN:\$PATH\"" >> "$CLAUDE_ENV_FILE"

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

# 🎨 shadcn/ui の公式スキルはセッションのフォルダで設定を読むため、components.json の場所を Claude に伝える
f=$(git ls-files -- components.json '*/components.json' 2> /dev/null | head -1)
# フォルダ名が Claude への指示として読まれないよう、空白や記号を含むパスは伝えない
case "$f" in *[!A-Za-z0-9._/@-]*) f= ;; esac
[ -z "$f" ] || echo "shadcn/ui の components.json は $f にあります。shadcn の CLI はこのフォルダで実行してください"

# 📐 フロントエンドのリポジトリでは、技術スタックの方針を Claude に伝える。python だけのリポジトリでは出さない
if [ -n "$(git ls-files -- '*package.json' 2> /dev/null)" ]; then
  cat << 'EOF2'
このリポジトリのフロントエンドは、次の技術スタックで書いてください。
- パッケージの管理と実行は bun (bun add / bun run / bunx)。npm・npx・yarn・pnpm は使わない
- lint と整形は Biome。ESLint・Prettier は使わない
- UI は shadcn/ui のコンポーネント (bunx shadcn@latest add) を使う。shadcn/ui に無いものだけ、shadcn/ui を組み合わせて作る
- スタイルは Tailwind CSS のクラスとテーマの変数で書く。style 属性・色コード・Tailwind の任意値 ([#fff] など) は書かない。shadcn/ui が生成したコードは、bunx biome check --write で書式を整えるだけにし、中身は書き換えない
- 画面を足す・変えるときは、Playwright で E2E テストを書く
- このリポジトリが npm・ESLint など上と違う道具を使っていたら、/frontend:setup で移行できるとユーザーに伝える。頼まれるまで移行しない
EOF2
fi

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
