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

# Dockerfile の FROM のうち、レジストリから取るイメージを 1 行ずつ出す。
# 前の stage の名前・scratch・ARG を使う参照 ($ を含む) は、CA を足したイメージに差し替えられないため除く
base_images() { # < Dockerfile
  awk '
    { sub(/\r$/, "") }
    toupper($1) == "FROM" {
      i = 2
      while ($i ~ /^--/) i++
      img = $i
      name = (toupper($(i + 1)) == "AS") ? tolower($(i + 2)) : ""
      if (img != "" && img !~ /\$/ && tolower(img) != "scratch" && !(tolower(img) in stage) && !(img in seen)) {
        seen[img] = 1
        print img
      }
      if (name != "") stage[name] = 1
    }'
}

# build のあるサービスの Dockerfile の FROM のイメージごとに、プロキシの CA を足したイメージを作り、
# {"サービス": {"元のイメージ": "docker-image://CA を足したイメージ"}} を出す。compose の additional_contexts で渡すと、
# BuildKit は FROM の元のイメージの代わりにこれを使う。Dockerfile は書き換えないため、ローカル・CI・本番のビルドは変わらない。
# CA はシステムの CA の束と別のファイルの両方に置き、CA の束を読まないツール (pip・Node.js など) には環境変数で渡す。
# 環境変数はイメージに残るが、このイメージは Web の中でしか作らない
patch_base_images() { # <CA を置いた dir> < compose config の JSON
  local dir=$1 config svc ctx df src ref tag sec out='{}' bundle=/etc/ssl/certs/ccr-proxy-ca.crt
  local -A built=()
  config=$(cat)
  while IFS=$'\t' read -r svc ctx df; do
    # git の URL などのリモートの context は、Dockerfile を読めないため飛ばす
    [ -d "$ctx" ] || continue
    case $df in
      /*) src=$df ;;
      *) src="$ctx/$df" ;;
    esac
    while IFS= read -r ref; do
      if [ -z "${built[$ref]+x}" ]; then
        built[$ref]=""
        tag="ccr-proxy-ca:$(printf %s "$ref" | sha256sum | cut -c1-16)"
        sec=$(left)
        if [ "$sec" -gt 30 ] && timeout -k 10 "$sec" docker build -q -t "$tag" -f - "$dir" > /dev/null << EOF; then
FROM $ref
COPY proxy-ca.crt /etc/ssl/certs/ca-certificates.crt
COPY proxy-ca.crt $bundle
ENV SSL_CERT_FILE=$bundle REQUESTS_CA_BUNDLE=$bundle PIP_CERT=$bundle NODE_EXTRA_CA_CERTS=$bundle CURL_CA_BUNDLE=$bundle
EOF
          built[$ref]=$tag
        else
          echo "⚠️ start-services: ${ref} にプロキシの CA を足せませんでした。このイメージのビルドは CA の検証で失敗することがあります" >&2
        fi
      fi
      [ -z "${built[$ref]}" ] ||
        out=$(jq -c --arg s "$svc" --arg r "$ref" --arg t "docker-image://${built[$ref]}" '.[$s][$r] = $t' <<< "$out")
    done < <(
      if jq -e --arg s "$svc" '.services[$s].build.dockerfile_inline' <<< "$config" > /dev/null; then
        jq -r --arg s "$svc" '.services[$s].build.dockerfile_inline' <<< "$config"
      else
        cat "$src" 2> /dev/null
      fi | base_images
    )
  done < <(jq -r '.services | to_entries[] | select(.value.build) |
    [.key, .value.build.context, (.value.build.dockerfile // "Dockerfile")] | @tsv' <<< "$config")
  echo "$out"
}

# Web のプロキシは TLS を検査するため、イメージのビルドにプロキシの CA を渡す。
# build のあるサービスに、CA を足したベースイメージ (patch_base_images) と secret の ca-certificates を足す compose ファイルを作り、COMPOSE_FILE で重ねる。
# ベースイメージの差し替えで、Dockerfile を変えずに CA が効く。Dockerfile は RUN --mount=type=secret,id=ca-certificates,... でも受け取れる (受け取らなければ何も変わらない)。
# Web の Compose はビルドに Bake を使い、Bake は作業ディレクトリの外のファイルを読むときに許可 (--allow=fs.read) を求めて止まる。
# そのため CA をプロジェクトの中 (.claude/session/) にコピーし、git には info/exclude で無視させる。docker compose はリポジトリのルートで実行する
add_proxy_ca() {
  local dir="$PWD/.claude/session" base files exclude f config contexts
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
  if ! config=$(COMPOSE_FILE="$files" COMPOSE_PROFILES='*' docker compose config --format json 2> /dev/null); then
    echo "⚠️ start-services: compose の設定を読めないため、ビルドにプロキシの CA を渡しません" >&2
    return 0
  fi
  contexts=$(patch_base_images "$dir" <<< "$config")
  [ -n "$contexts" ] || contexts='{}'

  # 作るのに失敗したとき、前のセッション開始で作った overlay (COMPOSE_FILE が指す) を空にしないよう、一時ファイルに書いてから置き換える。
  # CA を足したイメージはローカルにしか無いため、差し替えるサービスは build.pull でレジストリから取りにいかないようにする
  if ! jq --arg ca "$dir/proxy-ca.crt" --argjson ctx "$contexts" '{
      services: (.services | with_entries(select(.value.build) | .key as $s | .value = {build: (
        {secrets: ["ca-certificates"]} + (if $ctx[$s] then {additional_contexts: $ctx[$s], pull: false} else {} end)
      )})),
      secrets: {"ca-certificates": {file: $ca}}
    }' <<< "$config" > "$dir/compose.proxy-ca.yaml.tmp"; then
    rm -f "$dir/compose.proxy-ca.yaml.tmp"
    echo "⚠️ start-services: CA を渡す compose ファイルを作れないため、ビルドにプロキシの CA を渡しません" >&2
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

# デーモンが応答するまで 30 秒まで待つ。CA を足したベースイメージを作るため、CA の準備はその後に行う
for _ in $(seq 30); do docker info > /dev/null 2>&1 && break; sleep 1; done
add_proxy_ca

# イメージの取得・ビルドが止まったり、ヘルスチェックが通らないままだったりしても、締め切りで打ち切り、起動できなかったことを伝える
sec=$(left)
if [ "$sec" -le 30 ] || ! timeout -k 10 "$sec" docker compose up --build -d --wait --wait-timeout "$((sec - 10))" >&2; then
  echo "${compose} のサービスを起動できませんでした (時間切れを含む)。docker compose up --build -d --wait を実行し、エラーを確かめてください。"
fi
exit 0
