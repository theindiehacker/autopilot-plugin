# Issue から本番へのデプロイまでの自動の流れと `/autopilot:setup` の設計

- Issue: #40
- 日付: 2026-11-12
- 状態: 下書き (ユーザーの確認待ち)

## 1. 目的

Issue を起票すれば、Claude Code が開発・テスト・レビュー・QA・マージ・本番へのデプロイまで行う。人間は、取り消せない変更の承認だけをする。どの会社のリポジトリにも、`/autopilot:setup` で入れられるようにする。

**背景:** 社内外の多くの人が、PC で Claude Code を起動して作業している。その人がボトルネックになり、開発が止まったり遅れたりしている。

**参考:** https://x.com/m4lkxx/status/2114338456750997922 (Harness・Loop・Graph の 7 段階)。この設計は記事の次の考えに従う。

- 完了は、失敗しうる検査で決める (Level 3)。AI の「直りました」は証拠にしない
- やり直しには出口を作る (Level 4)。同じ失敗が 2 回出たら止める
- 人間は、取り消せないところにだけ置く (Level 6)。どれが取り消せないかは、AI ではなくコードが決める

## 2. 目標・目標にしないこと・失敗とみなすこと

**目標**

- `autopilot:ready` が付いた Issue から、人が触らずに PR のマージまで進む。デプロイの仕組みがあるリポジトリでは、本番へのデプロイと、デプロイ後の確認まで進む
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
- 毎回同じ答えになる作業 (ラベルの付け替え・見回り・自動マージの有効化) は、AI なしの GitHub Actions で行う。取り消せない変更の確認は、GitHub の標準の仕組み (CODEOWNERS とルールセット) で行う
- リポジトリに置くものは最小にする。GitHub Actions は autopilot-plugin の再利用ワークフローを呼ぶだけにし、ルーティンのプロンプトは `/autopilot:〇〇` を呼ぶだけにする
- 会社ごとに違う部分は、`/autopilot:setup` が聞いてから提案・設定する
- 同梱のプラグインにあるスキルは使い、作り直さない。autopilot が作るのは、それらをつなぐ部分だけ

## 4. 全体の流れ

### 4.1 何がどこで動くか

2026-11-12 の確かめ (9.1) で、ルーティンは GitHub のラベル・ステータスを書けないと分かった。そこで、ルーティンは「Issue から PR を作る」だけにし、PR を作った後は GitHub の標準の仕組みと GitHub Actions に任せる (ユーザーが決定)。

| 段階 | どこで動くか | 中身 |
|---|---|---|
| 開発 | ルーティン (`/autopilot:develop`) | Issue から受入条件・テスト・実装・動作確認・PR まで。GitHub への書き込みは git push・PR の作成・コメント (と、GitHub の MCP での PR の更新) |
| CI | GitHub Actions (既存) | リポジトリのテスト・lint など |
| レビュー | GitHub Actions (既存の Claude のレビュー) | claude[bot] が Approve か Request changes を出す |
| QA | GitHub Actions のジョブ (claude-code-action) | アプリを起動して受入条件を確かめ、エビデンスを PR に載せる。ジョブの成否が結果 |
| 指摘への対応 | GitHub Actions のジョブ (claude-code-action) | Request changes・CI や QA の失敗・コンフリクトを直して push し、返信する |
| 取り消せない変更の確認 | GitHub の標準の仕組み | CODEOWNERS に書いたパスを変える PR は、持ち主の Approve があるまでマージできない (ルールセットの「コードオーナーのレビューを必須」) |
| マージ | GitHub の標準の仕組み | 必須のチェック・必須のレビュー・自動マージ |
| 見回り・通知・状態の変更 | GitHub Actions (AI なし) | ラベル・自動マージの有効化・Draft の切り替え・Slack |

### 4.2 ラベルとコメントの印

ラベルは 2 つだけにする。付け替えは GitHub Actions (GitHub App のトークン) が行う。

| ラベル | 付く先 | 付ける人 | 意味 |
|---|---|---|---|
| `autopilot:ready` | Issue | triage 以上の権限がある人 | 開発を始めてよい。開発のルーティンが起動する |
| `needs-human` | Issue・PR | GitHub Actions | 止まった。人の判断が要る |

ルーティンと claude-code-action は、状態を HTML コメントの印で GitHub Actions に伝える。GitHub Actions は、ルーティンの持ち主の GitHub アカウント (設定の `routine_github_user`) か GitHub Actions 自身が書いた印だけを受け付ける。

