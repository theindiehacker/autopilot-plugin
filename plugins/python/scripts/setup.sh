#!/usr/bin/env bash
# セッションの開始・再開時に、uv・ruff・ty を揃え、依存を入れるスクリプト
set -uo pipefail

# uv で入れたツールと、プラグインのコマンド (deptry・lint-imports) をコマンド名だけで呼べるようにする
BIN="$HOME/.local/bin"
PLUGIN_BIN="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}/bin"
export PATH="$PLUGIN_BIN:$BIN:$PATH" UV_TOOL_BIN_DIR="$BIN" UV_INSTALL_DIR="$BIN"
[ -z "${CLAUDE_ENV_FILE:-}" ] || echo "export PATH=\"$PLUGIN_BIN:\$HOME/.local/bin:\$PATH\"" >> "$CLAUDE_ENV_FILE"

# 🐍 uv が無ければ入れる。シェルの設定ファイルは書き換えない
if ! uv --version > /dev/null 2>&1; then
  curl -sSfL --connect-timeout 10 --max-time 120 \
    https://github.com/astral-sh/uv/releases/download/0.13.6/uv-installer.sh |
    env UV_NO_MODIFY_PATH=1 sh >&2
fi

# 🧰 ruff・ty を版を固定して入れる。リポジトリの uv の設定を読まないよう、ホームで実行する
(
  cd "$HOME" || exit 0
  uv tool install ruff==0.17.3 >&2
  uv tool install ty==0.0.95 >&2
)

for t in uv ruff ty; do
  command -v "$t" > /dev/null 2>&1 || echo "⚠️ $t がありません。ユーザーに伝えてください"
done

# 📦 lock ファイルの版で依存を入れる
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
git ls-files -z -- '*uv.lock' | xargs -0r -n1 dirname -- | xargs -r -I{} uv sync --locked --directory {} >&2 ||
  echo '⚠️ 依存を入れられませんでした。ユーザーに伝えてください'

exit 0
