#!/usr/bin/env bash
# セッションの開始・再開時に、terraform・tflint と、tflint のプラグイン (クラウドごとのルール) を揃えるスクリプト
set -uo pipefail

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

# Terraform を使わないリポジトリでは何もしない
[ -n "$(git ls-files -- '*.tf' 2> /dev/null)" ] || exit 0

# 📐 技術スタックの方針を Claude に伝える
cat << 'EOF2'
このリポジトリのインフラは、次の技術スタックで書いてください。
- インフラは Terraform で書く。ディレクトリの構成・名前・ラベル (タグ)・state の置き場所は、architecture:standard スキルの標準に従う
- 整形は terraform fmt、lint は tflint (設定は infrastructure/.tflint.hcl)
- このリポジトリに .tflint.hcl が無ければ、/architecture:standard で足せるとユーザーに伝える。頼まれるまで足さない
EOF2

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# 🧰 Web では terraform・tflint を入れる。ローカルでは入れず、無ければ伝えるだけにする
if [ "${CLAUDE_CODE_REMOTE:-}" = "true" ]; then
  if ! terraform version > /dev/null 2>&1; then
    curl -sSfL --connect-timeout 10 --max-time 120 -o "$TMP/terraform.zip" \
      https://releases.hashicorp.com/terraform/1.17.1/terraform_1.17.1_linux_amd64.zip &&
      unzip -oq "$TMP/terraform.zip" terraform -d /usr/local/bin &
  fi
  if ! tflint --version > /dev/null 2>&1; then
    curl -sSfL --connect-timeout 10 --max-time 120 -o "$TMP/tflint.zip" \
      https://github.com/terraform-linters/tflint/releases/download/v0.65.0/tflint_linux_amd64.zip &&
      unzip -oq "$TMP/tflint.zip" tflint -d /usr/local/bin &
  fi
  wait
fi

for t in terraform tflint; do
  "$t" --version > /dev/null 2>&1 || echo "⚠️ $t がありません。Terraform の検査は動きません。ユーザーに伝えてください (ローカルの Mac は brew install hashicorp/tap/terraform tflint で入れられます)"
done
command -v tflint > /dev/null 2>&1 || exit 0

# .tflint.hcl の plugin のブロックから「source 版」を取り出す
plugins() {
  awk '
    /^[[:space:]]*plugin[[:space:]]+"/ { p = 1; s = ""; v = ""; next }
    p && /^[[:space:]]*source[[:space:]]*=/ { s = $0; sub(/^[^"]*"/, "", s); sub(/".*$/, "", s) }
    p && /^[[:space:]]*version[[:space:]]*=/ { v = $0; sub(/^[^"]*"/, "", v); sub(/".*$/, "", v) }
    p && /^[[:space:]]*}/ { if (s != "" && v != "") print s, v; p = 0 }
  ' "$1"
}

# Web では GitHub の API が使えず tflint --init が失敗するため、GitHub のリリースから直接入れる。
# 入れ先は tflint --init と同じ (~/.tflint.d/plugins/<source>/<版>/)。リリースの checksums.txt で中身を確かめる
download() {
  local s v repo dir url
  while read -r s v; do
    # URL とパスに使うので、想定の形だけを通す
    printf '%s %s' "$s" "$v" | grep -Eq '^github\.com/[A-Za-z0-9_.-]+/tflint-ruleset-[A-Za-z0-9_.-]+ [0-9][0-9.]*$' || return 1
    repo=${s##*/}
    dir="${TFLINT_PLUGIN_DIR:-$HOME/.tflint.d/plugins}/$s/$v"
    [ ! -x "$dir/$repo" ] || continue
    url="https://$s/releases/download/v$v"
    curl -sSfL --connect-timeout 10 --max-time 120 -o "$TMP/${repo}_linux_amd64.zip" "$url/${repo}_linux_amd64.zip" &&
      curl -sSfL --connect-timeout 10 --max-time 60 -o "$TMP/checksums.txt" "$url/checksums.txt" &&
      (cd "$TMP" && grep " ${repo}_linux_amd64.zip\$" checksums.txt | sha256sum -c --quiet -) &&
      mkdir -p "$dir" && unzip -oq "$TMP/${repo}_linux_amd64.zip" "$repo" -d "$dir" || return 1
  done < <(plugins "$1")
}

# 🔌 .tflint.hcl に書いたプラグインを入れる (commit の前の検査で、ネットワークを使わないため)
while IFS= read -r -d '' CONF; do
  ABS="$(cd "$(dirname -- "$CONF")" && pwd -P)/.tflint.hcl"
  tflint --init --config "$ABS" > /dev/null 2>&1 ||
    { [ "${CLAUDE_CODE_REMOTE:-}" = "true" ] && download "$ABS"; } ||
    echo "⚠️ $CONF のプラグインを入れられませんでした。commit の前の tflint は動きません。ユーザーに伝えてください"
done < <(git ls-files -z -- .tflint.hcl '*/.tflint.hcl')

exit 0
