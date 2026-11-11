#!/usr/bin/env bash
# セッションの初期化・再開時に実行されるスクリプト
set -uo pipefail

# 🛡️ Web ではセキュリティツール(Semgrep, Gitleaks, Trivy)をインストール。ローカルでは入れず、無ければ伝えるだけにする
if [ "${CLAUDE_CODE_REMOTE:-}" = "true" ]; then
  if ! semgrep --version > /dev/null 2>&1; then
    timeout 180 env UV_TOOL_BIN_DIR=/usr/local/bin uv tool install semgrep==1.183.0 >&2 &
  fi
  if ! gitleaks --version > /dev/null 2>&1; then
    curl -sSfL --connect-timeout 10 --max-time 120 \
      https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz \
      | tar -xzf - -C /usr/local/bin gitleaks &
  fi
  if ! trivy --version > /dev/null 2>&1; then
    curl -sSfL --connect-timeout 10 --max-time 120 \
      https://github.com/aquasecurity/trivy/releases/download/v0.76.2/trivy_0.76.2_Linux-64bit.tar.gz \
      | tar -xzf - -C /usr/local/bin trivy &
  fi
  wait
fi

for t in semgrep gitleaks trivy; do
  if ! command -v "$t" > /dev/null 2>&1; then
    echo "⚠️ $t がありません。コミットと push の前の検査は動きません。ユーザーに伝えてください (ローカルの Mac は brew install $t で入れられます)"
  elif ! "$t" --version > /dev/null 2>&1; then
    echo "⚠️ $t は入っていますが、起動できません。コミットと push の前の検査は動きません。ユーザーに伝えてください ($t --version で原因を確かめられます)"
  fi
done
