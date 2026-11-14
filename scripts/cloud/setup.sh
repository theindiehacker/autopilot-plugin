#!/usr/bin/env bash
# セッションの初期化・再開時に実行されるスクリプト
set -uo pipefail

# ローカルでは何もしない
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

# 🐳 Docker デーモンを起動する。再開時に残った pid ファイルがあると、dockerd が containerd を待って止まるため消す
if ! docker info > /dev/null 2>&1 && ! pgrep -x dockerd > /dev/null; then
  rm -f /var/run/docker/containerd/containerd.pid /var/run/docker.pid
  dockerd --registry-mirror=https://mirror.gcr.io >> /tmp/dockerd.log 2>&1 &
fi

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

# 🪝 git の hook (commit 前・push 前の検査) を入れる。hook の中身はリポジトリの設定にある
if [ -f lefthook.yml ] || [ -f lefthook.yaml ] || [ -f .lefthook.yml ]; then
  # PATH → node_modules → bunx の順に探す
  if command -v lefthook > /dev/null 2>&1; then LH=lefthook
  elif [ -x node_modules/.bin/lefthook ]; then LH=node_modules/.bin/lefthook
  elif command -v bun > /dev/null 2>&1; then LH="bunx lefthook"
  else LH=""; fi
  { [ -n "$LH" ] && $LH install > /dev/null 2>&1; } || echo "⚠️ lefthook install を行えませんでした。commit・push の検査が動きません。ユーザーに伝えてください" >&2
elif [ -f .pre-commit-config.yaml ]; then
  if command -v pre-commit > /dev/null 2>&1; then PC=pre-commit
  elif command -v uv > /dev/null 2>&1; then PC="uvx pre-commit"
  else PC=""; fi
  { [ -n "$PC" ] && $PC install > /dev/null 2>&1; } || echo "⚠️ pre-commit install を行えませんでした。commit・push の検査が動きません。ユーザーに伝えてください" >&2
fi

# 🐳 Docker が起動したかを確かめる。起動できなければ compose のサービスも起動しない
for _ in $(seq 30); do docker info > /dev/null 2>&1 && break; sleep 1; done
docker info > /dev/null 2>&1 || { echo "⚠️ Docker を起動できませんでした。/tmp/dockerd.log を確かめてください"; exit 0; }

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

timeout -k 10 300 docker compose up --build -d --wait --wait-timeout 290 >&2 ||
  echo "${COMPOSE} のサービスを起動できませんでした (時間切れを含む)。docker compose up --build -d --wait を実行し、エラーを確かめてください。リポジトリ側の問題なら、/autopilot:setup で直せるとユーザーに伝えてください。頼まれるまで直さないでください。"

exit 0
