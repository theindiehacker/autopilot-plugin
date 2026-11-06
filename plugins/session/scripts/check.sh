#!/usr/bin/env bash
# git push の前と Claude が作業を終える前に、変更がシークレット (gitleaks)、依存の脆弱性・IaC の設定ミス (trivy)、コードの脆弱性 (semgrep) を含まないか確かめる。
# 見つかれば exit 2 で結果 (stderr) を Claude に返し、push を止めるか、作業を続けて直させる。
# session プラグインの PreToolUse・Stop hook (hooks/hooks.json) と、session-start.sh が Web で置く pre-push から実行する。
# gitleaks・trivy・uvx (semgrep を動かす) が動かなければ、その検査は飛ばし、そのことをセッションごとに 1 回 Claude に伝える
set -uo pipefail

input=$(cat)

# --pre-push は .git/hooks/pre-push から呼ばれる。PreToolUse に見えない、スクリプトの中の push やエイリアスも確かめるため
pre_push=""
[ "${1:-}" != "--pre-push" ] || pre_push=1
on_push=$pre_push

# PreToolUse では、Bash のコマンドに git push があるときだけ確かめる。bash -c の中の push も見るため、hook の if では絞らない。
# git と push の間は -C <dir> などのオプションだけを許す (git stash push を除くため)。文字列の中の "git push" でも動くが、確かめるだけなので害は無い
if [ -z "$pre_push" ] && grep -Eq '"hook_event_name" *: *"PreToolUse"' <<< "$input"; then
  command=$(grep -Eo '"command" *: *"([^"\\]|\\.)*"' <<< "$input" | head -n 1)
  grep -Eq 'git( +-[^ ]+( +[^- ][^ ]*)?)* +push([^[:alnum:]_-]|$)' <<< "$command" || exit 0
  on_push=1
fi

# git は pre-push を push するリポジトリのルートで動かす。CLAUDE_PROJECT_DIR は別のリポジトリかもしれないため、使わない
project=${CLAUDE_PROJECT_DIR:-.}
[ -z "$pre_push" ] || project=.
top=$(git -C "$project" rev-parse --show-toplevel 2> /dev/null) || exit 0
cd "$top" || exit 0

# 止めた印と、前回通った状態を、セッションごとに覚える。ほかのユーザーが書き換えられないよう、/tmp ではなく .git の中 (0700) に置く。
# session_id が無いか想定外の文字を含むときは覚えない。jq が無い環境でも読めるよう、JSON は grep で見る
sid=$(grep -o '"session_id" *: *"[^"]*"' <<< "$input" | sed 's/.*"\([^"]*\)"$/\1/')
case $sid in '' | *[!A-Za-z0-9_-]*) sid="" ;; esac
# pre-push は session_id を受け取れないため、1 つのセッションとして扱う
[ -z "$pre_push" ] || sid="pre-push"
mark=""
passed=""
last_passed=""
state_dir=$(git rev-parse --git-path claude-hooks 2> /dev/null)
# session と stack の Stop は同時に動くため、片方の mkdir が負けても、できた dir を使う
if [ -n "$sid" ] && [ -n "$state_dir" ] && { mkdir -m 700 "$state_dir" 2> /dev/null || [ -d "$state_dir" ]; }; then
  find "$state_dir" -type f -mtime +7 -delete 2> /dev/null
  mark="$state_dir/session-check-blocked-$sid"
  passed="$state_dir/session-check-passed-$sid"
  # PreToolUse を通した直後の pre-push で確かめ直さないよう、セッションによらず最後に通った状態を pre-push に渡す
  last_passed="$state_dir/session-check-last-passed"
  [ -z "$pre_push" ] || passed=$last_passed
fi

# 作業を続けさせた直後 (stop_hook_active) でも、続けさせたのが別の hook (stack の lint など) なら確かめる。
# この hook 自身が一度止めた後は確かめない (直せないときに終わらなくなるのを防ぐ)。印を使えないときは、続けさせた直後はいつも確かめない
if grep -Eq '"stop_hook_active" *: *true' <<< "$input"; then
  { [ -z "$mark" ] || [ -e "$mark" ]; } && exit 0
elif [ -n "$mark" ]; then
  rm -f "$mark"
fi

