#!/usr/bin/env bash
# compose のサービスを起動するスクリプト (setup.sh から実行される)
set -uo pipefail

# ローカルでは何もしない
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

COMPOSE=""
for f in compose.yaml compose.yml docker-compose.yaml docker-compose.yml; do
  [ -f "$f" ] && COMPOSE=$f && break
done
[ -n "$COMPOSE" ] || exit 0

# 🔐 ビルドにプロキシの CA を secret の ca-certificates で渡す
DIR="$PWD/.claude/session"
FILES="$PWD/$COMPOSE"
for f in compose.override.yaml compose.override.yml docker-compose.override.yaml docker-compose.override.yml; do
  [ -f "$f" ] && FILES="$FILES:$PWD/$f" && break
done
SERVICES=$(COMPOSE_FILE="$FILES" COMPOSE_PROFILES='*' docker compose config --format json |
  jq -r '.services | to_entries[] | select(.value.build) | .key')
if [ -n "$SERVICES" ] && mkdir -p "$DIR" && echo '*' > "$DIR/.gitignore" && cp "${SSL_CERT_FILE:-}" "$DIR/proxy-ca.crt" &&
  cp "$(dirname "$0")/../templates/compose.proxy-ca.yaml" "$DIR/compose.proxy-ca.yaml"; then
  for s in $SERVICES; do
    printf '  %s:\n    build:\n      secrets: [ca-certificates]\n' "$s" >> "$DIR/compose.proxy-ca.yaml"
  done
  export COMPOSE_FILE="$FILES:$DIR/compose.proxy-ca.yaml"
  LINE="export COMPOSE_FILE=\"$COMPOSE_FILE\""
  [ -z "${CLAUDE_ENV_FILE:-}" ] || grep -qxF "$LINE" "$CLAUDE_ENV_FILE" 2> /dev/null || echo "$LINE" >> "$CLAUDE_ENV_FILE"
elif [ -n "$SERVICES" ]; then
  echo "⚠️ ビルドにプロキシの CA を渡せませんでした" >&2
fi

# 🚀 サービスを起動する
for _ in $(seq 30); do docker info > /dev/null 2>&1 && break; sleep 1; done
timeout -k 10 300 docker compose up --build -d --wait --wait-timeout 290 >&2 ||
  echo "${COMPOSE} のサービスを起動できませんでした (時間切れを含む)。docker compose up --build -d --wait を実行し、エラーを確かめてください。"

exit 0
