#!/usr/bin/env bash
# Claude Code on the web のセッション開始時に、リポジトリ直下の compose ファイルのサービスを起動する。
# session-start.sh が、ツールと依存を入れた後に実行する (締め切りは SESSION_DEADLINE で受け取る)。compose ファイルか docker が無ければ何もしない。
# stdout は Claude のコンテキストに入るため、ビルドと起動の進捗は stderr に回し、起動できなかったことだけを伝える
set -uo pipefail

# ローカルでは何もしない。プラグインの hook は開いたどのリポジトリでも動くため、信頼していないリポジトリのイメージを
# ビルド・実行しないよう、ローカルでは docker compose up を自分で実行する
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

compose=""
for f in compose.yaml compose.yml docker-compose.yaml docker-compose.yml; do
  if [ -f "$f" ]; then
    compose=$f
    break
  fi
done
[ -n "$compose" ] && command -v docker > /dev/null || exit 0

# hook の上限 (600 秒) より前に終えるよう、締め切りまでの残りの時間で打ち切る
DEADLINE=${SESSION_DEADLINE:-$(($(date +%s) + 570))}
left() { echo $((DEADLINE - $(date +%s))); }

# Web のプロキシは TLS を検査するため、イメージのビルドにプロキシの CA を渡す。
# build のあるサービスに secret の ca-certificates を足す compose ファイルを作り、COMPOSE_FILE で重ねる。
# Dockerfile は RUN --mount=type=secret,id=ca-certificates,... で受け取る (受け取らなければ何も変わらない)。
# Web の Compose はビルドに Bake を使い、Bake は作業ディレクトリの外のファイルを読むときに許可 (--allow=fs.read) を求めて止まる。
# そのため CA をプロジェクトの中 (.claude/session/) にコピーし、git には info/exclude で無視させる。docker compose はリポジトリのルートで実行する
add_proxy_ca() {
  local dir="$PWD/.claude/session" base files exclude f
  if [ -z "${SSL_CERT_FILE:-}" ] || ! command -v jq > /dev/null; then
    echo "⚠️ start-services: SSL_CERT_FILE か jq が無いため、ビルドにプロキシの CA を渡しません" >&2
    return 0
  fi
  mkdir -p "$dir" && cp "$SSL_CERT_FILE" "$dir/proxy-ca.crt" || return 0
  exclude=$(git rev-parse --git-path info/exclude 2> /dev/null) &&
    ! grep -qxF /.claude/session/ "$exclude" 2> /dev/null &&
    mkdir -p "$(dirname "$exclude")" && echo /.claude/session/ >> "$exclude"

  # COMPOSE_FILE を設定すると、compose は既定のファイルを読まなくなる。そのため、compose が読むはずのファイルを先に並べる。
  # 環境変数か .env の COMPOSE_FILE があればそれを、無ければ compose ファイルと、compose が選ぶ override (見つけた最初の 1 つ) を使う
  base=${COMPOSE_FILE:-$(sed -n 's/^COMPOSE_FILE=//p' .env 2> /dev/null | tail -n 1 | tr -d "\"'")}
  if [ -z "$base" ]; then
    base=$compose
    for f in compose.override.yaml compose.override.yml docker-compose.override.yaml docker-compose.override.yml; do
      if [ -f "$f" ]; then
        base="$base:$f"
        break
      fi
    done
  fi
  # 後続の Bash がどの dir から実行しても同じファイルを読むよう絶対パスにし、前のセッション開始で足した overlay は除く
  files=$(tr ':' '\n' <<< "$base" | grep -v '/\.claude/session/compose\.proxy-ca\.yaml$' |
    while IFS= read -r f; do
      case $f in
        /*) echo "$f" ;;
        ?*) echo "$PWD/$f" ;;
      esac
    done | paste -sd: -)

  # profiles で分けたサービスも、docker compose run で名指ししてビルドするため含める
  # 作るのに失敗したとき、前のセッション開始で作った overlay (COMPOSE_FILE が指す) を空にしないよう、一時ファイルに書いてから置き換える
  if ! COMPOSE_FILE="$files" COMPOSE_PROFILES='*' docker compose config --format json 2> /dev/null |
    jq --arg ca "$dir/proxy-ca.crt" '{
      services: (.services | with_entries(select(.value.build) | .value = {build: {secrets: ["ca-certificates"]}})),
      secrets: {"ca-certificates": {file: $ca}}
    }' > "$dir/compose.proxy-ca.yaml.tmp"; then
    rm -f "$dir/compose.proxy-ca.yaml.tmp"
    echo "⚠️ start-services: compose の設定を読めないため、ビルドにプロキシの CA を渡しません" >&2
    return 0
  fi
  mv "$dir/compose.proxy-ca.yaml.tmp" "$dir/compose.proxy-ca.yaml"

  export COMPOSE_FILE="$files:$dir/compose.proxy-ca.yaml"
  # Claude が実行する docker compose・task にも効くよう、後続の Bash に渡す。セッションの再開でも実行されるため、同じ行を重ねて書かない
  local line="export COMPOSE_FILE=\"$COMPOSE_FILE\""
  if [ -n "${CLAUDE_ENV_FILE:-}" ] && ! grep -qxF "$line" "$CLAUDE_ENV_FILE" 2> /dev/null; then
    echo "$line" >> "$CLAUDE_ENV_FILE"
  fi
}

# Web の VM では Docker デーモンが止まっている。セッションの再開では、デーモンが動いたままのことがある
if ! docker info > /dev/null 2>&1; then
  # Docker Hub の匿名の取得回数の上限 (429) に当たらないよう、Google のミラーから取得する (ミラーに無ければ Docker Hub から取る)
  dockerd --registry-mirror=https://mirror.gcr.io > /tmp/dockerd.log 2>&1 &
fi
add_proxy_ca

# デーモンが応答するまで 30 秒まで待つ
for _ in $(seq 30); do docker info > /dev/null 2>&1 && break; sleep 1; done

# イメージの取得・ビルドが止まったり、ヘルスチェックが通らないままだったりしても、締め切りで打ち切り、起動できなかったことを伝える
sec=$(left)
if [ "$sec" -le 30 ] || ! timeout -k 10 "$sec" docker compose up --build -d --wait --wait-timeout "$((sec - 10))" >&2; then
  echo "${compose} のサービスを起動できませんでした (時間切れを含む)。docker compose up --build -d --wait を実行し、エラーを確かめてください。"
fi
exit 0
