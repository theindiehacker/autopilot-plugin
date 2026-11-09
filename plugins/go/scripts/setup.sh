#!/usr/bin/env bash
# セッションの開始・再開時に、Go の依存を入れ、golangci-lint と gopls を先にビルドしておくスクリプト
set -uo pipefail

# プラグインのコマンド (golangci-lint) をコマンド名だけで呼べるようにする。ほかで入れた golangci-lint より先に見つかるよう、先頭に足す
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
PLUGIN_BIN="$PLUGIN_ROOT/tools"
[ -z "${CLAUDE_ENV_FILE:-}" ] || echo "export PATH=\"$PLUGIN_BIN:\$PATH\"" >> "$CLAUDE_ENV_FILE"

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

# Go を使わないリポジトリでは何もしない
[ -n "$(git ls-files -- go.mod '*/go.mod' 2> /dev/null)" ] || exit 0

# 📐 技術スタックの方針を Claude に伝える
cat << 'EOF2'
このリポジトリの Go は、次の技術スタックで書いてください。
- 整形は gofmt、lint は golangci-lint (設定は .golangci.yml)
- モジュールの構成と依存の向きは、architecture:standard スキルの標準 (モジュラモノリス + ヘキサゴナル) に従う。import の向きは internal/architecture_test.go で検査する
- 機能を足す・変えるときは、go test でテストを書く
- このリポジトリに .golangci.yml や internal/architecture_test.go が無ければ、/architecture:standard で足せるとユーザーに伝える。頼まれるまで足さない
EOF2

if ! go version > /dev/null 2>&1; then
  echo "⚠️ go がありません。Go の検査は動きません。ユーザーに伝えてください (ローカルの Mac は brew install go で入れられます)"
  exit 0
fi

# 📦 go.mod の版で依存を入れる
git ls-files -z -- go.mod '*/go.mod' | xargs -0 -n1 dirname -- | while IFS= read -r d; do
  (cd "$d" && go mod download) >&2 || echo "⚠️ $d の依存を入れられませんでした。ユーザーに伝えてください"
done

# 🔨 golangci-lint と gopls を先にビルドしておく (初めての検査と LSP の起動を待たせないため)。gopls の版は plugin.json から読む
GOPLS=$(sed -n 's/.*"\(golang\.org\/x\/tools\/gopls@v[^"]*\)".*/\1/p' "$PLUGIN_ROOT/.claude-plugin/plugin.json" | head -1)
"$PLUGIN_BIN/golangci-lint" --version > /dev/null 2>&1 &
[ -z "$GOPLS" ] || go run "$GOPLS" version > /dev/null 2>&1 &
wait
"$PLUGIN_BIN/golangci-lint" --version > /dev/null 2>&1 ||
  echo "⚠️ golangci-lint を用意できませんでした。commit の前の lint は動きません。ユーザーに伝えてください"

exit 0