# Claude がセッション中にコミット・push したものも確かめるよう、デフォルトブランチから分かれた点 (base) からの変更を見る
base=""
for ref in refs/remotes/origin/HEAD refs/remotes/origin/main refs/remotes/origin/master; do
  if git rev-parse -q --verify "$ref" > /dev/null; then
    base=$(git merge-base HEAD "$ref" 2> /dev/null)
    break
  fi
done
commits=""
[ -n "$base" ] && [ "$base" != "$(git rev-parse HEAD 2> /dev/null)" ] && commits="$base..HEAD"

# base (無ければ HEAD) からの変更と、新しいファイル (消したファイルを除く)。質問に答えただけのときは何もしない。
# 日本語などのパスがエスケープされないよう、core.quotePath を切る
changed=$({
  git -c core.quotePath=false diff --name-only --diff-filter=d "${base:-HEAD}" 2> /dev/null
  git -c core.quotePath=false ls-files --others --exclude-standard
} | sort -u)
[ -n "$changed" ] || exit 0

# CLAUDE_ENV_FILE の PATH は Bash にしか効かないため、Web で session-start.sh が入れた道具をここで使えるようにする。
# mise の shim は、そのリポジトリで設定されていないと失敗するため、session-start.sh が直接入れた BIN_DIR を先に探す
export PATH="${HOME}/.local/bin:${MISE_DATA_DIR:-${HOME}/.local/share/mise}/shims:${PATH}"

# trivy は変更した lock ファイルと IaC のファイルだけを確かめる (元からある問題まで直させない)。
# semgrep は起動とルールの取得に時間がかかるため、コード以外 (文書・画像・lock など) だけを変えたときは動かさない
targets=$(grep -E '(^|/)(bun\.lockb?|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|uv\.lock|poetry\.lock|requirements[^/]*\.txt|go\.mod|go\.sum|Cargo\.lock|Gemfile\.lock|Dockerfile[^/]*|[^/]*\.tf|(docker-)?compose[^/]*\.ya?ml)$' <<< "$changed")
code=$(grep -Ev '\.(md|mdx|txt|rst|png|jpe?g|gif|svg|ico|webp|pdf|csv|lock|lockb|woff2?|ttf|eot|mp4|mov|zip|gz)$' <<< "$changed")

# 変更に関係する道具のうち、動かないものを調べる。mise の shim は、そのリポジトリで設定されていないと失敗するため、実際に動かして確かめる
missing=""
[ -z "$targets" ] || trivy --version > /dev/null 2>&1 || missing="$missing trivy"
[ -z "$code" ] || uvx --version > /dev/null 2>&1 || missing="$missing uvx"
gitleaks version > /dev/null 2>&1 || missing="$missing gitleaks"
works() { [[ " $missing " != *" $1 "* ]]; }

# 前回この検査を通ってから、コミットも作業ツリーも、動かない道具も変わっていなければ確かめない (質問に答えただけの返事で待たせない)。
# 動かない道具を含めるのは、Claude がそれを入れたら確かめ直すため
state=$({
  echo "$missing"
  git rev-parse HEAD 2> /dev/null
  git diff HEAD 2> /dev/null
  git ls-files --others --exclude-standard -z | xargs -0 -r sha256sum 2> /dev/null
} | sha256sum | cut -d' ' -f1)
# sha256sum が無いと state が空になり、空同士の比較で検査を飛ばしてしまうため、空のときは比べない
[ -n "$passed" ] && [ -n "$state" ] && [ "$(cat "$passed" 2> /dev/null)" = "$state" ] && exit 0

# Stop の hook の上限 (600 秒) より前に終えるよう、全体の締め切りを決め、各検査には残りの時間だけを渡す
DEADLINE=$(($(date +%s) + 540))
left() { echo $((DEADLINE - $(date +%s))); }
# macOS には timeout が無い。無ければ検査ごとの上限なしで動かす (hook の上限で打ち切られる)
command -v timeout > /dev/null || timeout() { shift 3; "$@"; }
# 道具の失敗や時間切れで確かめきれなかったときは、通ったと覚えない (次の Stop で確かめ直す)
incomplete=""
warn() {
  incomplete=1
  echo "⚠️ check: $*" >&2
}

