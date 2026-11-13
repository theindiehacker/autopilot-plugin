# Issue からマージまでの自動の流れと `/autopilot:setup` の設計

- Issue: #40
- 日付: 2026-11-12
- 題: 2026-11-13 に、「本番へのデプロイまで」から「マージまで」に変えた。デプロイは、リポジトリのデプロイの仕組みに任せる (12 章)
- 状態: 試験中

## 1. 目的

Issue を起票すれば、Claude Code が開発・テスト・レビュー・QA・マージまで行う。デプロイの仕組みがあるリポジトリでは、マージの後に、そのデプロイが動く。人間は、取り消せない変更の承認だけをする。どの会社のリポジトリにも、`/autopilot:setup` で入れられるようにする。

**背景:** 社内外の多くの人が、PC で Claude Code を起動して作業している。その人がボトルネックになり、開発が止まったり遅れたりしている。

**参考:** https://x.com/m4lkxx/status/2114338456750997922 (Harness・Loop・Graph の 7 段階)。この設計は記事の次の考えに従う。

- 完了は、失敗しうる検査で決める (Level 3)。AI の「直りました」は証拠にしない
- やり直しには出口を作る (Level 4)。同じ失敗が 2 回出たら止める
- 人間は、取り消せないところにだけ置く (Level 6)。どれが取り消せないかは、AI ではなくコードが決める

## 2. 目標・目標にしないこと・失敗とみなすこと

**目標**

- `autopilot:ready` が付いた Issue から、人が触らずに PR のマージまで進む。マージで終わる。デプロイは、リポジトリのデプロイの仕組みが動く (autopilot は確かめない)
- 人間がするのは、取り消せない変更を含む PR の承認だけ
- 構成の違うリポジトリにも、setup の聞き取りで合わせて入れられる

**目標にしないこと**

