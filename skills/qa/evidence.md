# エビデンスを autopilot-evidence ブランチに置く手順

動作確認の手順 (開発と対応、[self-check.md](self-check.md)) が使います。ファイルは置き場所 `$EV` の `pr-<PR 番号>/<sha7>/` に置いて、ブランチ `autopilot-evidence` に push します。`<PR 番号>` と `<sha7>` (コミットの先頭 7 文字) は、値に置き換えてください。

## 1. 置き場所を用意する

```bash
REPO=$(git rev-parse --show-toplevel)
EV="$(mktemp -d)/ev"
echo "$EV"
git -C "$REPO" ls-remote --exit-code --heads origin autopilot-evidence >/dev/null
rc=$?
if [ "$rc" = 0 ]; then
  git -C "$REPO" fetch origin autopilot-evidence || exit 1
  git -C "$REPO" worktree add -B autopilot-evidence "$EV" FETCH_HEAD || exit 1
elif [ "$rc" = 2 ]; then
  # リモートに本当に無いときだけ、孤立ブランチで作る
  git -C "$REPO" worktree add --detach "$EV" || exit 1
  git -C "$EV" checkout --orphan autopilot-evidence || exit 1
  git -C "$EV" rm -rf -q . 2>/dev/null || true
else
  echo "ls-remote に失敗しました (終了コード $rc)" >&2; exit 1
fi
mkdir -p "$EV/pr-<PR 番号>/<sha7>"
```

出力した `$EV` の値を控え、手順 2 でも同じ値を使います (コマンドの呼び出しをまたぐと、変数は消えます)。`exit 1` になったら、エビデンスは置けません。手順 3 の失敗の扱いに進みます。

## 2. ファイルを置いて push する

スクリーンショット・動画・JSON を `$EV/pr-<PR 番号>/<sha7>/` に置いたあと、次を行います。

```bash
git -C "$EV" add "pr-<PR 番号>/<sha7>"
git -C "$EV" -c user.name=autopilot -c user.email=autopilot@users.noreply.github.com commit -q -m "evidence: pr-<PR 番号> <sha7>"
pushed=0
for i in 1 2 3; do
  if git -C "$EV" push origin HEAD:autopilot-evidence; then pushed=1; break; fi
  # 先を越されて拒否されたら、取り込んでやり直す
  git -C "$EV" fetch origin autopilot-evidence \
    && git -C "$EV" rebase origin/autopilot-evidence || break
done
```

push は `git push` だけです。認証は、セッションがすでに設定しています。トークンは扱いません。

## 3. 失敗したとき

`$pushed` が 1 でなければ (手順 1 の失敗も含む)、ファイルへのリンクは書けません。本文の `## 動作確認` に「エビデンスを push できませんでした: <エラーの 1 行目>」と書き、何を確かめたかを文章とコードブロックで書きます。**エビデンスの失敗を理由に、受入条件を不合格にしません。**

## 4. 伏せる

シークレットや個人情報が写るものは、置く前に伏せます (写る範囲を塗る、値を `***` に置き換える)。伏せられなければ置かずに、その旨を書きます。

## 5. リンク

本文の `## 動作確認` には、画像を `![](<url>)` で埋め込み、動画などはリンク (`[](<url>)`) にします。JSON やコマンドの出力は、コードブロックに書いてもかまいません。URL は `https://github.com/<owner>/<repo>/blob/autopilot-evidence/pr-<PR 番号>/<sha7>/<ファイル>?raw=true` です。`<owner>/<repo>` は、この PR のリポジトリに置き換えます。