| 印 | 書く人 | 意味 |
|---|---|---|
| `<!-- autopilot:developing -->` | 開発のルーティン (Draft PR の本文に) | 開発中。この印がある間は、対応のジョブを動かさない |
| `<!-- autopilot:needs-human -->` | ルーティン・対応のジョブ | 進めない。理由は同じコメントに書く。GitHub Actions が `needs-human` を付けて Slack で知らせる |
| `<!-- autopilot:fix-round -->` | 対応のジョブ (PR に) | 対応を 1 回行った。回数を数えるのに使う |

autopilot の PR は、同じリポジトリのブランチ `autopilot/<Issue 番号>-<名前>` から出ている PR とする。

### 4.3 Issue 1 件の流れ

1. 人が Issue を書き、権限のある人が `autopilot:ready` を付ける
2. 開発のルーティンが起動する。REST で Issue のラベルを読み、`autopilot:ready` が無いか `needs-human` があれば、何もせずに終える。始めたら、デフォルトブランチから `autopilot/<番号>-dev` を作って空の commit を push し、本文に `Closes #<番号>` と `<!-- autopilot:developing -->` を入れた Draft PR を作る (GitHub のプロジェクトの画面で、作業中の Issue が見える。ブランチ名を番号だけで決めるので、ほぼ同時に 2 つ起動しても、後の push は断られる)
3. 受入条件を Issue にコメントする (ヒアリングしないと分からないときは、4.4 のとおり聞いて止まる。小さな選択は自分で決め、決めたことを書く)。その条件を確かめるテストを書き、直す前のコードで失敗するのを確かめてから実装する。ユニット・受入・E2E テストを通す
4. 同じブランチに push する。人と同じく、レビューを頼む前に、アプリを起動して受入条件を 1 つずつ確かめ (`skills/qa/self-check.md`)、スクリーンショット・録画・JSON を PR の本文の `## 動作確認 (<sha7>)` に書く。続けて、開発のルーティンが GitHub の MCP (`update_pull_request`) で、PR の本文 (動作確認・判断の理由・試してだめだった方法・テストの結果。最後の行は `Closes #<番号>`) を書き換え、「レビュー可能」にする。断られたら `needs-human` で止まる
5. PR が「レビュー可能」になると、GitHub Actions で Claude のレビュー・QA のジョブが動く。QA のジョブは、コードを書いていない別の Claude が、別の環境で受入条件を確かめ直す (必須のチェック) (CI は Draft のときから動く)。CODEOWNERS のパスを変える PR では、GitHub が持ち主にレビューを頼む。autopilot の PR では自動マージが有効になる
6. Request changes・CI の失敗・QA の失敗・コンフリクトがあれば、対応のジョブが動く。PR の本文の記録と指摘を読み、指摘ごとに採否を決め、直して push し、返信する。Claude のレビューが PR を Draft に戻していれば、GitHub Actions が「レビュー可能」に戻す
7. 必須のチェックと必須のレビュー (claude[bot] の Approve。CODEOWNERS のパスを変える PR では、持ち主の Approve も) がそろうと、GitHub の自動マージでマージされる
8. マージの後、設定に書いたデプロイを動かし、本番で確かめる (4.8)

### 4.4 止まる条件

- 対応のジョブが 3 回動いた後に、また失敗した → 4 回目は Claude を動かさずに `needs-human` を付ける (回数は `<!-- autopilot:fix-round -->` を数える。上限は設定で変えられる)
- 同じ失敗が 2 回続いた → 対応のジョブの Claude が止まり、`<!-- autopilot:needs-human -->` 付きのコメントで、何が同じかを書く
- 開発のルーティンが進めない (Issue があいまいで受入条件が書けない、受入条件は書けても、ヒアリングしないと成果物がずれそうなとき、など) → 同じ印のコメントで、質問と案 (おすすめつき) を書いて止まる。答えを Issue にコメントし、`needs-human` を外して `autopilot:ready` を付け直すと再開する
- 見回り (4.5) で、長く動きの無い Issue・PR が見つかった → `needs-human`
- `needs-human` の付いた Issue・PR では、ルーティンもジョブも動かない。人がラベルを外すと再開する
- `needs-human` が付いたら、何が起きて何をしてほしいかを Slack で知らせる (4.11)

### 4.5 見回り (GitHub Actions、1 時間ごと)

