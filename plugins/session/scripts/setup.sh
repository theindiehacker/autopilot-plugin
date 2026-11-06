#!/usr/bin/env bash
# Claude Code on the web のセッションの開始・再開時に、検査の道具 (semgrep・gitleaks・trivy) と mise のツールを入れ、compose のサービスを起動する。
# session プラグインの SessionStart hook (hooks/hooks.json) から実行する。
#
# - hook は 600 秒で打ち切られ、打ち切られると stdout の警告が Claude に届かない。
#   そのため道具の導入は 220 秒に収め、残りを compose の起動 (start-services.sh の約 340 秒) に充てる
# - 道具は並行して入れる。動く道具は入れ直さない (版が違っても入れ直さない)。途中で切れて壊れた道具は入れ直す
# - 検査の hook には CLAUDE_ENV_FILE の PATH が効かないため、道具は /usr/local/bin に入れ、そのパスで動くかを確かめる
# - stdout は Claude のコンテキストに入るため、進捗は stderr に出し、stdout には Claude に伝えることだけを書く
# - 失敗してもセッションを止めないよう、常に exit 0 で終える
set -uo pipefail

# ローカルでは何もしない
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

BIN=/usr/local/bin
END=$((SECONDS + 220))

# 導入の締め切りまでの残りの秒数 (少なくとも 1。curl の --max-time 0 は無制限になるため)
left() {
  local sec=$((END - SECONDS))
  [ "$sec" -gt 0 ] || sec=1
  echo "$sec"
}

works() { "$BIN/$1" --version > /dev/null 2>&1; }

# GitHub Releases のファイルを取得して BIN に入れる。.tar.gz なら <名前> の実行ファイルを取り出す。
# 取得し終えてから置き換えるため、途中で切れても壊れたファイルを残さない。版は Renovate が URL ごと更新する (renovate.json)
fetch() { # <名前> <URL>
  local tmp status
  tmp=$(mktemp -d) || return 1
  curl -fsSL --connect-timeout 10 --max-time "$(left)" -o "$tmp/file" "$2" &&
    case $2 in
      *.tar.gz) tar -xzf "$tmp/file" -C "$tmp" "$1" ;;
      *) mv "$tmp/file" "$tmp/$1" ;;
    esac &&
    install -m 755 "$tmp/$1" "$BIN/$1"
  status=$?
  rm -rf "$tmp"
  return "$status"
}

# semgrep は PyPI から入れる。uv は tool env や実行ファイルが残っていると上書きしないため、--force で入れ直す
install_semgrep() {
  timeout -k 5 "$(left)" env UV_TOOL_BIN_DIR="$BIN" uv tool install semgrep==1.181.0 --force >&2
}

# mise.toml のツールを入れ、後続の Bash から呼べるようにする。ツールは mise.toml で変わるため、mise があっても毎回確かめる
setup_mise() {
  local shims="${MISE_DATA_DIR:-$HOME/.local/share/mise}/shims" line
  line="export PATH=\"$shims:\$PATH\""
  # 再開でも実行されるため、同じ行を重ねて書かない
  [ -z "${CLAUDE_ENV_FILE:-}" ] || grep -qxF "$line" "$CLAUDE_ENV_FILE" 2> /dev/null || echo "$line" >> "$CLAUDE_ENV_FILE"
  # mise の postinstall (lefthook install など) からも、mise のツールを呼べるようにする
  export PATH="$shims:$PATH"
  { works mise || fetch mise https://github.com/jdx/mise/releases/download/v2026.10.17/mise-v2026.10.17-linux-x64; } &&
    "$BIN/mise" trust . >&2 &&
    timeout -k 5 "$(left)" "$BIN/mise" install --yes >&2
}

works semgrep || install_semgrep &
works gitleaks || fetch gitleaks https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz &
works trivy || fetch trivy https://github.com/aquasecurity/trivy/releases/download/v0.76.2/trivy_0.76.2_Linux-64bit.tar.gz &
mise_failed=""
if [ -f mise.toml ]; then
  setup_mise &
  wait "$!" || mise_failed=1
fi
wait

missing=()
for t in semgrep gitleaks trivy; do
  works "$t" || missing+=("$t")
done
[ ${#missing[@]} -eq 0 ] ||
  echo "⚠️ session: ${missing[*]} を入れられませんでした。コミットと push の前の、これらの道具の検査は動きません。ユーザーに伝えてください"
[ -z "$mise_failed" ] ||
  echo "⚠️ session: mise.toml のツールを入れられませんでした。ユーザーに伝えてください"

# compose のビルドが入れている途中のツールを読まないよう、道具を入れ終えてから起動する
bash "$(dirname "${BASH_SOURCE[0]}")/start-services.sh"
exit 0