- デプロイの仕組みが無いリポジトリに、デプロイの仕組みを新しく作ること
- 同時に動かす数の制限。コンフリクトは許容し、Claude が直す
- Renovate (#41)・Slack (#42)・セキュリティ監査 (#43)・振り返り (#44)。更新の反映 (#45) は、不要とユーザーが判断して閉じた (2026-11-12)

**失敗とみなすこと (動いても失敗)**

- 取り消せない変更が、人間の承認なしにマージ・デプロイされる (CODEOWNERS とルールセットの「コードオーナーのレビューを必須」で守る。4.6)
- 権限の無い人 (社外の人を含む) が書いた Issue だけで起動する
- 止まらずに回り続けて、費用が漏れる
- superpowers など、同梱のプラグインにあるスキルを autopilot で作り直す
- AI の自己申告 (「直りました」「テストは通るはず」) で完了にする

## 3. 共通の方針

#41〜#44 もこの方針に従う。

- 人間が承認するのは、取り消せない操作だけ (マイグレーション・データの削除・課金・メール送信・取り消せないインフラの操作など) と、autopilot を動かすファイルの変更。どれが当たるかは、AI に判断させず、CODEOWNERS に書いたパスで決める (GitHub が持ち主の承認を求める)
- 完了・マージの条件は「失敗しうる検査がすべて通ること」
- 止まる条件を決める (4.4)
- 毎回同じ答えになる見回りは、AI なしの GitHub Actions で行う。`needs-human` のラベルと自動マージの有効化は、開発のルーティンが GitHub の MCP で行う (4.1)。取り消せない変更の確認は、GitHub の標準の仕組み (CODEOWNERS とルールセット) で行う
- リポジトリに置くものは最小にする。GitHub Actions は autopilot-plugin の composite action を呼ぶだけにし、ルーティンのプロンプトは `/autopilot:〇〇` を呼ぶだけにする
- 会社ごとに違う部分は、`/autopilot:setup` が聞いてから提案・設定する
- 同梱のプラグインにあるスキルは使い、作り直さない。autopilot が作るのは、それらをつなぐ部分だけ

## 4. 全体の流れ

### 4.1 何がどこで動くか

2026-11-12 の確かめ (9.1) で、ルーティンは REST で GitHub のラベル・ステータスを書けないと分かった。そこで、いったんは、PR を作った後を GitHub の標準の仕組みと GitHub Actions に任せた。

2026-11-13 の確かめ (9.1) で、開発のルーティンは、GitHub の MCP で自動マージを有効にし、ラベルを付けられると分かった。PR を購読すれば、指摘や失敗の通知で起きて直せることも分かった。そこで、PR の後の対応と状態の変更も開発のルーティンが行い、GitHub Actions には AI なしの見回りだけを残す (ユーザーが決定)。

| 段階 | どこで動くか | 中身 |
|---|---|---|
| 開発 | ルーティン (`/autopilot:develop`) | Issue から受入条件・テスト・実装・動作確認・PR まで。GitHub への書き込みは git push・PR の作成・コメントと、GitHub の MCP (`update_pull_request`・`enable_pr_auto_merge`・`issue_write`) |
| CI | GitHub Actions (既存) | リポジトリのテスト・lint など |
| レビュー | GitHub Actions (既存の Claude のレビュー) | claude[bot] が Approve か Request changes を出す |
| QA | GitHub Actions のジョブ (claude-code-action) | アプリを起動して受入条件を確かめ、エビデンスを PR に載せる。ジョブの成否が結果 |
| 指摘への対応 | 開発のルーティン (PR の購読と GitHub の MCP) | 購読の通知で起き、`autopilot:fix` の手順で、Request changes・CI や QA の失敗・コンフリクトを直して push し、返信する |
| 取り消せない変更の確認 | GitHub の標準の仕組み | CODEOWNERS に書いたパスを変える PR は、持ち主の Approve があるまでマージできない (ルールセットの「コードオーナーのレビューを必須」) |
| マージ | GitHub の標準の仕組み | 必須のチェック・必須のレビュー・自動マージ |
| 状態の変更 | 開発のルーティン (PR の購読と GitHub の MCP) | ラベル・自動マージの有効化・Draft の切り替え |
| 見回り | GitHub Actions (AI なし) | 起動しなかった Issue のラベルを付け直す。コンフリクトや動きの無い PR に、App がコメントしてセッションを起こす (4.5) |
| 通知 | GitHub の Slack アプリ | `needs-human` などを、購読した Slack のチャンネルに知らせる (4.11) |

### 4.2 ラベルとコメントの印

ラベルは 2 つだけにする。`needs-human` を付けるのは、開発のルーティン (GitHub の MCP) と見回り (GitHub App のトークン)。見回りは、起動しなかった Issue の `autopilot:ready` を付け直す (4.5)。

| ラベル | 付く先 | 付ける人 | 意味 |
|---|---|---|---|
| `autopilot:ready` | Issue | triage 以上の権限がある人・見回り (付け直し) | 開発を始めてよい。開発のルーティンが起動する |
| `needs-human` | Issue・PR | 開発のルーティン・見回り | 止まった。人の判断が要る |

状態は、ラベルのほかに、HTML コメントの印で伝える。誰でも PR にコメントできるので、印を数えるときは、書いた人を確かめる。

| 印 | 書く人 | 意味 |
|---|---|---|
| `<!-- autopilot:needs-human -->` | 開発のルーティン・見回り | 進めない。理由は同じコメントに書く。`needs-human` のラベルを先に付け、このコメントを後に書く (4.4) |
| `<!-- autopilot:fix-round -->` | 開発のルーティン (PR に) | 対応を 1 回行った。回数を数えるのに使う。PR の作者が書いたものだけを数える (4.4) |
| `<!-- autopilot:undraft <sha> -->` | 開発のルーティン (PR に) | 今の head に直すことが無い Draft の PR を「レビュー可能」に戻した。head ごとに 1 回だけ戻すのに使う。PR の作者が書いたものだけを数える (4.3 の 6) |
| `<!-- autopilot:wake -->` | 見回り (App のボット。PR に) | 購読中のセッションを起こす。App のボットが書いたものだけを数える (4.5) |
| `<!-- autopilot:head <sha> -->` | 見回り (`wake` と同じコメントに) | 起こしたときの PR の head。head が変わると、前の印は数えない (4.5) |

autopilot の PR は、同じリポジトリのブランチ `autopilot/<Issue 番号>-<名前>` から出ている PR とする。

### 4.3 Issue 1 件の流れ

1. 人が Issue を書き、権限のある人が `autopilot:ready` を付ける
2. 開発のルーティンが起動する。REST で Issue のラベルを読み、`autopilot:ready` が無いか `needs-human` があれば、何もせずに終える。始めたら、デフォルトブランチから `autopilot/<番号>-dev` を作って空の commit を push し、本文に `Closes #<番号>` を入れた Draft PR を作る (GitHub のプロジェクトの画面で、作業中の Issue が見える。ブランチ名を番号だけで決めるので、ほぼ同時に 2 つ起動しても、後の push は断られる)
3. 受入条件を Issue にコメントする (ヒアリングしないと分からないときは、4.4 のとおり聞いて止まる。小さな選択は自分で決め、決めたことを書く)。その条件を確かめるテストを書き、直す前のコードで失敗するのを確かめてから実装する。ユニット・受入・E2E テストを通す
4. 同じブランチに push する。人と同じく、レビューを頼む前に、アプリを起動して受入条件を 1 つずつ確かめ (`skills/qa/self-check.md`)、スクリーンショット・録画・JSON を PR の本文の `## 動作確認 (<sha7>)` に書く。続けて、開発のルーティンが GitHub の MCP (`update_pull_request`) で、PR の本文 (動作確認・判断の理由・試してだめだった方法・テストの結果。最後の行は `Closes #<番号>`) を書き換え、「レビュー可能」にする。断られたら `needs-human` で止まる。「レビュー可能」にしたら、GitHub の MCP (`enable_pr_auto_merge`) で自動マージを有効にし、PR を購読する (`subscribe_pr_activity`)
5. PR が「レビュー可能」になると、GitHub Actions で Claude のレビュー・QA のジョブが動く。QA のジョブは、コードを書いていない別の Claude が、別の環境で受入条件を確かめ直す (必須のチェック) (CI は Draft のときから動く)。CODEOWNERS のパスを変える PR では、GitHub が持ち主にレビューを頼む
6. Request changes・CI の失敗・QA の失敗があると、購読の通知で開発のルーティンのセッションが起き、`autopilot:fix` の手順で直す。PR の本文の記録と指摘を読み、指摘ごとに採否を決め、直して push し、返信する。Claude のレビューが PR を Draft に戻していれば、GitHub の MCP で「レビュー可能」に戻す。今の head に直すことが無いとき (古い head への Request changes・任意の指摘だけの Request changes) も、head ごとに 1 回、`<!-- autopilot:undraft <sha> -->` を書いて戻す
   - コンフリクトや、長く動きの無い PR は、通知が来ないことがある。見回りがコメントしてセッションを起こす (4.5)
   - ルーティンの持ち主が PR に書いたコメントでは、セッションは起きない (同じアカウントの書き込みは通知されない)。持ち主が直してほしいときは、ルーティンの commit の `Claude-Session:` の行のリンクから、そのセッションに直接書く
7. 必須のチェックと必須のレビュー (claude[bot] の Approve。CODEOWNERS のパスを変える PR では、持ち主の Approve も) がそろうと、GitHub の自動マージでマージされる
8. マージの後は、リポジトリのデプロイの仕組みが動く (デプロイがあるリポジトリだけ)。autopilot は、デプロイを動かさず、確かめない (4.8)

### 4.4 止まる条件

- 開発のルーティンが対応を上限の 3 回行った後に、また失敗した → 4 回目は直さずに `needs-human` を付けて止まる (スキル `autopilot:fix` の手順で守る)
  - 回数は、PR の作者が書いた `<!-- autopilot:fix-round -->` のコメントのうち、Issue に最後に `autopilot:ready` が付いた後のものを数える (付け直すと数え直す)
  - 上限は、デフォルトブランチの `.github/autopilot.yml` の `limits.max_fix_rounds` (既定 3)
  - 止まるのは、今の head に直すこと (Request changes の指摘・失敗したチェックや QA・コンフリクト) があるときだけで、任意の指摘 (optional・nit など。承認のレビューの指摘は、直す必要があると書かれない限り任意) は、数えず、push も返信もしない
- 同じ失敗が 2 回続いた → 開発のルーティンが止まり、`<!-- autopilot:needs-human -->` 付きのコメントで、何が同じかを書く
- 開発のルーティンが進めない (Issue があいまいで受入条件が書けない、受入条件は書けても、ヒアリングしないと成果物がずれそうなとき、など) → 同じ印のコメントで、質問と案 (おすすめつき) を書いて止まる。権限 (triage 以上) のある人が答えを Issue にコメントし、`needs-human` を外し、`autopilot:ready` を一度外してから付け直すと再開する
- 見回り (4.5) で、付け直しても始まらない Issue か、起こしても直らない PR が見つかった → `needs-human`
- `needs-human` の付いた Issue・PR では、開発のルーティンも見回りも動かない。人が Issue の `needs-human` を外し、`autopilot:ready` を一度外してから付け直すと再開する (付けたままでは `issues.labeled` が起きず、ルーティンは起動しない)。PR の `needs-human` は、再開した開発のルーティンが外す
- 止まるときは、`needs-human` のラベルを先に付け、印のコメントを後に書く。GitHub の Slack アプリが、ラベルの付いた Issue・PR へのコメントとして Slack に知らせるため (4.11)。何が起きて何をしてほしいかは、そのコメントに書く

### 4.5 見回り (GitHub Actions、AI なし、1 時間ごと)

開発のルーティンには `send_later` が無く、見直しを予約できない。コンフリクトや、ほかの人の push は、購読の通知が来ないことがある (9.1)。そこで、見回りが、困っている PR に App のボットでコメントし、購読中のセッションを起こす。

`needs-human` の付いた Issue・PR では、これまでどおり何もしない。

| 対象 | 条件 | すること |
|---|---|---|
| Issue | `autopilot:ready` が付いてから `ready_retry_minutes` (既定 30 分) たっても、開発が始まらない (ラベルより後に作られたか更新された、開発の PR が無い) | 1 回目は付け直す (App のトークンで付けたラベルでも起動することは確かめ済み)。2 回目からは `needs-human`。回数は、`needs-human` が最後に外された後から数える |
| PR | コンフリクト (`mergeable_state` が `dirty`) か、`stale_hours` (既定 3 時間) 動きが無い。今の head への印が無い | 起こす (`wake`) |
| PR | 同じ条件で、今の head への印があり、いちばん新しい印から `stale_hours` たった | `needs-human` (理由: `起こしても、{staleHours} 時間直りませんでした ({コンフリクト / 動きがありません})`) |
| PR | 同じ条件で、今の head への印があり、まだ `stale_hours` たっていない | 何もしない |
| PR | 動きが無いが、人にレビューを頼んでいて、まだ届いていない (`requested_reviewers` か `requested_teams` がある。CODEOWNERS の持ち主の Approve 待ちなど)。コンフリクトは無い | 何もしない (起こしても直すことが無く、`needs-human` にすると、持ち主の Approve でマージされなくなるため。コンフリクトなら、上の 3 行のとおり) |

起こすコメントの本文 (この文字のまま):

```
<!-- autopilot:wake -->
<!-- autopilot:head {headSha} -->
autopilot の見回り: {理由}。開発のセッションは、この PR を見直して、直すことがあれば直してください。
```

`{理由}` は `コンフリクトがあります (デフォルトブランチを取り込んでください)` か `{staleHours} 時間動きがありません`。

- 印は、App のボットが書いたものだけを数える (誰でも PR にコメントできるため)
- 同じ head で起こすのは 1 回だけ。セッションが push して head が変わると、前の head の印は数えない
- 開発中の Draft PR は、まだ購読されていないので、起こすコメントはセッションに届かない。そのような PR は、`stale_hours` の 2 倍ほどで `needs-human` になる
- 開発が始まったかは、開いている `autopilot/<番号>-` の PR が、ラベルより後に作られたか、ラベルより後に更新された (`updated_at`) かで決める。前の PR を使い続ける再開では、開発のルーティンが、始めにデフォルトブランチを取り込んで push する。PR が更新され、head も変わるので、前の head の印も数えない
- 「動きが無い」は、PR の `updated_at` から `stale_hours` たったこと。`updated_at` は、起こすコメントでも更新される
- 1 時間ごとなので、GitHub Actions の時間は 1 リポジトリで月 720 分ほどになる (1 回を 1 分に切り上げて数える)

### 4.6 マージの条件

GitHub の標準の仕組みで決める。setup が、リポジトリのルールセットに次を設定する。

- **必須のチェック:** 設定に書いた CI のジョブ・QA のジョブ。必須にするチェックは、PR ごとに必ず結果が出るものにする (`paths:` で飛ぶジョブは必須にしないか、いつも動くジョブにまとめる。setup が確かめる)
- **必須のレビュー:** 1 件。claude[bot] の Approve が数えられることは確かめ済み。push の後は、古い Approve を取り消す。push の後に CI が終わっても今の head へのレビューが付かなければ、開発のルーティンが head ごとに 1 回、`review.trigger` によらず `review.command` (既定 `/code-review`) をコメントして、レビューを頼み直す (9.1)。コードオーナーのレビューを必須にする (下の CODEOWNERS)
- **自動マージ:** autopilot の PR では、開発のルーティンが GitHub の MCP (`enable_pr_auto_merge`) で有効にする (4.3 の 4)。Web のセッションでは GraphQL を使えないが、MCP では有効にできる (9.1)

**CODEOWNERS (GitHub の標準の仕組み):** setup が `.github/CODEOWNERS` に、人の承認が要るパス (4.7) と、その持ち主 (GitHub のユーザー名か team) を書く。ルールセットの「コードオーナーのレビューを必須」で、そのパスを変える PR は、持ち主の Approve があるまでマージされない。持ち主は人なので、claude[bot] の Approve だけではマージされない。PR の作者は、自分の PR を Approve できない。持ち主には、GitHub がレビューの依頼を知らせる (Slack には送らない。GitHub の Slack 連携を入れれば、Slack にも出せる)。autopilot 以外の PR でも同じように効く。

### 4.7 取り消せない変更の見分け方

人の承認が要るパスを、setup が会社ごとに聞いて CODEOWNERS に書く。AI には判断させない。

- **autopilot を動かすファイル:** `.github/` (ワークフロー・設定・CODEOWNERS 自身)・`.claude/`・`.mcp.json`・git の hook の設定 (`lefthook.yml`・`.lefthook.yml`・`lefthook.yaml`・`.pre-commit-config.yaml`・`.husky/`)。AI の PR が、人の承認なしに、自分の検査・ワークフロー・設定を変えられないようにするため。前の版の「いつも取り消せない変更とみなすパス」(計画の R19) は、ここに移った
- **検査を定めるファイル:** CI・lefthook・Claude の Stop の hook・動作確認が呼ぶ `style:check`・`security:check`・`dev:up` を書いたタスクランナーのファイル (`Taskfile.yml`・`Makefile`。タスクがルートの `package.json` の `scripts` にあれば `package.json`。そのときは、依存を足す PR にも持ち主の Approve が要る) と、セキュリティの検査の設定・除外のファイル (`.gitleaks.toml`・`.gitleaksignore`・`.semgrepignore`・`trivy.yaml`・`.trivyignore`・`.trivyignore.yaml`)。AI の PR が、人の承認なしに、検査を空にしたり除外を足したりできないようにするため (4.12)。リポジトリに無いファイルの行は書かない
- **マイグレーション:** 例 `/backend/migration/versions/`
- **Terraform:** 例 `/infrastructure/`。apply がマージで動くと、Approve の後に取り消せない操作が自動で走る。setup は、apply を手動のワークフローか別のリポジトリにする案を勧める (作りはしない。2 章の「デプロイの仕組みを新しく作らない」)。plan を読んで削除を見分けることはしない
- **そのほか:** 会社が挙げたもの (課金・メール送信のコードのパスなど)

### 4.8 デプロイ

マージの後は、リポジトリのデプロイの仕組みに任せる。失敗の知らせは GitHub の Slack アプリ (4.11)。

- autopilot は、デプロイを起動しない。本番での確認と、自動のロールバックもしない (2026-11-13 にやめた。12 章)
- デプロイの仕組みが無いリポジトリでは、マージで終わる

### 4.9 GitHub の操作で注意すること

確かめたこと (2026-11-12・2026-11-13 時点。9.1 も参照):

- Web のセッション (ルーティンを含む) では、GraphQL が使えない。`gh pr`・`gh issue` は動かず、`gh api` (REST) だけが使える ([cloud-environments](https://code.claude.com/docs/en/cloud-environments.md))
- ルーティンでは、REST でのラベル・ステータスの書き込みが自動モードに拒否される。`.claude/settings.json` で許可しても変わらない。REST でのブランチ作成は、GitHub のプロキシに拒否される。コメントは書ける
- GitHub の MCP では、自動マージの有効化 (`enable_pr_auto_merge`) と、ラベルの付け替え (`issue_write`) が、自動モードで通る (2026-11-13)
- そのため、ルーティンが GitHub に書くのは、git push・PR の作成・コメントと、GitHub の MCP での PR の本文の書き換え・Draft の切り替え (`update_pull_request`。9.1 の 5)・自動マージの有効化と止めること (`enable_pr_auto_merge`・`disable_pr_auto_merge`)・ラベルの付け替え (`issue_write`) だけにする。ラベル・自動マージは MCP で行う。REST のラベルは拒否される
- GitHub Actions の `GITHUB_TOKEN` で行った操作では、ほかのワークフローが起動しない (`workflow_dispatch`・`repository_dispatch` を除く)。自動マージは、開発のルーティンが、持ち主のアカウントで GitHub の MCP から有効にするので、この制限に当たらない。前の版では GitHub Actions が有効にしていて、`GITHUB_TOKEN` では、マージの push で main の CI もデプロイも動かないため、App のトークンを使った
- autopilot の GitHub Actions (見回り) と claude-code-action (QA) は、会社ごとに作る GitHub App のトークンで操作する (6.2)。App のトークンで付けたラベルでルーティンが起動することは、確かめ済み (見回りの付け直しで使う)

### 4.10 エビデンス

人があとで確かめられるように、確かめた証拠を PR に載せる。

| 誰が | 載せるもの |
|---|---|
| 開発のルーティン | テストの結果 (ユニット・受入・E2E の件数と、失敗から成功に変わったテスト) と、動作確認 (受入条件ごとのスクリーンショット・録画・JSON)。PR の本文に書く |
| QA のジョブ | 画面のスクリーンショット、操作の動画 (Playwright の録画)、API の応答などの JSON、確かめた手順 |
| 開発のルーティン (対応) | 直した後の新しい commit での動作確認 (本文の `## 動作確認` を置き換える) |

- PR のコメントに、何を確かめたかと、エビデンスへのリンク (画像は埋め込み) を書く
- ファイルを置く場所は、作る人が決める。条件は次のとおり
  - main に入らない (マージで本体のコードに混ざらない)
  - リポジトリを読める人だけが見られる (非公開のリポジトリで外に出さない)
- シークレットや個人情報が写る画面・応答は、載せる前に伏せる

### 4.11 Slack への通知 (GitHub の Slack アプリ)

人への依頼や報告は、すべて Issue ではなく Slack に送る。人は Issue も PR も見ないため。

| いつ | 種類 |
|---|---|
| `needs-human` が付いた (4.4) | 依頼 |
| リポジトリのデプロイが失敗した (4.8。autopilot は戻さない) | 依頼 |

- 送るのは GitHub の Slack アプリ。Slack のチャンネルで、リポジトリを購読する。ラベルで絞れる (例 `+label:"needs-human"`)。setup が購読のコマンドを案内する
- マージの知らせが欲しいときは、setup が `pulls` の購読も案内できる (入れなくてもよい)
- `needs-human` は、ラベルの付いた Issue・PR へのコメントとして届く。何が起きて何をしてほしいかは、そのコメントに書く (4.4)
- autopilot は Slack に直接送らない (2026-11-13 に変えた。12 章)
- 人の承認の依頼 (CODEOWNERS のパスを変える PR) は、GitHub のレビューの依頼で持ち主に届く

### 4.12 検査と起動のタスク (lint・型検査・シークレット・脆弱性・アプリの起動)

プラグインの検査の hook (編集後・commit 前・push 前) はやめ、`/autopilot:setup` が各リポジトリに入れる (ユーザーが決定)。起動時の hook (Web の環境の準備) はプラグインに残す。

検査と起動は、リポジトリのタスクランナーの 4 つのタスクにそろえる。人 (lefthook)・CI・Claude の hook・動作確認・QA は、どれもこのタスクを呼ぶ (ユーザーが決定)。検査の条件を 1 か所に書き、どこで動かしても同じ結果にするため。

| タスク | 中身 |
|---|---|
| `style:check` | スタイルの検査 (lint・整形・型・依存)。直さない |
| `style:fix` | スタイルの自動修正 |
| `security:check` | セキュリティの検査 (Gitleaks・Semgrep・Trivy fs など) |
| `dev:up` | アプリの全部を後ろで起動し、準備ができるまで待って終わる (MCP サーバーがあれば、その応答も確かめる)。ログは `dev:logs`、止めるのは `dev:down` |

- タスクランナーは、リポジトリにあるもの (Taskfile・Makefile・`package.json` の scripts) を使い、そのランナーに同じ名前のタスクを作る。Make のターゲットには `:` をそのまま書けないので、`style-check` のようにする。タスクランナーが無ければ Taskfile を足す
- hook・lefthook・CI・`qa.start` からは、そのタスクのコマンド (例: `task style:check`) を呼ぶ

| 時点 | 動かすもの | どこに書くか |
|---|---|---|
| 編集のたび (PostToolUse) | 動かさない (`style:fix` が、使う前に足した import を消すため) | |
| Claude が作業を終えるとき (Stop) | `style:fix` → `style:check`。通らなければ exit 2 で Claude に直させる。上限は 30 分 (1800 秒) | リポジトリの `.claude/settings.json` の hooks |
| commit 前 | `style:check` と、Gitleaks の `--staged` (commit に入る差分だけ) | リポジトリの lefthook (`pre-commit`) |
| push 前 | `security:check` | リポジトリの lefthook (`pre-push`) |
| CI | `style:check`・`security:check` (例: `task style:check`。5 の `required_checks` の例と同じ)。組織の共通ワークフローでセキュリティの検査をしているリポジトリでは、`security:check` は動かさない | リポジトリの CI のワークフロー |
| 動作確認・QA | `dev:up` (`qa.start` を `task dev:up` などにする)。人・Claude の動作確認・QA が同じ方法で起動する | `.github/autopilot.yml` の `qa.start` |

- Stop の hook は、`stop_hook_active` が true (止めた後の 2 回目) のときは動かさない。止め続けて回り続けないため。2 回目に残った問題は、commit 前の検査と CI が見る。変えたファイルが無い (`git status --porcelain` が空) ときも動かさない
- lefthook は git の hook なので、Claude だけでなく、人がターミナルで commit・push したときにも動く
- Web の環境では、起動時の hook が `lefthook install` を行う
- すでに lefthook や pre-commit を使っているリポジトリでは、足りない検査だけを足す

## 5. 設定ファイル `.github/autopilot.yml`

setup が聞き取った答えを書く。GitHub Actions の処理 (見回り) と、QA のジョブと、開発のルーティン (対応の回数の上限) が読む。項目の例:

```yaml
review:
  # 既存の Claude のレビュー。判定を出すアカウントと、起動のしかた
  reviewer: claude[bot]
  trigger: ready_for_review   # ready_for_review / comment (例: "/code-review") / none (autopilot が入れる)
required_checks:
  - task style:check
  - task test
  - task dev:e2e
qa:
  start: task dev:up   # アプリを起動するコマンド (タスクランナーの dev:up。人・動作確認・QA が使う)
  url: http://localhost:3000
limits:
  max_fix_rounds: 3   # 対応の回数の上限。開発のルーティンが、デフォルトブランチの値を読む
  stale_hours: 3
```

項目の名前と形は、作る人が決めてよい。前の版で使っていた `notify`・`deploy` などの項目は読まない。書いてあっても無視する (入れ済みのリポジトリの設定を壊さないため。12 章)。

## 6. 作るもの

### 6.1 スキルとプロンプト

| 名前 | 動く場所 | 内容 | 使う既存のスキル |
|---|---|---|---|
| `/autopilot:setup` | PC の Claude Code | `/autopilot:onboard` を改名し、7 章の手順を足す | — |
| `/autopilot:develop` | ルーティン | 4.3 の 2〜4。オーケストラエージェントが、開発エージェントに作業を分ける | superpowers の test-driven-development・subagent-driven-development・verification-before-completion |
| QA のプロンプト | GitHub Actions (claude-code-action) | 4.3 の 5 の QA | playwright |
| `autopilot:fix` | 開発のルーティン (購読の通知で起きたセッション) | 4.3 の 6。対応の回数の上限 (4.4) も、この手順で守る | superpowers の receiving-code-review・systematic-debugging |

既存のスキルで足りるところは、スキルを呼ぶだけにする。claude-code-action で同梱のプラグインを使えるかは、作る人が確かめる。使えなければ、プロンプトにそのスキルの要点だけを書く。

### 6.2 GitHub Actions

| もの | 内容 |
|---|---|
| composite action `actions/autopilot` | AI なしの処理。コマンドは `sweep` (見回り。4.5) だけ。`automation/` の TypeScript を Bun で動かす |
| QA のジョブ | claude-code-action でアプリを起動し、受入条件を確かめる |
| Claude のレビュー | 無いリポジトリには、`theindiehacker/github-workflows` の claude-code-review を呼ぶワークフローを置く |

- リポジトリには、これらを呼ぶ短いワークフローを 1 つ置く
- **トークン:** 会社ごとに作る GitHub App のトークン (`actions/create-github-app-token`) で操作する。App の ID と秘密鍵は、リポジトリか org のシークレットに入れる。App は人に結び付かず、期限も無い。権限は、使う操作に絞る
- **claude-code-action の認証:** `CLAUDE_CODE_OAUTH_TOKEN` か `ANTHROPIC_API_KEY`。setup がどちらを使うかを聞く
- CI が無いリポジトリには、setup がそのリポジトリ用の CI を作る
- 版の指定は、commit の SHA と `# v<version>` (R37)

### 6.3 ルーティン (setup が作る)

| ルーティン | トリガー | プロンプト |
|---|---|---|
| 開発 | Issue のラベルの変更 (`issues.labeled`) | `/autopilot:develop` を実行する |

- RemoteTrigger の `create` (スケジュールなし、`clear_mcp_connections: true`) と `create_webhook_trigger` (`{routine_trigger_id, source: "github", hook_type: "app", scope_id: "<owner>/<repo>", events: ["issues.labeled"]}`) で作る。API の絞り込みは効かないので付けず、ルーティンが最初にラベルを確かめる
- Issue の本文は、指示ではなくデータとして扱う (プロンプトインジェクション対策)。スキルにもそう書く
- 環境は、README の手順で作った Web の環境 (セットアップスクリプトでプラグインを入れる) を使う

## 7. `/autopilot:setup`

### 7.1 前提

- PC の Claude Code で実行する。クラウドのセッションでは `/schedule` が使えず、ルーティンを作れないため
- ルーティンの持ち主にする claude.ai のアカウントでログインして実行する

### 7.2 手順

1. **調べる:** 技術スタック・CI・Claude のレビュー・デプロイ・DB とマイグレーション・IaC・compose・ルールセット・デフォルトブランチ・Renovate・`.claude/`
2. **聞く:** 7.3 の項目。調べて分かったことは、確かめるだけにする
3. **提案する:** 変える内容の一覧を見せる。技術スタックが方針と違うときは、モダンな技術スタックへの移行 (npm → bun など) を推奨として提案し、移行するかはユーザーが選ぶ。Terraform の apply がマージで動くなら、手動のワークフローか別のリポジトリにする案を勧める (作りはしない)
4. **変える:** 技術スタックの移行・Web で Docker・検査 (4.12)・シークレットと脆弱性の手順に加えて、次を行う
   - CI と Claude のレビューが無ければ用意する
   - ラベルを 2 つ作る
   - `.github/autopilot.yml` を書く
   - autopilot のワークフロー (6.2) を置く
   - `.github/CODEOWNERS` を書く (4.7)
5. **人に頼む:** 画面でしかできないことの手順を示す
   - クラウドの環境 (セットアップスクリプト・ネットワーク・環境変数)
   - Claude の GitHub App の導入
   - autopilot 用の GitHub App の作成と導入 (setup が、要る権限を入れた作成の画面へ案内する)
   - GitHub の Slack アプリの導入と、チャンネルでの購読 (setup が購読のコマンドを案内する。4.11)
   - シークレットの登録 (GitHub App・claude-code-action の認証)
6. **ルールセットを作る:** 4.6 のとおり (必須のチェック・必須のレビュー 1 件・push で古い Approve を取り消す・コードオーナーのレビューを必須)。org のルールセットは変えず、変える必要があればユーザーに伝える
7. **ルーティンを作る:** 6.3 の 1 つ。ルーティンはいまログインしている claude.ai アカウントのものになるので、選んだアカウントでログインしているかを先に確かめる
8. **PR を作る:** 変更を 1 つの PR にまとめる

### 7.3 聞くこと

| 項目 | 例 |
|---|---|
| 技術スタックを移行するか | npm → bun、ESLint → Biome、mypy → ty |
| タスクランナー・git hook | Taskfile・Makefile・mise、lefthook・pre-commit |
| 必須にするチェック | lint・ユニットテスト・E2E。CI で動いていないテストがあれば、動かすか |
| Claude のレビュー | 既存のものを使うか。起動のしかた (自動・コメント) |
| Web の環境でアプリを起動できるか | GPU・クラウドの認証情報が要るときの QA のしかた |
| 人の承認が要るパスと、その持ち主 | CODEOWNERS。初めの値は、autopilot を動かすファイル・マイグレーション・Terraform (4.7)。持ち主は GitHub のユーザー名か team |
| Terraform の apply の方針 | マージで動くか。動くなら、手動のワークフローか別のリポジトリにする案を勧める |
| Slack の通知先 | GitHub の Slack アプリで購読するチャンネル |
| アカウント | 7.4 |
| デフォルトブランチ | main・master |

### 7.4 アカウント

claude.ai と GitHub のどちらも、自動化専用のアカウントと個人のアカウントから選べる。

| | 自動化専用のアカウント | 個人のアカウント |
|---|---|---|
| claude.ai | 個人の使用量と分けられる。人が休んでも止まらない | その人の使用量を使う |
| GitHub | PR の作者が専用のアカウントになる。持ち主 (CODEOWNERS) は誰でも Approve できる | PR の作者がその人になる。その人は自分の PR を Approve できないので、CODEOWNERS のパスを変える PR は、別の持ち主が Approve する |

- ルーティンは、持ち主の claude.ai のアカウントに結び付いた GitHub のアカウントで、commit と PR を作る ([routines](https://code.claude.com/docs/en/routines.md))
- GitHub は、autopilot のリポジトリだけに届く、自動化専用のアカウントを勧める。ルーティンは、そのアカウントの権限で書き込み、PR の指摘も直すため。公開リポジトリでは、強く勧める (8 章)
- そのアカウントが PR に書いたコメントでは、購読中のセッションは起きない (同じアカウントの書き込みは通知されない。9.1)。個人のアカウントを選んだ人が直してほしいときは、ルーティンの commit の `Claude-Session:` の行のリンクから、そのセッションに直接書く (4.3 の 6)
- 個人の GitHub アカウントを選んだときは、setup が、持ち主 (CODEOWNERS) にその人以外がいるかを確かめる。いなければ、そのパスを変える PR がマージできなくなることを伝える (試験では、ほかに持ち主がいないので、管理者がルールセットを迂回してマージした)

## 8. セキュリティ

- 起動のきっかけは、triage 以上の権限がある人しか付けられない `autopilot:ready` だけにする。開発のルーティンは、ラベルを付けた人の権限を REST で確かめてから始める。Issue のテンプレートで、このラベルを自動で付けない
- Issue・PR・コメントの本文は、指示ではなくデータとして扱う
- 開発のルーティンが受入条件の材料にする Issue のコメントは、権限が triage 以上の人のものだけにする。ほかの人のコメントは読まず、読まなかったことを受入条件のコメントに書く
- コメントの印 (4.2) は、書いた人を確かめて数える。対応の回数は PR の作者が書いた `fix-round` だけ、起こした回数は App のボットが書いた `wake` だけを数える
- QA のジョブは、同じリポジトリから出た autopilot の PR でだけ動く。フォークの PR のコードは動かさない
- 指摘への対応を、GitHub Actions のジョブから、開発のルーティンのセッション (PR の購読) に移したので、信頼の形が変わった (2026-11-13)
  - 書き手の絞り込み: 前は、ワークフローの `if:` (コード) が、権限のある書き手の指摘でだけ、対応のジョブを動かした。今は、購読の通知は、だれの書き込みでも届く。`autopilot:fix` の手順で、モデルが書き手を確かめて無視する。この判断は、信頼できない文を読んだ後に行う
  - 書き込みの権限: 前は、リポジトリに限った App のトークン。今は、ルーティンの持ち主の GitHub の権限で、持ち主が届くところすべてに届く
  - 公開リポジトリでは、だれのコメントも、自動モードのセッションに入る
  - そのため、setup は、autopilot のリポジトリだけに届く、自動化専用の GitHub アカウントを勧め、公開リポジトリでの注意を伝える (7.4)
- autopilot のワークフローは見回りだけになり、`pull_request_target`・`workflow_run` のトリガーが無くなる
- 取り消せない変更の Approve は、Approve した人が持ち主かを、GitHub (CODEOWNERS とルールセット) が確かめる。CODEOWNERS 自身と、autopilot を動かすファイル (4.7) も持ち主のパスにし、AI の PR が、持ち主や検査を書き換えられないようにする
- エビデンスに、シークレットや個人情報を載せない
- Web の環境の環境変数・シークレットは、最小の権限にする

## 9. 作る前に確かめること

試しに動かして確かめる。結果で設計が変わるときは、ユーザーに伝える。

1. claude[bot] の Approve が、ルールセットの「承認 1 件」に数えられるか
2. autopilot 用の GitHub App のトークンで付けたラベルで、ルーティンが起動するか (見回りの付け直しで使う)
3. PR のラベルのトリガーで、PR の番号がセッションに渡るか
4. Web のセッションから `gh api` (REST) で、ラベルの付け替え・コミットのステータス・Draft PR の作成ができるか
5. Web のセッションから、Draft から「レビュー可能」への切り替えができるか
6. setup から RemoteTrigger でルーティンと GitHub トリガーを作れるか

### 9.1 確かめの結果 (2026-11-12・2026-11-13)

2026-11-13 の行は、試験 1 のリポジトリ (デプロイの無いテンプレートのリポジトリ) の試験の PR で確かめた。ブランチは `autopilot/` で始めない名前にし、そのときのワークフローと混ざらないようにした。

「(試験 1)」の行は、2026-11-13 に、本物の開発のルーティン (ユーザーが作ったもの、自動モード) で確かめた。新しいプラグインを入れた環境の写しを使った。

| 確かめ | 結果 | 設計への影響 |
|---|---|---|
| 1. claude[bot] の Approve が承認 1 件に数えられるか | 数えられる (`reviewDecision` が `APPROVED`) | 変えない |
| 6. setup からルーティンと GitHub トリガーを作れるか | 作れる。スケジュールなしのルーティンを `create` で作り、`create_webhook_trigger` に `{routine_trigger_id, source: "github", hook_type: "app", scope_id: "<owner>/<repo>", events: ["issues.labeled"]}` を渡す | 変えない |
| 6'. API でラベルの絞り込みを付けられるか | `filter` は受け付けられるが効かず、どのラベルでも起動する。API でトリガーは消せない | ルーティンは、起動したら最初に REST でラベルを確かめ、対象外なら何もせず終える |
| 3. イベントの中身が渡るか | `<github-trigger-context>` で、イベント名・リポジトリ・Issue/PR の番号と URL が渡る。PR では、ブランチと最新のコミットも渡る。ラベル名は渡らない | 上と同じく、ラベルは REST で読む |
| 4. Web のセッションから REST で書き込めるか | コメントは書けた。ラベルとステータスは、ルーティンの自動モードに拒否された (「頼まれていない連携アプリへの書き込み」「自分の作業を自分で承認している」)。リポジトリの `.claude/settings.json` で許可しても変わらなかった。REST でのブランチ作成は、GitHub のプロキシに拒否された (403) | ルーティンは開発だけにし、書き込みは git push・PR の作成・コメントに絞る。状態の変更は GitHub Actions が行う (4.1・4.9) |
| (追加) プラグインの commit 前の hook | `Bash(*git*commit*)` が commit 以外のコマンドにも合い、Web では `next typegen` が無く型検査が失敗して、ルーティンの commit を止めた | 4.12 のとおり、リポジトリの lefthook に移す |
| 2. App のトークンで付けたラベルで起動するか | 起動する (`autopilot-theindiehacker[bot]` が付けた 2 秒後に起動) | 変えない |
| 5. Draft から「レビュー可能」への切り替え | できる。開発のルーティンが GitHub の MCP の `update_pull_request` で、本文と `draft: false` を 1 回で渡した (2026-11-12 の試験) | Draft の切り替えはルーティンが行う |
| (追加) CODEOWNERS のパスを変える PR が、持ち主の Approve までマージされないか | 未確認。前の仕組み (GitHub Actions が付ける独自のステータス) では、`.github/` を変える PR が承認を待つことを確かめた。ルーティンの PR の作者がユーザー自身で、ほかに持ち主がいないので、管理者がルールセットを迂回してマージした | 試験 (10 章) で、CODEOWNERS の形でも確かめる |
| (追加) ルーティンからの git push と PR の作成 | 未確認 (Web の環境の古いプラグインの hook が push を止めた)。新しいプラグインを入れた環境で、試験 (10 章) の最初に確かめる | — |
| (2026-11-13) GitHub の MCP で自動マージを有効にできるか | できる。`enable_pr_auto_merge` (squash) が自動モードで通った。`pull_request_read` (get) の結果には自動マージの欄が無い (REST の `.auto_merge` で読む) | 自動マージは、開発のルーティンが有効にする (4.6) |
| (2026-11-13) PR を購読して、通知で直せるか | できる。`subscribe_pr_activity` が通った。CI の失敗 (`check_run.completed` の failure) の通知で、20 秒ほどで起きて直し、push した (2 回)。古い commit の CI の失敗は、直すことが無いと見分け、何もしなかった | 指摘への対応は、開発のルーティンが購読して行う (4.3 の 6) |
| (2026-11-13) 対応の回数の上限を、スキルの指示で守れるか | 守れた。上限 2 回の試験で、3 回目の失敗では直さずに止まった | 上限はスキルの手順で守る (4.4) |
| (2026-11-13) 機械が回収された後 (接続が切れた後) も、通知で起きるか | 起きる。新しい機械で起き、続きから進んだ (起きるまで 25 秒〜2 分) | 対応を購読に任せる (4.1) |
| (2026-11-13) GitHub の MCP で `needs-human` を付けられるか | 付けられた (`issue_write`)。`issue_read` の `get_labels` は、PR の番号では失敗した (`get` なら読める) | ラベルは、開発のルーティンが MCP で付ける (4.2・4.9) |
| (2026-11-13) どの書き込みの通知で起きるか | ルーティンの持ち主 (同じ GitHub のアカウント) が書いた PR のコメントでは、通知が届かず、起きなかった。claude[bot] のレビュー・コメントと、github-actions[bot] のコメントは届いた (コメントの書き直しのたびに起きる)。autopilot の App のボットのコメントは、この確かめに入っていない | 持ち主が直してほしいときは、セッションに直接書く (4.3 の 6)。見回りは、App のボットのコメントで起こす (4.5) |
| (2026-11-13) 開発のルーティンの道具と、購読の初めの規則 | ルーティンには `send_later` が無い (見直しの予約ができない)。`subscribe_pr_activity` と GitHub の MCP はある。購読の初めの規則 (Claude Code on the web の標準) では、コンフリクトや、ほかの人の push は、通知が来ないことがある。`send_later` があれば、50 分後とその後 4 時間ごとに見直す | コンフリクトや動きの無い PR は、見回りがコメントして起こす (4.5) |
| (2026-11-13) 確かめた場所 | 開発のルーティンと同じ Web の環境・自動モードの、別のセッション。本物のルーティン (ユーザーが作ったもの) は、エージェントから起動できなかった (`fire_trigger` は、エージェントが作ったルーティンだけ)。エージェントが `create_trigger` で作ったルーティンには、リポジトリも GitHub の MCP も付かなかった | 本物のルーティンでは、試験 1 のリポジトリで確かめ直す |
| (試験 1) 見回りだけのワークフロー | `workflow_dispatch` で動き、成功した | 変えない |
| (試験 1) 自動マージの有効化 (MCP) | ルーティンが有効にし、必須のチェックとレビューがそろうと、人の手なしでマージされた | 変えない |
| (試験 1) PR の購読と対応 | レビューの指摘 (optional) に返信し、直した。CI・QA の結果の通知で起きた。fix-round の印を書いた | 変えない |
| (試験 1) コンフリクト | 先に別の PR がマージされてコンフリクトした PR は、セッションが購読の直後の直しや次の通知のときに、自分でデフォルトブランチを取り込んで直した (3 件)。見回りの起こすコメントまで行く場面は無かった | 変えない |
| (試験 1) App のボットのコメントで起きるか | QA のボット (App) のコメントで、購読中のセッションが起きた。見回りの起こすコメントも同じ App のボットが書くので、届く | 変えない (見回りは、App のボットのコメントで起こす。4.5) |
| (試験 1) 聞いて止まる | 金額が書かれていない Issue で、質問と案 (おすすめつき) を書いて止まった。Issue と Draft の PR の両方に、MCP で `needs-human` を付けた | 変えない |
| (試験 1) Slack の知らせ | GitHub の Slack アプリの購読 (`+label:"needs-human"`) で、止まったことと質問のコメントが届いた。前提は、Slack で `/github signin` を打つことと、GitHub の側で Slack のアプリ (https://github.com/apps/slack) を組織に入れ (「Install on another account」)、リポジトリを選ぶこと。入れていないと「`I couldn't find <owner>/<repo>`」と出る | setup の 6-C に、購読の前提を書く (4.11) |
| (試験 1) 再開 | Issue の `needs-human` を外し、答えをコメントし、`autopilot:ready` を付け直すと、新しいルーティンが前の Draft の PR を使った。PR の `needs-human` を外し、すぐに「再開する」の commit を push し、答えどおりに作った | 変えない |
| (試験 1) MCP の `issue_write` で `labels: []` | ラベルがすべて消えた (空の一覧が効く) | 変えない |
| (試験 1) 小さな選択 | あいまいな Issue でも、小さな選択なら自分で決め、受入条件のコメントに「決めたこと」を書いて進めた | 変えない |
| (試験 1) 同じ Issue で 2 回起動 | 2 回目は同じセッションに入り、「始め済み」で何もしなかった | 変えない |
| (試験 1) 持ち主の書き込みの通知 | 持ち主のアカウントが書いた PR のレビューのコメント (返信) は、同じアカウントのセッションに届いた。前の試験では、持ち主の `issue_comment` は届かなかった。種類で違う可能性がある | 変えない (持ち主は、これまでどおりセッションに直接書く) |
| (試験 1) 見つかった穴: レビューが付かない | セッションが「レビュー可能」の PR に push すると、Claude の承認が外れる。続けて push すると、組織のレビューのワークフローが見直しをせず (9 秒で終わる)、レビューが付かないまま PR が止まった (2 件)。`/code-review` をコメントすると、レビューが付いてマージされた | 開発のルーティンが (`autopilot:fix` の手順で)、CI が終わっても今の head へのレビューが無ければ、head ごとに 1 回、`review.command` をコメントして頼み直す (4.6) |
| (試験 1) 見つかった穴: 任意の指摘 | 承認と任意の指摘だけのレビューを、上限に達した 2 つのセッションが受け、1 つは誤って止まり (`needs-human`・自動マージを外す)、1 つは何もせずマージされた。任意の指摘で push して、承認を外したセッションもあった | `autopilot:fix` で、任意の指摘を直すことに数えず、push も返信も止まりもしない (4.4) |
| (試験 1) 見つかった穴: コメントの本文 | QA のボットが、初めに `$(cat qa.md)` という文字のままのコメントを書き、後で本当の結果に書き直した (コマンドの置き換えが効かなかった) | スキルのコメントの本文は、`gh api` の `-F body=@<ファイル>` で、ファイルから渡す |
| (試験 1) 見つかった穴: 元からある脆弱性 | デフォルトブランチに元からある依存の脆弱性で、commit 前の Trivy がルーティンの commit を止める (試験の前に直した) | 変えない (setup が、入れるときに既存の脆弱性を直す) |

## 10. 試験

| 種類 | 試す範囲 |
|---|---|
| マージで本番へデプロイするリポジトリ | Issue からマージまで (デプロイは、リポジトリのデプロイの仕組みが動く。autopilot は確かめない) |
| 手動で起動してデプロイするリポジトリ (環境が複数ある) | Issue からマージまで (autopilot はデプロイを起動しない) |
| デプロイの無いテンプレートのリポジトリ | Issue からマージまで |
| デプロイを別のリポジトリで行うリポジトリ | Issue からマージまで |
| 構成の違う他社のリポジトリ (3 つ) | 手元で setup を動かし、聞き取りと提案が合っているかまで。Issue・PR は作らない |

試すリポジトリの名前は、公開リポジトリのこの文書には書かない。一覧は、Claude Code のメモリ `autopilot-test-repos` にある。9 章の確かめは、デプロイの無いテンプレートのリポジトリと、本番へデプロイする 2 つのリポジトリで行ってよい (ユーザーが許可済み)。確かめと試験のルーティンは、ユーザーの個人の claude.ai アカウントで動かす。他社のリポジトリでは、push・Issue・PR をしない (Issue と PR を作ってよいと言われた 1 つを除く)。

## 11. 完了の条件

- 試験用のリポジトリで、`autopilot:ready` を付けた Issue から、人が触らずに PR のマージまで進む
- CODEOWNERS のパスを変える PR は、持ち主が Approve するまでマージされない
- QA のエビデンス (スクリーンショット・動画・JSON) が PR から見られる
- `needs-human`・デプロイの失敗が、GitHub の Slack アプリで Slack に届く。承認の依頼は、GitHub のレビューの依頼で持ち主に届く
- 対応が上限を超えるか、同じ失敗が 2 回出ると止まり、`needs-human` が付く
- `autopilot:ready` が無い Issue (社外の人の Issue を含む) では起動しない
- 構成の違う他社のリポジトリで、setup の聞き取りと提案が、そのリポジトリの構成に合っている

## 12. 誰が決めたか

**ユーザーが決めたこと**

- 人間が承認するのは、取り消せない操作だけ
- 本番へのデプロイまで自動で行う。デプロイの仕組みが無いリポジトリには作らない (2026-11-13 に変えた。マージで終わる。下の `deploy` のジョブを消す行)
- 起動は `autopilot:ready` のラベル
- 同時に動かす数は制限しない。コンフリクトは許容する
- マージの前に、開発のテストと、別のセッションの QA を行う
- 既存のスキル (superpowers など) を作り直さない
- CI と Claude のレビューが無ければ、setup が用意する
- 技術スタックが違うときは、移行を推奨として提案し、ユーザーが選ぶ
- claude.ai と GitHub のアカウントは、自動化専用か個人かを選べる
- `/autopilot:onboard` を `/autopilot:setup` に改名する
- autopilot の GitHub Actions は、会社ごとに作る GitHub App のトークンで操作する
- 取り消せない変更の承認は、PR の Approve で受け付ける
- 取り消せない変更の確認は、GitHub Actions が付ける独自のステータスをやめ、CODEOWNERS とルールセットの「コードオーナーのレビューを必須」で行う。初めのパスは、autopilot を動かすファイル・マイグレーション・Terraform。Terraform の apply は、手動のワークフローか別のリポジトリにする案を勧める (2026-11-12)
- デプロイで自動で戻さない判定は、設定の `deploy.irreversible_paths` のパスで決める
- 人があとで確かめられるように、スクリーンショット・動画・JSON などのエビデンスを PR に載せる
- 人への依頼や報告は、すべて Issue ではなく Slack に通知する (人は Issue を見ないため)
- 確かめと試験は、ユーザーの個人の claude.ai アカウントで動かす。運用では、個人か自動化専用かを選べるようにする
- プラグインの検査の hook はやめ、setup がリポジトリの lefthook と `.claude/settings.json` に入れる。起動時の hook は残す (4.12)
- ルーティンは開発だけにし、PR の後は GitHub の標準の仕組みと GitHub Actions に任せる。ラベルは 2 つにする (4.1)。QA と指摘への対応は、GitHub Actions の claude-code-action で行う
- (2026-11-13) `automerge`・`label`・`fix`・`ready` のジョブを消し、開発のルーティンに移す。自動マージの有効化・`needs-human` のラベル・PR の購読と対応をルーティンが行い、対応の回数の上限はスキルに書く。上の「ルーティンは開発だけにし、PR の後は GitHub の標準の仕組みと GitHub Actions に任せる」を変えた。QA は、GitHub Actions の claude-code-action のまま (4.1)
- (2026-11-13) 見回り (`sweep`) は AI なしで残す。コンフリクトや動きの無い PR には、App がコメントして購読中のセッションを起こす。起動しなかった Issue のラベルは付け直す (4.5)
- (2026-11-13) `deploy` のジョブを消す。マージの後は、リポジトリのデプロイのワークフローに任せる。失敗の知らせは GitHub の Slack アプリ。本番の確認と自動のロールバックは無くなる。上の `deploy.irreversible_paths` と、設計者が決めたデプロイの方式・確認・ロールバックは、要らなくなった (4.8)
- (2026-11-13) Slack への知らせは、GitHub の Slack アプリの購読にする (例 `+label:"needs-human"`)。Incoming Webhook と Slack の App はやめる (4.11)

**設計者 (Claude) が決めたこと**

- ラベルの名前と、コメントの印で状態を伝えること (4.2)
- 対応の上限 3 回、見回りの 1 時間ごと・30 分・3 時間
- デプロイの 3 つの方式と、確認に失敗したときに Issue を作ること
- 設定ファイルの場所 `.github/autopilot.yml`
- AI なしの処理を composite action にして、autopilot-plugin に置くこと
- 取り消せない変更を含むデプロイの確認に失敗したら、自動でロールバックせず `needs-human` にすること
- (2026-11-13) 対応の回数は、PR の作者が書いた `<!-- autopilot:fix-round -->` のコメントのうち、Issue に最後に `autopilot:ready` が付いた後のものを数える (付け直しで数え直す)。上限は、デフォルトブランチの `.github/autopilot.yml` の `limits.max_fix_rounds` (既定 3) (4.4)
- (2026-11-13) 起こす印は `<!-- autopilot:wake -->` と `<!-- autopilot:head <sha> -->`。App のボットが書いたものだけを数える。同じ head で起こすのは 1 回だけ。起こしてから `stale_hours` たっても困りごと (コンフリクトか動きの無さ) が続けば `needs-human` (4.5)
- (2026-11-13) 開発の Draft PR の印 `<!-- autopilot:developing -->` と、開始の印 `<!-- autopilot:started -->` はやめる。読む処理が無くなったため (4.2)
- (2026-11-13) 設定の `routine_github_user`・`notify`・`deploy` は読まない。書いてあっても無視する (入れ済みのリポジトリの設定を壊さない) (5)
- (2026-11-13) ルーティンの持ち主のコメントでは、セッションは起きない (同じアカウントの書き込みは通知されない。試験で確かめた)。持ち主が直してほしいときは、ルーティンの commit の `Claude-Session:` の行のリンクから、そのセッションに直接書く (4.3 の 6)
- (2026-11-13) `needs-human` を付けるときは、ラベルを先に付け、印のコメントを後に書く。GitHub の Slack アプリが、ラベルの付いた PR・Issue へのコメントとして知らせるため (4.4)