report=$(mktemp)
out=$(mktemp)
index=$(mktemp)
trap 'rm -f "$report" "$out" "$index"' EXIT

# 検出したときの終了コード。道具そのものの失敗 (1 など) と分け、失敗では直させない
FOUND=3

# 依存の脆弱性と IaC の設定ミス: trivy。
# 検知レベルは org の必須ワークフロー (github-workflows の trivy.yml) にそろえる。抑制は .trivyignore だけで行う。
if [ -n "$targets" ] && works trivy; then
  # 脆弱性 DB は 1 回だけ取得し、各ファイルでは取得しない
  if timeout -k 10 "$(left)" trivy fs --download-db-only --quiet > "$out" 2>&1; then
    while IFS= read -r f; do
      sec=$(left)
      if [ "$sec" -le 0 ]; then
        warn "時間が足りないため、trivy で残りのファイルを確かめません"
        break
      fi
      timeout -k 10 "$sec" trivy fs --quiet --skip-db-update --scanners vuln,misconfig --severity MEDIUM,HIGH,CRITICAL \
        --ignore-unfixed --exit-code "$FOUND" "$f" > "$out" 2>&1
      case $? in
        0) ;;
        "$FOUND") { echo "### ${f}: trivy fs"; head -n 100 "$out"; echo; } >> "$report" ;;
        *) warn "trivy で ${f} を確かめられませんでした: $(tail -n 1 "$out")" ;;
      esac
    done <<< "$targets"
  else
    warn "trivy の脆弱性 DB を取得できなかったため、確かめません: $(tail -n 1 "$out")"
  fi
fi

# コードの脆弱性 (SAST): semgrep。変更したファイルだけを確かめる。版は Renovate が上げる (renovate.json)。
# 検知レベルは org の必須ワークフローにそろえる。抑制は .semgrepignore だけで行い、インラインの nosemgrep は効かせない。
if [ -n "$code" ] && works uvx && [ "$(left)" -gt 0 ]; then
  files=()
  while IFS= read -r f; do files+=("$f"); done <<< "$code"
  # semgrep は --error のとき、検出で 1 を返し、ルールを取得できないなどの失敗では 2 以上を返す
  timeout -k 10 "$(left)" uvx semgrep@1.181.0 scan --config p/default --severity ERROR --error --metrics off --disable-version-check \
    --disable-nosem --quiet "${files[@]}" > "$out" 2>&1
  case $? in
    0) ;;
    1) { echo "### semgrep scan"; head -n 100 "$out"; echo; } >> "$report" ;;
    *) warn "semgrep で確かめられませんでした: $(tail -n 1 "$out")" ;;
  esac
fi

# シークレット: gitleaks。コミットしていない変更と、base からのコミットを確かめる。
# HEAD だけを載せた一時的なインデックスに、新しいファイル (ステージ済みを含む) を intent-to-add で足し、作業ツリーとの差分 (ステージ済み・新しいファイルを含む) を調べる。
# 本物のインデックスは変えず、新しいファイルの中身を .git に書き込まない。抑制は .gitleaksignore だけで行い、インラインの gitleaks:allow は効かせない
if works gitleaks && [ "$(left)" -gt 0 ]; then
  if GIT_INDEX_FILE="$index" git read-tree HEAD 2> /dev/null &&
    { git ls-files --others --exclude-standard -z; git diff --cached --name-only --diff-filter=A -z HEAD; } |
    GIT_INDEX_FILE="$index" xargs -0 -r git add -N -- > /dev/null 2>&1; then
    GIT_INDEX_FILE="$index" timeout -k 10 "$(left)" gitleaks git --pre-commit --redact --verbose --no-banner --no-color \
      --ignore-gitleaks-allow --exit-code "$FOUND" > "$out" 2>&1
    case $? in
      0) ;;
      "$FOUND") { echo "### gitleaks git (コミットしていない変更)"; head -n 100 "$out"; echo; } >> "$report" ;;
      *) warn "gitleaks でコミットしていない変更を確かめられませんでした: $(tail -n 1 "$out")" ;;
    esac
  fi
  # コミット済みのものは、履歴を書き換えるまで毎回見つかる。作業を終えるときは、同じものでは止めないよう、このセッションで伝えた fingerprint を覚え、新しいものだけで止める。
  # push の前は、履歴に残ったまま出さないよう、伝え済みのものでも必ず止める
  if [ -n "$commits" ]; then
    timeout -k 10 "$(left)" gitleaks git --log-opts="$commits" --redact --verbose --no-banner --no-color \
      --ignore-gitleaks-allow --exit-code "$FOUND" > "$out" 2>&1
    case $? in
      0) ;;
      "$FOUND")
        reported="${state_dir}/session-check-reported-${sid}"
        found=$(sed -n 's/^Fingerprint: *//p' "$out" | sort -u)
        new=$found
        [ -z "$sid" ] || new=$(comm -23 <(echo "$found") <(sort -u "$reported" 2> /dev/null))
        if [ -n "$on_push" ] || [ -n "$new" ]; then
          { echo "### gitleaks git (コミット済み: ${commits})"; head -n 100 "$out"; echo; } >> "$report"
          [ -n "$on_push" ] || [ -z "$sid" ] || echo "$new" >> "$reported"
        else
          # 通ったと覚えると、push の前の検査まで飛ばしてしまう。warn は通ったと覚えない
          warn "コミット済みのシークレット (このセッションで伝え済み) が、まだ履歴に残っています"
        fi
        ;;
      *) warn "gitleaks でコミット済みの変更を確かめられませんでした: $(tail -n 1 "$out")" ;;
    esac
  fi
