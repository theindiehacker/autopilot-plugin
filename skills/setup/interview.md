# 聞いて、提案する
survey.md の結果をもとに、次の項目を聞きます。調べて分かったものは、「〜でよいですか」と確かめるだけにします。分からないものだけ、質問します。1 回に聞くのは数個までにします。

| 項目 | 聞くこと (例) | 答えの行き先 |
|---|---|---|
| 技術スタックを移行するか | npm → bun、ESLint → Biome、mypy → ty。下の「移行の提案」 | 手順 3・4 を行うか |
| タスクランナー・git hook | Taskfile・Makefile・mise、lefthook・pre-commit | checks.md |
| 必須にするチェック | lint・ユニットテスト・E2E のジョブ名。CI で動いていないテストがあれば、動かすか | `required_checks` |
| Claude のレビュー | 既存のものを使うか。起動のしかた (自動・コメント)。判定を出す bot の名前 | `review`・`{{REVIEWER_BOTS}}` |
| アプリの起動 | Web の環境で起動できるか。起動のコマンドと URL。アプリが出す MCP サーバー (あれば URL)。GPU・クラウドの認証情報が要るときの QA のしかた | `qa.start`・`qa.url`・QA のワークフローの `mcp-servers` |
| デプロイ | 方式 (none・on_merge・dispatch)・環境の順番・確認のしかた・ロールバックのしかた | `deploy` |
| 取り消せない変更 | マイグレーションのパス・Terraform の apply の方針・そのほか (課金・メール送信のコードのパスなど) | `irreversible` |
| 承認する人 | GitHub のユーザー名か team | `approvers` |
| Slack の通知先 | チャンネル。承認する人の Slack のメンション | `notify` |
| claude-code-action の認証 | `CLAUDE_CODE_OAUTH_TOKEN` か `ANTHROPIC_API_KEY` | シークレット |
| アカウント | 下の「アカウント」 | `routine_github_user`・ルーティン |
| デフォルトブランチ | main・master | ルールセット |

## 移行の提案
技術スタックが方針 (JS は bun・Biome・Playwright・shadcn/ui・Tailwind CSS、Python は uv・ruff・ty・deptry・import-linter・pytest) と違うときは、移行を推奨として提案します。移行は、必須ではありません。理由と、変わるものを短く伝え、移行するかはユーザーに選んでもらいます。選ばれなかった方の手順 (frontend.md・python.md) は行いません。

## アカウント
claude.ai と GitHub のそれぞれで、自動化専用のアカウントか個人のアカウントかを選んでもらいます。

| | 自動化専用 | 個人 |
|---|---|---|
| claude.ai | 個人の使用量と分けられる。人が休んでも止まらない | その人の使用量を使う |
| GitHub | PR の作者が専用のアカウントになる。承認する人は誰でも Approve できる | PR の作者がその人になる。その人は自分の PR を Approve できない |

- ルーティンは、持ち主の claude.ai のアカウントに結び付いた GitHub のアカウントで、commit と PR を作ります。その GitHub のユーザー名が `routine_github_user` です
- 個人の GitHub アカウントを選んだときは、承認する人に、その人以外がいるかを確かめます。いなければ、取り消せない変更がマージできなくなることを伝えます

## 提案
聞き終わったら、変える内容の一覧を見せ、ユーザーが「進めてよい」と答えてから次の手順に進みます。

| 手順 | 内容 |
|---|---|
| 技術スタック | 移行する・しない |
| Docker・検査・シークレットと脆弱性 | 直す内容 |
| autopilot | ラベル 2 つ・`.github/autopilot.yml`・ワークフロー 2 つ・(無ければ) Claude のレビューと CI・(提案を選んだら) ロールバック・ルールセット・ルーティン |
| ユーザーがすること | GitHub App・Slack の Webhook・シークレット・Web の環境 |
