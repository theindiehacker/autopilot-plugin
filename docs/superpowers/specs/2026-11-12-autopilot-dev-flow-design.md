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
- Renovate (#41)・Slack (#42)・セキュリティ監査 (#43)・振り返り (#44)・更新の反映 (#45)

**失敗とみなすこと (動いても失敗)**

- 取り消せない変更が、人間の承認なしにマージ・デプロイされる
- 権限の無い人 (社外の人を含む) が書いた Issue だけで起動する
- 止まらずに回り続けて、費用が漏れる
- superpowers など、同梱のプラグインにあるスキルを autopilot で作り直す
- AI の自己申告 (「直りました」「テストは通るはず」) で完了にする

## 3. 共通の方針

#41〜#45 もこの方針に従う。

- 人間が承認するのは、取り消せない操作だけ (マイグレーション・データの削除・課金・メール送信・取り消せないインフラの操作など)。どれが当たるかは、AI に判断させず、設定ファイルのルールでコードが決める
- 完了・マージの条件は「失敗しうる検査がすべて通ること」
- 止まる条件を決める (4.3)
- 毎回同じ答えになる作業 (マージ・ラベルの付け替え・見回り・関門の判定) は、AI なしの GitHub Actions で行う
- リポジトリに置くものは最小にする。GitHub Actions は autopilot-plugin の再利用ワークフローを呼ぶだけにし、ルーティンのプロンプトは `/autopilot:〇〇` を呼ぶだけにする
- 会社ごとに違う部分は、`/autopilot:setup` が聞いてから提案・設定する
- 同梱のプラグインにあるスキルは使い、作り直さない。autopilot が作るのは、それらをつなぐ部分だけ

## 4. 全体の流れ

### 4.1 ラベル

ラベルで状態を表す。ルーティンは、ラベルが付いたことをきっかけに起動する (ルーティンの GitHub トリガーで、ラベルの絞り込みと、Issue の番号がセッションに渡ることは、ユーザーが確認済み)。

| ラベル | 付く先 | 付ける人 | 意味 |
|---|---|---|---|
| `autopilot:ready` | Issue | triage 以上の権限がある人 | 開発を始めてよい。開発のルーティンが起動する |
| `autopilot:doing` | Issue | 開発のルーティン | 作業中。起動したら最初に `autopilot:ready` から付け替える |
| `autopilot:qa` | PR | 開発・対応のルーティン | QA を始めてよい。QA のルーティンが起動する |
| `autopilot:fix` | PR | 関門 (GitHub Actions) | 指摘か失敗がある。対応のルーティンが起動する |
| `needs-human` | Issue・PR | ルーティン・関門・見回り | 止まった。人の判断が要る |

### 4.2 Issue 1 件の流れ

1. 人が Issue を書き、権限のある人が `autopilot:ready` を付ける
2. 開発のルーティン (`/autopilot:develop`) が起動する。最初に `autopilot:doing` に付け替え、Draft PR を作る
3. 受入条件を Issue に書く。その条件を確かめるテストを書き、直す前のコードで失敗するのを確かめてから実装する。ユニット・受入・E2E テストを通す
4. 判断の理由と、試してだめだった方法を、PR の本文に書き残す (対応のルーティンが読む記憶)
5. `autopilot:qa` を付ける。PR を「レビュー可能」にする (4.8 の注意を参照)
6. CI・Claude のレビュー・QA のルーティン (`/autopilot:qa`) が動く。QA は Web の環境でアプリを起動して動かし、結果をコミットのステータス `autopilot/qa` として残す。エビデンス (4.9) を PR に載せる
7. 関門 (`autopilot/gate`) が結果を見る。指摘か失敗があれば、`autopilot:fix` を付ける
8. 対応のルーティン (`/autopilot:fix`) が、PR に残した記録・指摘・失敗を読む。指摘ごとに採否を決めて、直すか返信する。直したら 5 に戻る
9. 関門の条件がそろったら、自動でマージする
10. マージの後、設定ファイルに書いたデプロイを動かし、本番での動作を確かめる。確認に失敗したら、ロールバックして Issue を作る

### 4.3 止まる条件

- 対応 (`autopilot:fix`) が 3 回を超えた → 関門が `needs-human` を付ける (回数は設定で変えられる)
- 同じ失敗が 2 回続いた → 対応のルーティンが自分で止まり、`needs-human` を付ける。何が同じだったかを PR に書く
- 見回り (4.4) で、長く動きの無い Issue・PR が見つかった → `needs-human`
- `needs-human` が付いた Issue・PR では、ルーティンも関門も動かない。人がラベルを外すと再開する
- `needs-human` が付いたら、何が起きて何をしてほしいかを Slack で知らせる (4.10)

### 4.4 見回り (GitHub Actions、1 時間ごと)

- `autopilot:ready` のまま 30 分たった Issue は、起動に失敗したとみなし、ラベルを付け直して起動し直す。2 回目も起動しなければ `needs-human` を付ける
- `autopilot:doing`・`autopilot:qa`・`autopilot:fix` のまま、決めた時間 (例: 3 時間) 動きが無ければ `needs-human` を付ける
- 1 時間ごとなので、GitHub Actions の時間は 1 リポジトリで月 720 分ほどになる (1 回を 1 分に切り上げて数える)

### 4.5 関門のチェック `autopilot/gate` (GitHub Actions、AI なし)

PR のイベント (チェックの完了・レビュー・ラベル・push) で動く。ルールセットの必須チェックにする。

**通る条件**

- 設定に書いた必須のチェックが、すべて成功している
- Claude のレビューの最新の判定が Approve
- `autopilot/qa` が成功している
- 取り消せない変更 (4.6) を含むときは、承認する人が PR を Approve している。Approve した人が設定の承認者かを、コードが確かめる。PR の最新のコミットに対する Approve だけを数える (承認のあとに push があれば、承認し直してもらう)
- 承認が要るのにまだ無いときは、承認する人に Slack で知らせる (4.10)

**動き**

- 通らなければ、失敗の内容を PR に書き、`autopilot:fix` を付ける
- 通ったら、自動マージ (`gh pr merge --auto`) を有効にする

**autopilot 以外の PR:** 関門は必須チェックなので、人の PR・bot の PR・フォークからの PR でも動く。autopilot の PR (開発のルーティンが作り、`autopilot:qa` が一度でも付いた PR) 以外では、次だけを確かめる。ラベルの付け替え・ルーティンの起動・自動マージの有効化はしない。

- 設定に書いた必須のチェックが、すべて成功している
- 取り消せない変更を含むときは、承認する人の Approve がある

Claude のレビューの Approve は、autopilot 以外の PR では関門の条件にしない (承認の要否は、既存のルールセットに任せる)。

**注意:** 必須のチェックのワークフローに `paths:` の絞り込みがあると、動かなかったチェックが「待ち」のまま残る。必須チェックは関門 1 つにまとめ、どのチェックを待つかは関門が判断する。動かなかったチェックをどう扱うか (`paths:` の条件を読む、など) は、作る人が決める。

### 4.6 取り消せない変更の見分け方

設定ファイルに書いたルールで、コードが見分ける。setup が会社ごとに聞いて書く。

- **パス:** 例 `backend/migration/versions/**`、`**/migrations/*.sql`
- **Terraform:** PR の plan に、削除 (delete) か作り直し (replace) がある。plan を JSON で出し、`resource_changes[].change.actions` を見る。マージで apply するリポジトリで使う
- **そのほか:** 会社が挙げたもの (課金・メール送信のコードのパスなど)

### 4.7 デプロイ

設定で次の 3 つから選ぶ。

| 方式 | 内容 |
|---|---|
| `none` | デプロイしない。マージで終わる |
| `on_merge` | 既存のワークフローが、main への push で動く。autopilot は、その完了を待ってから確かめる |
| `dispatch` | マージの後、autopilot が既存のワークフローを `workflow_dispatch` で起動する。入力も設定に書く。環境が複数あるときは、書いた順に進める |

- **デプロイ後の確認:** 設定に書いたコマンドか URL (ヘルスチェック、本番に対する簡単な E2E など)
- **ロールバック:** 設定に書いたワークフローかコマンド。無いときは、setup が作るかを提案する (Cloud Run のトラフィックを前のリビジョンに戻す、など)
- **確認に失敗したとき:** ロールバックし、Slack で知らせる (4.10)。直す作業のために、原因を書いた Issue を `autopilot:ready` 付きで作る (この Issue は AI が直すためのもので、人に知らせるためのものではない)。同じ原因で 2 回続いたら `needs-human` を付けて、Slack で知らせる
- **取り消せない変更を含むデプロイの確認に失敗したとき:** 自動でロールバックしない。マイグレーションや Terraform の削除が済んだ後にコードだけ戻すと、新しいスキーマと合わずに壊れることがあり、ロールバック自体が取り消せない操作になりうるため。`needs-human` を付けた Issue を作り、Slack で承認する人に知らせる。マイグレーションが必ず後方互換になっている会社 (列の削除を次のリリースに回すなど) は、設定でこの場合も自動のロールバックを選べる

### 4.8 GitHub の操作で注意すること

ドキュメントで確かめたこと (2026-11-12 時点):

- Web のセッション (ルーティンを含む) では、GraphQL が使えない。`gh pr`・`gh issue` は動かず、`gh api` (REST) だけが使える ([cloud-environments](https://code.claude.com/docs/en/cloud-environments.md))
- そのため、ルーティンからは、自動マージの有効化と、Draft から「レビュー可能」への切り替え (どちらも GraphQL だけ) ができない見込み。できなければ、GitHub Actions が行う
- GitHub Actions の `GITHUB_TOKEN` で行った操作では、ほかのワークフローが起動しない (`workflow_dispatch`・`repository_dispatch` を除く)。自動マージを `GITHUB_TOKEN` で有効にすると、マージの push で main の CI もデプロイも動かない。また、承認者が team に入っているかも確かめられない
- そのため、autopilot の GitHub Actions は、`GITHUB_TOKEN` ではなく、会社ごとに作る GitHub App のトークンで操作する (6.2)
- コミットのステータスは、GitHub App でなくても REST で付けられる。チェックランは GitHub App しか作れないので、QA の結果はステータスで残す

### 4.9 エビデンス

人があとで確かめられるように、ルーティンは確かめた証拠を PR に載せる。

| 誰が | 載せるもの |
|---|---|
| 開発のルーティン | テストの結果 (ユニット・受入・E2E の件数と、失敗から成功に変わったテスト) |
| QA のルーティン | 画面のスクリーンショット、操作の動画 (Playwright の録画)、API の応答などの JSON、確かめた手順 |
| 対応のルーティン | 直した指摘ごとに、直ったことがわかるスクリーンショットかテストの結果 |

- PR のコメントに、何を確かめたかと、エビデンスへのリンク (画像は埋め込み) を書く
- ファイルを置く場所は、作る人が決める。条件は次のとおり
  - main に入らない (マージで本体のコードに混ざらない)
  - リポジトリを読める人だけが見られる (非公開のリポジトリで外に出さない)
  - Web のセッションからできる操作で置ける (GraphQL は使えない。ブランチへの push と REST は使える)
- シークレットや個人情報が写る画面・応答は、載せる前に伏せる

### 4.10 Slack への通知 (GitHub Actions、AI なし)

人への依頼や報告は、すべて Issue ではなく Slack に送る。人は Issue も PR も見ないため。

| いつ | 種類 | 誰に |
|---|---|---|
| 取り消せない変更を含む PR が、承認を待っている | 依頼 | 承認する人 |
| `needs-human` が付いた (4.3) | 依頼 | 設定のチャンネル |
| 取り消せない変更を含むデプロイの確認に失敗した (ロールバックしていない) | 依頼 | 設定のチャンネルと、承認する人 |
| デプロイ後の確認に失敗し、ロールバックした | 報告 | 設定のチャンネル |
| Issue の対応が終わった (マージした。デプロイがあれば本番で確認した) | 報告 | 設定のチャンネル |

- 送るのは GitHub Actions (AI なし)。Slack の Incoming Webhook の URL をシークレットに入れて使う
- 通知には、PR・デプロイのログ・Issue へのリンクと、何が起きたかを 2〜3 行で書く

### 4.11 検査の hook (lint・型検査・シークレット・脆弱性)

プラグインの検査の hook (編集後・commit 前・push 前) はやめ、`/autopilot:setup` が各リポジトリに入れる (ユーザーが決定)。起動時の hook (Web の環境の準備) はプラグインに残す。

| いつ | どこに入れるか | 中身 |
|---|---|---|
| 編集後 | リポジトリの `.claude/settings.json` の hooks | 編集したファイルの整形と lint (Biome・Ruff) |
| commit 前 | リポジトリの lefthook (`pre-commit`) | 型検査・deptry・import-linter・Gitleaks |
| push 前 | リポジトリの lefthook (`pre-push`) | Semgrep・Trivy |

- lefthook は git の hook なので、Claude だけでなく、人がターミナルで commit・push したときにも動く
- Web の環境では、起動時の hook が `lefthook install` を行う
- すでに lefthook や pre-commit を使っているリポジトリでは、足りない検査だけを足す

### 4.12 ルーティンの GitHub への書き込みの許可

ルーティンは自動モードで動き、`gh api` でのラベル・ステータスの書き込みが「外部システムへの書き込み」として拒否されることがある (9 章の確かめ)。setup が、リポジトリの `.claude/settings.json` の `permissions.allow` に、そのリポジトリへの `gh api` と `git push` だけを許可するルールを書く (ユーザーが決定)。

- 許可はリポジトリの URL まで絞る (例: `Bash(gh api -X POST repos/<owner>/<repo>/*)`)
- このリポジトリを手元で使う人にも同じ許可が効くことを、setup がユーザーに伝える

## 5. 設定ファイル `.github/autopilot.yml`

setup が聞き取った答えを書く。関門・見回り・デプロイの再利用ワークフローが読む。項目の例:

```yaml
review:
  # 既存の Claude のレビュー。判定を出すアカウントと、起動のしかた
  reviewer: claude[bot]
  trigger: ready_for_review   # ready_for_review / comment (例: "/code-review") / none (autopilot が入れる)
required_checks:
  - task style:check
  - task test
  - task dev:e2e
irreversible:
  paths:
    - backend/migration/versions/**
  terraform_plan_job: terraform-plan   # plan を JSON で出すジョブ。無ければ書かない
approvers:
  - <GitHub のユーザー名か team>
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
```

項目の名前と形は、作る人が決めてよい。

## 6. 作るもの

### 6.1 スキル

| スキル | 動く場所 | 内容 | 使う既存のスキル |
|---|---|---|---|
| `/autopilot:setup` | PC の Claude Code | `/autopilot:onboard` を改名し、7 章の手順を足す | — |
| `/autopilot:develop` | ルーティン | 4.2 の 2〜5。オーケストラエージェントが、開発エージェントに作業を分ける | superpowers の test-driven-development・subagent-driven-development・verification-before-completion |
| `/autopilot:qa` | ルーティン | 4.2 の 6 | playwright |
| `/autopilot:fix` | ルーティン | 4.2 の 8 | superpowers の receiving-code-review・systematic-debugging |

既存のスキルで足りるところは、スキルを呼ぶだけにする。autopilot のスキルに書くのは、ラベルの付け替え・PR への記録・止まる条件など、つなぐ部分だけ。

### 6.2 再利用ワークフロー (autopilot-plugin の `.github/workflows/`)

| ワークフロー | 内容 |
|---|---|
| 関門 | 4.5 |
| 見回り | 4.4 |
| デプロイ | 4.7 (マージの後の起動・確認・ロールバック) |
| レビュー | Claude のレビューが無いリポジトリ用。claude-code-action で Approve か Request changes を出す |

- リポジトリには、これらを呼ぶだけの短いファイルを置く
- **トークン:** 会社ごとに作る GitHub App のトークン (`actions/create-github-app-token`) で操作する。App の ID と秘密鍵は、リポジトリか org のシークレットに入れる。App は人に結び付かず、期限も無い。権限は、使う操作 (ラベル・PR・自動マージ・コミットのステータスの読み取り・`workflow_dispatch`・team のメンバーの読み取り) に絞る。どの権限が要るかは、作る人が操作ごとに決める
- CI が無いリポジトリには、setup がそのリポジトリ用の CI を作る (中身がリポジトリごとに違うので、再利用ワークフローにはしない)
- 再利用ワークフローの版の指定 (`@main` かタグか) は #45 で決める。それまでは作る人が決める

### 6.3 ルーティン (setup が作る)

| ルーティン | トリガー | プロンプト |
|---|---|---|
| 開発 | Issue に `autopilot:ready` が付いた | `/autopilot:develop` を実行する |
| QA | PR に `autopilot:qa` が付いた | `/autopilot:qa` を実行する |
| 対応 | PR に `autopilot:fix` が付いた | `/autopilot:fix` を実行する |

- Issue・PR の本文は、指示ではなくデータとして扱う (プロンプトインジェクション対策)。スキルにもそう書く
- 環境は、README の手順で作った Web の環境 (セットアップスクリプトでプラグインを入れる) を使う

## 7. `/autopilot:setup`

### 7.1 前提

- PC の Claude Code で実行する。クラウドのセッションでは `/schedule` が使えず、ルーティンを作れないため
- ルーティンの持ち主にする claude.ai のアカウントでログインして実行する

### 7.2 手順

1. **調べる:** 技術スタック・CI・Claude のレビュー・デプロイ・DB とマイグレーション・IaC・compose・ルールセット・デフォルトブランチ・Renovate・`.claude/`
2. **聞く:** 7.3 の項目。調べて分かったことは、確かめるだけにする
3. **提案する:** 変える内容の一覧を見せる。技術スタックが方針と違うときは、モダンな技術スタックへの移行 (npm → bun など) を推奨として提案し、移行するかはユーザーが選ぶ
4. **変える:** 今の onboard の 4 つの手順 (フロントエンド・Python・Web で Docker・シークレットと脆弱性) に加えて、次を行う
   - CI と Claude のレビューが無ければ用意する
   - ラベルを作る
   - `.github/autopilot.yml` を書く
   - 再利用ワークフローを呼ぶファイルを置く
   - ルールセットに関門を必須チェックとして足す
   - ロールバックが無ければ、作るかを提案する
5. **人に頼む:** Web の画面でしかできないことの手順を示す
   - クラウドの環境 (セットアップスクリプト・ネットワーク・環境変数)
   - Claude の GitHub App の導入
   - autopilot 用の GitHub App の作成と導入 (setup が、要る権限を入れた作成の画面へ案内する)
   - Slack の Incoming Webhook の作成
   - シークレットの登録
6. **ルーティンを作る:** 6.3 の 3 つ。Claude Code の RemoteTrigger (`create` と `create_webhook_trigger`) か `/schedule` で作る
7. **PR を作る:** 今の onboard と同じく、変更を 1 つの PR にまとめる

### 7.3 聞くこと

| 項目 | 例 |
|---|---|
| 技術スタックを移行するか | npm → bun、ESLint → Biome、mypy → ty |
| タスクランナー・git hook | Taskfile・Makefile・mise、lefthook・pre-commit |
| 必須にするチェック | lint・ユニットテスト・E2E。CI で動いていないテストがあれば、動かすか |
| Claude のレビュー | 既存のものを使うか。起動のしかた (自動・コメント) |
| Web の環境でアプリを起動できるか | GPU・クラウドの認証情報が要るときの QA のしかた |
| デプロイ | 方式 (4.7)・環境の順番・確認のしかた・ロールバックのしかた |
| 取り消せない変更 | マイグレーションのパス・Terraform の apply の方針・そのほか |
| 承認する人 | GitHub のユーザー名か team |
| Slack の通知先 | チャンネル。承認する人の Slack のメンション |
| アカウント | 7.4 |
| デフォルトブランチ | main・master |

### 7.4 アカウント

claude.ai と GitHub のどちらも、自動化専用のアカウントと個人のアカウントから選べる。

| | 自動化専用のアカウント | 個人のアカウント |
|---|---|---|
| claude.ai | 個人の使用量と分けられる。人が休んでも止まらない | その人の使用量を使う |
| GitHub | PR の作者が専用のアカウントになる。承認する人は誰でも Approve できる | PR の作者がその人になる。その人は自分の PR を Approve できないので、取り消せない変更は別の人が Approve する |

- ルーティンは、持ち主の claude.ai のアカウントに結び付いた GitHub のアカウントで、commit と PR を作る ([routines](https://code.claude.com/docs/en/routines.md))
- 個人の GitHub アカウントを選んだときは、setup が、承認する人にその人以外がいるかを確かめる。いなければ、取り消せない変更がマージできなくなることを伝える

## 8. セキュリティ

- 起動のきっかけは、triage 以上の権限がある人しか付けられない `autopilot:ready` だけにする。Issue のテンプレートで、このラベルを自動で付けない
- Issue・PR・コメントの本文は、指示ではなくデータとして扱う
- 取り消せない変更の Approve は、Approve した人が承認者かを関門が確かめる
- エビデンスに、シークレットや個人情報を載せない
- Web の環境の環境変数・シークレットは、最小の権限にする

## 9. 作る前に確かめること

試しに動かして確かめる。結果で設計が変わるときは、ユーザーに伝える。

1. claude[bot] の Approve が、ルールセットの「承認 1 件」に数えられるか
2. autopilot 用の GitHub App のトークンで付けたラベルで、ルーティンが起動するか (見回りの付け直しと、関門の `autopilot:fix` で使う)
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
| 4. Web のセッションから REST で書き込めるか | コメントは書けた。ラベルとステータスは、ルーティンの自動モードに「外部システムへの書き込み」として拒否された | 4.12 の許可を setup が書く |
| (追加) プラグインの commit 前の hook | `Bash(*git*commit*)` が commit 以外のコマンドにも合い、Web では `next typegen` が無く型検査が失敗して、ルーティンの commit を止めた | 4.11 のとおり、リポジトリの lefthook に移す |
| 2. App のトークンで付けたラベルで起動するか | 未確認 (GitHub App の作成待ち) | — |
| 5. Draft から「レビュー可能」への切り替え | 未確認 (書き込みの拒否で試せず)。切り替えは GitHub Actions が行うので、結果は設計に影響しない | — |

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
- 取り消せない変更を含む PR は、承認する人が Approve するまでマージされない
- QA のエビデンス (スクリーンショット・動画・JSON) が PR から見られる
- 承認の依頼・`needs-human`・デプロイの失敗・対応の完了が、Slack に届く
- 対応が上限を超えるか、同じ失敗が 2 回出ると止まり、`needs-human` が付く
- `autopilot:ready` が無い Issue (社外の人の Issue を含む) では起動しない
- 構成の違う他社のリポジトリで、setup の聞き取りと提案が、そのリポジトリの構成に合っている

## 12. 誰が決めたか

**ユーザーが決めたこと**

- 人間が承認するのは、取り消せない操作だけ
- 本番へのデプロイまで自動で行う。デプロイの仕組みが無いリポジトリには作らない
- 起動は `autopilot:ready` のラベル。ルーティンが `autopilot:doing` に付け替え、先に Draft PR を作る
- 同時に動かす数は制限しない。コンフリクトは許容する
- 指摘への対応は、Auto-fix ではなくルーティンで行う
- マージの前に、開発のルーティンのテストと、QA のルーティンの動作確認を行う
- 既存のスキル (superpowers など) を作り直さない
- CI と Claude のレビューが無ければ、setup が用意する
- 技術スタックが違うときは、移行を推奨として提案し、ユーザーが選ぶ
- claude.ai と GitHub のアカウントは、自動化専用か個人かを選べる
- `/autopilot:onboard` を `/autopilot:setup` に改名する
- autopilot の GitHub Actions は、会社ごとに作る GitHub App のトークンで操作する
- 取り消せない変更の承認は、PR の Approve で受け付ける
- 人があとで確かめられるように、スクリーンショット・動画・JSON などのエビデンスを PR に載せる
- 人への依頼や報告は、すべて Issue ではなく Slack に通知する (人は Issue を見ないため)
- 確かめと試験は、ユーザーの個人の claude.ai アカウントで動かす。運用では、個人か自動化専用かを選べるようにする
- ルーティンの書き込みの許可は、setup がリポジトリの `.claude/settings.json` に書く (4.12)
- プラグインの検査の hook はやめ、setup がリポジトリの lefthook と `.claude/settings.json` に入れる。起動時の hook は残す (4.11)

**設計者 (Claude) が決めたこと**

- ラベルの名前と、QA・対応のルーティンもラベルで起動すること
- 対応の上限 3 回、見回りの 1 時間ごと・30 分・3 時間
- 関門を必須チェック 1 つにまとめること
- QA の結果をコミットのステータスで残すこと
- デプロイの 3 つの方式と、確認に失敗したときに Issue を作ること
- 設定ファイルの場所 `.github/autopilot.yml`
- 再利用ワークフローを autopilot-plugin に置くこと
- autopilot 以外の PR では、関門は必須チェックと取り消せない変更の承認だけを確かめること
- 取り消せない変更を含むデプロイの確認に失敗したら、自動でロールバックせず `needs-human` にすること