- `autopilot:ready` の Issue で、30 分たっても、開発の Draft PR (ラベルより後に作られたもの) が無い → 起動に失敗したとみなし、ラベルを付け直す (App のトークンで付けたラベルでも起動することは確かめ済み)。付け直しても始まらなければ `needs-human`
- 3 時間動きの無い autopilot の PR (開発中の Draft PR を含む) → `needs-human`
- コンフリクトのある autopilot の PR → 対応のジョブを起動する
- 1 時間ごとなので、GitHub Actions の時間は 1 リポジトリで月 720 分ほどになる (1 回を 1 分に切り上げて数える)

### 4.6 マージの条件

GitHub の標準の仕組みで決める。setup が、リポジトリのルールセットに次を設定する。

- **必須のチェック:** 設定に書いた CI のジョブ・QA のジョブ。必須にするチェックは、PR ごとに必ず結果が出るものにする (`paths:` で飛ぶジョブは必須にしないか、いつも動くジョブにまとめる。setup が確かめる)
- **必須のレビュー:** 1 件。claude[bot] の Approve が数えられることは確かめ済み。push の後は、古い Approve を取り消す。コードオーナーのレビューを必須にする (下の CODEOWNERS)
- **自動マージ:** autopilot の PR では、GitHub Actions が有効にする (Web のセッションでは GraphQL を使えないため)

**CODEOWNERS (GitHub の標準の仕組み):** setup が `.github/CODEOWNERS` に、人の承認が要るパス (4.7) と、その持ち主 (GitHub のユーザー名か team) を書く。ルールセットの「コードオーナーのレビューを必須」で、そのパスを変える PR は、持ち主の Approve があるまでマージされない。持ち主は人なので、claude[bot] の Approve だけではマージされない。PR の作者は、自分の PR を Approve できない。持ち主には、GitHub がレビューの依頼を知らせる (Slack には送らない。GitHub の Slack 連携を入れれば、Slack にも出せる)。autopilot 以外の PR でも同じように効く。

### 4.7 取り消せない変更の見分け方

人の承認が要るパスを、setup が会社ごとに聞いて CODEOWNERS に書く。AI には判断させない。

- **autopilot を動かすファイル:** `.github/` (ワークフロー・設定・CODEOWNERS 自身)・`.claude/`・`.mcp.json`・git の hook の設定 (`lefthook.yml`・`.lefthook.yml`・`lefthook.yaml`・`.pre-commit-config.yaml`・`.husky/`)。AI の PR が、人の承認なしに、自分の検査・ワークフロー・設定を変えられないようにするため。前の版の「いつも取り消せない変更とみなすパス」(計画の R19) は、ここに移った
- **マイグレーション:** 例 `/backend/migration/versions/`
- **Terraform:** 例 `/infrastructure/`。apply がマージで動くと、Approve の後に取り消せない操作が自動で走る。setup は、apply を手動のワークフローか別のリポジトリにする案を勧める (作りはしない。2 章の「デプロイの仕組みを新しく作らない」)。plan を読んで削除を見分けることはしない
- **そのほか:** 会社が挙げたもの (課金・メール送信のコードのパスなど)

### 4.8 デプロイ

設定で次の 3 つから選ぶ。

| 方式 | 内容 |
|---|---|
| `none` | デプロイしない。マージで終わる |
| `on_merge` | 既存のワークフローが、main への push で動く。autopilot は、その完了を待ってから確かめる |
| `dispatch` | マージの後、autopilot が既存のワークフローを `workflow_dispatch` で起動する。入力も設定に書く。環境が複数あるときは、書いた順に進める |

- **デプロイ後の確認:** 設定に書いたコマンドか URL (ヘルスチェック、本番に対する簡単な E2E など)
- **ロールバック:** 設定に書いたワークフローかコマンド。無いときは、setup が作るかを提案する (Cloud Run のトラフィックを前のリビジョンに戻す、など)
- **確認に失敗したとき:** ロールバックし、Slack で知らせる (4.11)。直す作業のために、原因を書いた Issue を `autopilot:ready` 付きで作る (この Issue は AI が直すためのもので、人に知らせるためのものではない)。同じ原因で 2 回続いたら `needs-human` を付けて、Slack で知らせる
- **取り消せない変更を含むデプロイの確認に失敗したとき:** 自動でロールバックしない。マイグレーションや Terraform の削除が済んだ後にコードだけ戻すと、新しいスキーマと合わずに壊れることがあり、ロールバック自体が取り消せない操作になりうるため。取り消せない変更を含むかは、マージした PR が、設定の `deploy.irreversible_paths` (glob) に合うファイルを変えたかで決める。`needs-human` を付けた Issue を作り、Slack の設定のチャンネルに知らせる。マイグレーションが必ず後方互換になっている会社 (列の削除を次のリリースに回すなど) は、設定でこの場合も自動のロールバックを選べる

