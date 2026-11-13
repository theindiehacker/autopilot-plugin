#!/usr/bin/env bash
# git に入るファイルだけを一時フォルダに写して、そこで検査のコマンドを動かすスクリプト。
# gitleaks と trivy は .gitignore を見ないため、そのまま動かすと .env やビルドの生成物で commit・push が止まる
set -uo pipefail
cd "$CLAUDE_PROJECT_DIR" || exit 0

# 追跡中のファイルと、無視していない新規ファイルを写す (git add -A && git commit では、hook が add より先に動くため)。
# 消した追跡中のファイルは tar のエラーになるので、一覧から除く。
# COPYFILE_DISABLE: Mac の tar は拡張属性も読み、この hook の時間の大半を占めるため、読ませない
copy() {
  git ls-files -coz --exclude-standard 2> /dev/null |
    while IFS= read -r -d '' f; do
      if [ -e "$f" ]; then printf '%s\0' "$f"; fi
    done |
    COPYFILE_DISABLE=1 tar --null --no-recursion -T - -cf - 2> /dev/null | tar -xf - -C "$1" 2> /dev/null
}

# 写せないとき (git のリポジトリでないフォルダを含む) は、検査を素通りさせないよう全体を検査する
TMP=$(mktemp -d) && trap 'rm -rf "$TMP"' EXIT && copy "$TMP" && cd "$TMP" ||
  echo '⚠️ git に入るファイルを一時フォルダに写せなかったので、フォルダ全体を検査します' >&2

# mise の shim は、一時フォルダの mise.toml を「信頼できない」として拒む。
# 信頼を足すのは、元のフォルダの mise の設定がすべて信頼済みのときだけ (mise trust --show の行がすべて ": trusted" で終わり、1 行以上あるとき)。
# 常に足すと、ユーザーが信頼していない mise.toml の [env]・exec などが、写した先で動いてしまう。
# 確かめるのは、元のフォルダ (ルート) と親フォルダの設定だけ。$TMP を信頼すると、その下のサブフォルダの mise.toml も、確かめないまま信頼される。
# 呼び出し元 (skills/setup/security.md) はルートで検査を動かすだけなので、サブフォルダの設定は読まれない
# mise が無いときは何も足さない。足すのは一時フォルダだけで、元の設定の信頼は変えない
if [ "$PWD" = "${TMP:-}" ] && command -v mise > /dev/null 2>&1; then
  trust=$(cd "$CLAUDE_PROJECT_DIR" && mise trust --show 2> /dev/null)
  if [ -n "$trust" ] && ! grep -qv ': trusted$' <<< "$trust"; then
    export MISE_TRUSTED_CONFIG_PATHS="$TMP${MISE_TRUSTED_CONFIG_PATHS:+:$MISE_TRUSTED_CONFIG_PATHS}"
  elif [ -n "$trust" ]; then
    echo '⚠️ 元の mise.toml が信頼されていないので、一時フォルダも信頼しません。mise trust で信頼できます' >&2
  fi
fi

"$@" 1>&2
