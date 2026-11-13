# 聞いて、提案する
survey.md の結果をもとに、次の項目を聞きます。調べて分かったものは、「〜でよいですか」と確かめるだけにします。分からないものだけ、質問します。1 回に聞くのは数個までにします。

| 項目 | 聞くこと (例) | 答えの行き先 |
|---|---|---|
| 技術スタックを移行するか | npm → bun、ESLint → Biome、mypy → ty。下の「移行の提案」 | 手順 3・4 を行うか |
| タスクランナー・git hook | Taskfile・Makefile・mise、lefthook・pre-commit。4 つのタスク (`style:check`・`style:fix`・`security:check`・`dev:up`) を、人 (lefthook)・CI・Claude の hook・動作確認・QA の基準にすること。無いタスクは足す | checks.md |
| 必須にするチェック | lint・ユニットテスト・E2E のジョブ名。CI で動いていないテストがあれば、動かすか | `required_checks` |
| Claude のレビュー | 既存のものを使うか。起動のしかた (自動・コメント)。判定を出す bot の名前 | `review`・`{{REVIEWER_BOTS}}` |
| アプリの起動 | Web の環境で起動できるか。起動のコマンドと URL。アプリが出す MCP サーバー (あれば URL)。GPU・クラウドの認証情報が要るときの QA のしかた | `qa.start`・`qa.url`・QA のワークフローの `mcp-servers` |
| デプロイ | 方式 (none・on_merge・dispatch)・環境の順番・確認のしかた・ロールバックのしかた | `deploy` |
| 人の承認が要るパスと、その持ち主 | CODEOWNERS に書くパスと持ち主 (GitHub のユーザー名か team)。初めの値は、autopilot を動かすファイル (`.github/`・`.claude/`・`.mcp.json`・git の hook の設定。AI の PR が、人の承認なしに自分の検査を変えられないように) と、マイグレーション・Terraform。ほかにあれば足す (課金・メール送信のコードのパスなど) | `.github/CODEOWNERS`。デプロイがあれば、ロールバックで戻せないもの (マイグレーションなど) は `deploy.irreversible_paths` にも |
| Terraform の apply の方針 | apply がマージで動くか (survey の IaC)。動くなら、手動のワークフローか別のリポジトリにする案を勧める (autopilot は作らない。デプロイの仕組みを新しく作らないため) | 提案 |
| Slack の通知先 | チャンネル | `notify` |
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
| GitHub | PR の作者が専用のアカウントになる。持ち主 (CODEOWNERS) は誰でも Approve できる | PR の作者がその人になる。その人は自分の PR を Approve できない |

- ルーティンは、持ち主の claude.ai のアカウントに結び付いた GitHub のアカウントで、commit と PR を作ります。その GitHub のユーザー名が `routine_github_user` です
- 個人の GitHub アカウントを選んだときは、持ち主 (CODEOWNERS) に、その人以外がいるかを確かめます。いなければ、そのパスを変える PR がマージできなくなることを伝えます

## 提案
聞き終わったら、変える内容の一覧を見せ、ユーザーが「進めてよい」と答えてから次の手順に進みます。

| 手順 | 内容 |
|---|---|
| 技術スタック | 移行する・しない |
| Docker・検査・シークレットと脆弱性 | 直す内容 |
| autopilot | ラベル 2 つ・`.github/autopilot.yml`・`.github/CODEOWNERS`・ワークフロー 2 つ・(無ければ) Claude のレビューと CI・(提案を選んだら) ロールバック・ルールセット・ルーティン |
| ユーザーがすること | GitHub App・Slack の Webhook・シークレット・Web の環境 |