### 4.9 GitHub の操作で注意すること

確かめたこと (2026-11-12 時点。9.1 も参照):

- Web のセッション (ルーティンを含む) では、GraphQL が使えない。`gh pr`・`gh issue` は動かず、`gh api` (REST) だけが使える ([cloud-environments](https://code.claude.com/docs/en/cloud-environments.md))
- ルーティンでは、REST でのラベル・ステータスの書き込みが自動モードに拒否される。`.claude/settings.json` で許可しても変わらない。REST でのブランチ作成は、GitHub のプロキシに拒否される。コメントは書ける
- そのため、ルーティンが GitHub に書くのは、git push・PR の作成・コメントと、GitHub の MCP での PR の本文の書き換え・Draft の切り替え (9.1 の 5) だけにする。ラベル・自動マージは GitHub Actions が行う
- GitHub Actions の `GITHUB_TOKEN` で行った操作では、ほかのワークフローが起動しない (`workflow_dispatch`・`repository_dispatch` を除く)。自動マージを `GITHUB_TOKEN` で有効にすると、マージの push で main の CI もデプロイも動かない
- そのため、autopilot の GitHub Actions と claude-code-action は、会社ごとに作る GitHub App のトークンで操作する (6.2)。App のトークンで付けたラベルでルーティンが起動することは、確かめ済み

### 4.10 エビデンス

人があとで確かめられるように、確かめた証拠を PR に載せる。

| 誰が | 載せるもの |
|---|---|
| 開発のルーティン | テストの結果 (ユニット・受入・E2E の件数と、失敗から成功に変わったテスト) と、動作確認 (受入条件ごとのスクリーンショット・録画・JSON)。PR の本文に書く |
| QA のジョブ | 画面のスクリーンショット、操作の動画 (Playwright の録画)、API の応答などの JSON、確かめた手順 |
| 対応のジョブ | 直した後の新しい commit での動作確認 (本文の `## 動作確認` を置き換える) |

- PR のコメントに、何を確かめたかと、エビデンスへのリンク (画像は埋め込み) を書く
- ファイルを置く場所は、作る人が決める。条件は次のとおり
  - main に入らない (マージで本体のコードに混ざらない)
  - リポジトリを読める人だけが見られる (非公開のリポジトリで外に出さない)
- シークレットや個人情報が写る画面・応答は、載せる前に伏せる

### 4.11 Slack への通知 (GitHub Actions、AI なし)

人への依頼や報告は、すべて Issue ではなく Slack に送る。人は Issue も PR も見ないため。

| いつ | 種類 | 誰に |
|---|---|---|
| `needs-human` が付いた (4.4) | 依頼 | 設定のチャンネル |
| 取り消せない変更を含むデプロイの確認に失敗した (ロールバックしていない) | 依頼 | 設定のチャンネル |
| デプロイ後の確認に失敗し、ロールバックした | 報告 | 設定のチャンネル |
| Issue の対応が終わった (マージした。デプロイがあれば本番で確認した) | 報告 | 設定のチャンネル |

- 送るのは GitHub Actions (AI なし)。Slack の Incoming Webhook の URL をシークレットに入れて使う
- 通知には、PR・デプロイのログ・Issue へのリンクと、何が起きたかを 2〜3 行で書く
- 人の承認の依頼 (CODEOWNERS のパスを変える PR) だけは、Slack ではなく、GitHub のレビューの依頼で持ち主に届く。GitHub の Slack 連携を入れれば、Slack にも出せる

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

setup が聞き取った答えを書く。GitHub Actions の処理と、QA・対応のジョブが読む。項目の例:

```yaml
review:
  # 既存の Claude のレビュー。判定を出すアカウントと、起動のしかた
  reviewer: claude[bot]
  trigger: ready_for_review   # ready_for_review / comment (例: "/code-review") / none (autopilot が入れる)
required_checks:
  - task style:check
  - task test
  - task dev:e2e
routine_github_user: <ルーティンの持ち主の GitHub のユーザー名>   # コメントの印を受け付ける相手
qa:
  start: docker compose up --build -d --wait   # GitHub Actions でアプリを起動するコマンド
  url: http://localhost:3000
notify:
  slack_channel: "#alerts"   # Webhook の URL はシークレットに入れる
limits:
  max_fix_rounds: 3
  stale_hours: 3
deploy:
  mode: on_merge            # none / on_merge / dispatch
  workflow: deploy.yml
  environments: [production]
  verify: curl -fsS https://example.com/healthz
  rollback: rollback.yml
  irreversible_paths: [backend/migration/versions/**]   # このパスを変えた PR は、確認に失敗しても自動で戻さない
```

項目の名前と形は、作る人が決めてよい。

## 6. 作るもの

### 6.1 スキルとプロンプト

| 名前 | 動く場所 | 内容 | 使う既存のスキル |
|---|---|---|---|
| `/autopilot:setup` | PC の Claude Code | `/autopilot:onboard` を改名し、7 章の手順を足す | — |
| `/autopilot:develop` | ルーティン | 4.3 の 2〜4。オーケストラエージェントが、開発エージェントに作業を分ける | superpowers の test-driven-development・subagent-driven-development・verification-before-completion |
| QA のプロンプト | GitHub Actions (claude-code-action) | 4.3 の 5 の QA | playwright |
| 対応のプロンプト | GitHub Actions (claude-code-action) | 4.3 の 6 | superpowers の receiving-code-review・systematic-debugging |

既存のスキルで足りるところは、スキルを呼ぶだけにする。claude-code-action で同梱のプラグインを使えるかは、作る人が確かめる。使えなければ、プロンプトにそのスキルの要点だけを書く。

### 6.2 GitHub Actions

| もの | 内容 |
|---|---|
| composite action `actions/autopilot` | AI なしの処理 (`automerge`・`label`・`sweep`・`deploy`・`fix-round`)。`automation/` の TypeScript を Bun で動かす |
| QA のジョブ | claude-code-action でアプリを起動し、受入条件を確かめる |
| 対応のジョブ | claude-code-action で指摘と失敗を直す。動く前に `fix-round` で回数を確かめ、上限なら Claude を動かさずに止める |
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
   - ロールバックが無く、デプロイがあるなら、作るかを提案する
   - `.github/CODEOWNERS` を書く (4.7)
5. **人に頼む:** 画面でしかできないことの手順を示す
   - クラウドの環境 (セットアップスクリプト・ネットワーク・環境変数)
   - Claude の GitHub App の導入
   - autopilot 用の GitHub App の作成と導入 (setup が、要る権限を入れた作成の画面へ案内する)
   - Slack の Incoming Webhook の作成
   - シークレットの登録 (GitHub App・Slack・claude-code-action の認証)
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
| デプロイ | 方式 (4.8)・環境の順番・確認のしかた・ロールバックのしかた |
| 人の承認が要るパスと、その持ち主 | CODEOWNERS。初めの値は、autopilot を動かすファイル・マイグレーション・Terraform (4.7)。持ち主は GitHub のユーザー名か team |
| Terraform の apply の方針 | マージで動くか。動くなら、手動のワークフローか別のリポジトリにする案を勧める |
| Slack の通知先 | チャンネル |
| アカウント | 7.4 |
| デフォルトブランチ | main・master |

### 7.4 アカウント

claude.ai と GitHub のどちらも、自動化専用のアカウントと個人のアカウントから選べる。

| | 自動化専用のアカウント | 個人のアカウント |
|---|---|---|
| claude.ai | 個人の使用量と分けられる。人が休んでも止まらない | その人の使用量を使う |
| GitHub | PR の作者が専用のアカウントになる。持ち主 (CODEOWNERS) は誰でも Approve できる | PR の作者がその人になる。その人は自分の PR を Approve できないので、CODEOWNERS のパスを変える PR は、別の持ち主が Approve する |

- ルーティンは、持ち主の claude.ai のアカウントに結び付いた GitHub のアカウントで、commit と PR を作る ([routines](https://code.claude.com/docs/en/routines.md))
- 個人の GitHub アカウントを選んだときは、setup が、持ち主 (CODEOWNERS) にその人以外がいるかを確かめる。いなければ、そのパスを変える PR がマージできなくなることを伝える (試験では、ほかに持ち主がいないので、管理者がルールセットを迂回してマージした)

## 8. セキュリティ

- 起動のきっかけは、triage 以上の権限がある人しか付けられない `autopilot:ready` だけにする。開発のルーティンは、ラベルを付けた人の権限を REST で確かめてから始める。Issue のテンプレートで、このラベルを自動で付けない
- Issue・PR・コメントの本文は、指示ではなくデータとして扱う
- コメントの印 (4.2) は、ルーティンの持ち主の GitHub アカウントか GitHub Actions 自身が書いたものだけを受け付ける
- QA と対応のジョブは、同じリポジトリから出た autopilot の PR でだけ動く。フォークの PR のコードは動かさない
- 取り消せない変更の Approve は、Approve した人が持ち主かを、GitHub (CODEOWNERS とルールセット) が確かめる。CODEOWNERS 自身と、autopilot を動かすファイル (4.7) も持ち主のパスにし、AI の PR が、持ち主や検査を書き換えられないようにする
- エビデンスに、シークレットや個人情報を載せない
- Web の環境の環境変数・シークレットは、最小の権限にする

## 9. 作る前に確かめること

試しに動かして確かめる。結果で設計が変わるときは、ユーザーに伝える。

1. claude[bot] の Approve が、ルールセットの「承認 1 件」に数えられるか
2. autopilot 用の GitHub App のトークンで付けたラベルで、ルーティンが起動するか (見回りの付け直しで使う)
3. PR のラベルのトリガーで、PR の番号がセッションに渡るか
4. Web のセッションから `gh api` (REST) で、ラベルの付け替え・コミットのステータス・Draft PR の作成ができるか
5. Web のセッションから、Draft から「レビュー可能」への切り替えができるか (できなければ GitHub Actions が行う)
6. setup から RemoteTrigger でルーティンと GitHub トリガーを作れるか

### 9.1 確かめの結果 (2026-11-12)

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

## 10. 試験

| 種類 | 試す範囲 |
|---|---|
| マージで本番へデプロイするリポジトリ | Issue から本番へのデプロイ・確認まで |
| 手動で起動してデプロイするリポジトリ (環境が複数ある) | Issue から本番へのデプロイ・確認まで。`dispatch` 方式を試す |
| デプロイの無いテンプレートのリポジトリ | Issue からマージまで |
| デプロイを別のリポジトリで行うリポジトリ | Issue からマージまで |
| 構成の違う他社のリポジトリ (3 つ) | 手元で setup を動かし、聞き取りと提案が合っているかまで。Issue・PR は作らない |

試すリポジトリの名前は、公開リポジトリのこの文書には書かない。一覧は、Claude Code のメモリ `autopilot-test-repos` にある。9 章の確かめは、デプロイの無いテンプレートのリポジトリと、本番へデプロイする 2 つのリポジトリで行ってよい (ユーザーが許可済み)。確かめと試験のルーティンは、ユーザーの個人の claude.ai アカウントで動かす。他社のリポジトリでは、push・Issue・PR をしない (Issue と PR を作ってよいと言われた 1 つを除く)。

## 11. 完了の条件

- 試験用のリポジトリで、`autopilot:ready` を付けた Issue から、人が触らずに PR のマージまで進む。デプロイのあるリポジトリでは、本番へのデプロイと確認まで進む
- CODEOWNERS のパスを変える PR は、持ち主が Approve するまでマージされない
- QA のエビデンス (スクリーンショット・動画・JSON) が PR から見られる
- `needs-human`・デプロイの失敗・対応の完了が、Slack に届く。承認の依頼は、GitHub のレビューの依頼で持ち主に届く
- 対応が上限を超えるか、同じ失敗が 2 回出ると止まり、`needs-human` が付く
- `autopilot:ready` が無い Issue (社外の人の Issue を含む) では起動しない
- 構成の違う他社のリポジトリで、setup の聞き取りと提案が、そのリポジトリの構成に合っている

## 12. 誰が決めたか

**ユーザーが決めたこと**

- 人間が承認するのは、取り消せない操作だけ
- 本番へのデプロイまで自動で行う。デプロイの仕組みが無いリポジトリには作らない
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

**設計者 (Claude) が決めたこと**

- ラベルの名前と、コメントの印で状態を伝えること (4.2)
- 対応の上限 3 回、見回りの 1 時間ごと・30 分・3 時間
- デプロイの 3 つの方式と、確認に失敗したときに Issue を作ること
- 設定ファイルの場所 `.github/autopilot.yml`
- AI なしの処理を composite action にして、autopilot-plugin に置くこと
- 取り消せない変更を含むデプロイの確認に失敗したら、自動でロールバックせず `needs-human` にすること
