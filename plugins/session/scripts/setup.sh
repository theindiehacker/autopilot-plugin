#!/usr/bin/env bash
set -uo pipefail

# ローカルでは何もしない（ローカルは task init などでセットアップする）
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

# 🛡️ セキュリティツール(Semgrep, Gitleaks, Trivy)をインストール
uv tool install semgrep
GOBIN=/usr/local/bin go install github.com/zricethezav/gitleaks/v8@latest
curl -sSfL https://github.com/aquasecurity/trivy/releases/download/v0.76.2/trivy_0.76.2_Linux-64bit.tar.gz \
  | tar -xzf - -C /usr/local/bin trivy
