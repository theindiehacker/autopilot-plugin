#!/usr/bin/env bash
# セッションの初期化・再開時に実行されるスクリプト
set -uo pipefail

# ローカルでは何もしない
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

# 🐳 Docker デーモンを起動
dockerd --registry-mirror=https://mirror.gcr.io >> /tmp/dockerd.log 2>&1 &

# 🧰 mise.toml があれば、インストールする
if [ -f mise.toml ]; then
  # mise で入れたツールをコマンド名だけで呼べるようにする
  SHIMS="${MISE_DATA_DIR:-$HOME/.local/share/mise}/shims"
  export PATH="$SHIMS:$PATH"
  [ -z "${CLAUDE_ENV_FILE:-}" ] || echo "export PATH=\"$SHIMS:\$PATH\"" >> "$CLAUDE_ENV_FILE"

  if ! mise --version > /dev/null 2>&1; then
    curl -sSfL --connect-timeout 10 --max-time 240 -o /usr/local/bin/mise \
      https://github.com/jdx/mise/releases/download/v2026.11.2/mise-v2026.11.2-linux-x64 &&
      chmod +x /usr/local/bin/mise
  fi
  # ツールは mise.toml で変わるため、mise があっても毎回確かめる
  mise trust . > /dev/null &&
    timeout 300 mise install --yes >&2 ||
    echo "⚠️ mise のツールを入れられませんでした。ユーザーに伝えてください"
fi

# 🐳 compose のサービスを起動する。ビルドが入れている途中のツールを読まないよう、最後に行う
COMPOSE=""
for f in compose.yaml compose.yml docker-compose.yaml docker-compose.yml; do
  [ -f "$f" ] && COMPOSE=$f && break
done
[ -n "$COMPOSE" ] || exit 0

# Docker ビルドできるように compose.proxy-ca.yaml 作成
DIR="$PWD/.claude/session"
FILES="$PWD/$COMPOSE"
for f in compose.override.yaml compose.override.yml docker-compose.override.yaml docker-compose.override.yml; do
  [ -f "$f" ] && FILES="$FILES:$PWD/$f" && break
done
if mkdir -p "$DIR" && cp -r "$(dirname "$0")/session/." "$DIR" && cp "${SSL_CERT_FILE:-}" "$DIR/proxy-ca.crt" &&
  COMPOSE_FILE="$FILES" COMPOSE_PROFILES='*' docker compose config --format json |
  python3 "$(dirname "$0")/compose-proxy-ca.py" > "$DIR/compose.proxy-ca.yaml"; then
  export COMPOSE_FILE="$FILES:$DIR/compose.proxy-ca.yaml"
  LINE="export COMPOSE_FILE=\"$COMPOSE_FILE\""
  [ -z "${CLAUDE_ENV_FILE:-}" ] || grep -qxF "$LINE" "$CLAUDE_ENV_FILE" 2> /dev/null || echo "$LINE" >> "$CLAUDE_ENV_FILE"
else
  echo "⚠️ ビルドにプロキシの CA を渡せませんでした" >&2
fi

for _ in $(seq 30); do docker info > /dev/null 2>&1 && break; sleep 1; done
timeout -k 10 300 docker compose up --build -d --wait --wait-timeout 290 >&2 ||
  echo "${COMPOSE} のサービスを起動できませんでした (時間切れを含む)。docker compose up --build -d --wait を実行し、エラーを確かめてください。リポジトリ側の問題なら、/autopilot:setup で直せるとユーザーに伝えてください。頼まれるまで直さないでください。"

exit 0
