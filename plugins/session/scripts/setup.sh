#!/usr/bin/env bash
set -uo pipefail

# ローカルでは何もしない
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

# 🛡️ セキュリティツール(Semgrep, Gitleaks, Trivy)をインストール
timeout 180 env UV_TOOL_BIN_DIR=/usr/local/bin uv tool install semgrep==1.181.0 >&2 &
curl -sSfL --connect-timeout 10 --max-time 120 https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz \
  | tar -xzf - -C /usr/local/bin gitleaks &
curl -sSfL --connect-timeout 10 --max-time 120 https://github.com/aquasecurity/trivy/releases/download/v0.76.2/trivy_0.76.2_Linux-64bit.tar.gz \
  | tar -xzf - -C /usr/local/bin trivy &

# 🧰 mise.toml があれば、リポジトリが決めたツールを入れる。mise の本体は大きいため、同じ版なら取得し直さない
if [ -f mise.toml ]; then
  SHIMS="${MISE_DATA_DIR:-$HOME/.local/share/mise}/shims"
  export PATH="$SHIMS:$PATH"
  [ -z "${CLAUDE_ENV_FILE:-}" ] || echo "export PATH=\"$SHIMS:\$PATH\"" >> "$CLAUDE_ENV_FILE"
  { [ "$(mise --version 2> /dev/null | cut -d' ' -f1)" = "2026.10.17" ] ||
    { curl -sSfL --connect-timeout 10 --max-time 240 -o /usr/local/bin/mise https://github.com/jdx/mise/releases/download/v2026.10.17/mise-v2026.10.17-linux-x64 &&
      chmod +x /usr/local/bin/mise; }; } &&
    mise trust . > /dev/null && timeout 300 mise install --yes >&2 || echo "⚠️ mise のツールを入れられませんでした。ユーザーに伝えてください"
fi

wait

for t in semgrep gitleaks trivy; do
  "$t" --version > /dev/null 2>&1 || echo "⚠️ $t を入れられませんでした。コミットと push の前の検査は動きません。ユーザーに伝えてください"
done

# 🐳 compose のサービスを起動する。ビルドが入れている途中のツールを読まないよう、最後に行う
bash "$(dirname "$0")/start-services.sh"

exit 0