fi

# 動かない道具は、セッションごとに 1 回だけ Claude に伝える。exit 0 の stderr は Claude に届かないため、exit 2 で止める。
# 覚えられないとき (session_id が無いなど) は毎回止めることになるため、警告だけにする
new_missing=""
if [ -n "$missing" ]; then
  echo "⚠️ check: 道具が動かないため、確かめていません:$missing" >&2
  if [ -n "$mark" ]; then
    told="$state_dir/session-check-missing-$sid"
    for tool in $missing; do
      if ! grep -qxF "$tool" "$told" 2> /dev/null; then
        new_missing="$new_missing $tool"
        echo "$tool" >> "$told"
      fi
    done
  fi
fi

goal="終えて"
[ -z "$on_push" ] || goal=" push して"

if [ -s "$report" ]; then
  [ -z "$mark" ] || touch "$mark"
  {
    echo "変更がシークレット・脆弱性の検査を通りません。直してから${goal}ください。"
    echo "シークレットはファイルから消してください。コミット済みのものは、キーを無効にして履歴から消す必要があるため、ユーザーに伝えてください。"
    echo ".gitleaksignore・.trivyignore・.semgrepignore に書いてよいのは、ユーザーが誤検知だと確かめたものだけです"
    echo
    head -n 200 "$report"
  } >&2
else
  # 道具のことだけで止めるときは印を付けない。Claude が道具を入れた直後の Stop で確かめ直すため
  [ -z "$mark" ] || rm -f "$mark"
  if [ -n "$passed" ] && [ -z "$incomplete" ]; then
    echo "$state" > "$passed"
    echo "$state" > "$last_passed"
  fi
  [ -n "$new_missing" ] || exit 0
fi

if [ -n "$new_missing" ]; then
  {
    echo
    echo "道具が動かないため、次の検査をしていません。ここにない検査は、実行したか、今回の変更に関係しないものです。"
    for tool in $missing; do
      case $tool in
        gitleaks) echo " - gitleaks: シークレット" ;;
        trivy) echo " - trivy: 依存の脆弱性と IaC の設定ミス" ;;
        uvx) echo " - uvx (uv に含まれます): semgrep によるコードの脆弱性" ;;
      esac
    done
    if [ "${CLAUDE_CODE_REMOTE:-}" = "true" ]; then
      echo "このセッションに入れられるなら入れてから${goal}ください。入れたら確かめ直します。入れられないときは、確かめていないことをユーザーに伝えてください。"
    else
      echo "確かめていないことをユーザーに伝え、入れるかどうかを聞いてください。"
    fi
    [ -z "$on_push" ] || echo "道具を入れずにもう一度 push すると、この検査を飛ばして進みます。"
    echo "mise.toml などリポジトリのファイルは、ユーザーに聞かずに変えないでください"
  } >&2
fi
exit 2
