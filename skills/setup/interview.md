# 聞いて、提案する
survey.md の結果をもとに、次の項目を聞きます。調べて分かったものは、「〜でよいですか」と確かめるだけにします。分からないものだけ、質問します。1 回に聞くのは数個までにします。

| 項目 | 聞くこと (例) | 答えの行き先 |
|---|---|---|
| 技術スタックを移行するか | npm → bun、ESLint → Biome、mypy → ty。下の「移行の提案」 | 手順 3・4 を行うか |
| タスクランナー・git hook | Taskfile・Makefile・mise、lefthook・pre-commit。4 つのタスク (`style:check`・`style:fix`・`security:check`・`dev:up`) を、人 (lefthook)・CI・Claude の hook・動作確認の基準にすること。無いタスクは足す | checks.md |
| 必須にするチェック | lint・ユニットテスト・E2E のジョブ名。CI で動いていないテストがあれば、動かすか | `required_checks` |
| Claude のレビュー | 既存のものを使うか。起動のしかた (自動・コメント)。判定を出す bot の名前 | `review` |
| アプリの起動 | Web の環境で起動できるか。起動のコマンドと URL。アプリが出す MCP サーバー (あれば URL)。GPU・クラウドの認証情報が要るときの動作確認のしかた | `qa.start`・`qa.url`・checks.md の `dev:up` |
| デプロイ | 方式 (none・on_merge・dispatch)。方式を確かめるだけで、autopilot はデプロイに何もしない | GitHub の Slack アプリの購読の案内 (デプロイのワークフローの失敗。autopilot.md の 5-B) |
| 人の承認が要るパスと、その持ち主 | CODEOWNERS に書くパスと持ち主 (GitHub のユーザー名か team)。初めの値は、autopilot を動かすファイル (`.github/`・`.claude/`・`.mcp.json`・git の hook の設定)、検査を定めるファイル (`style:check`・`security:check`・`dev:up` を書いたタスクランナーのファイルと、`.gitleaks.toml`・`.gitleaksignore`・`.semgrepignore`・`trivy.yaml`・`.trivyignore`・`.trivyignore.yaml`。リポジトリに無いものも、AI の PR が新しく作って検査を弱めないように、行を残す)、マイグレーション・Terraform。前の 2 つは、AI の PR が、人の承認なしに自分の検査を変えられないようにするため。タスクがルートの `package.json` の `scripts` にあれば、`package.json` も持ち主のパスになる (依存を足す PR にも Approve が要る) と伝える。ほかにあれば足す (課金・メール送信のコードのパスなど) | `.github/CODEOWNERS` |
| Terraform の apply の方針 | apply がマージで動くか (survey の IaC)。動くなら、手動のワークフローか別のリポジトリにする案を勧める (autopilot は作らない。デプロイの仕組みを新しく作らないため) | 提案 |
| Slack の通知先 | `needs-human` (人が要る知らせ) のチャンネルと、デプロイがあればデプロイの知らせのチャンネル (別にする。デプロイの知らせは成功も届くため) | GitHub の Slack アプリの購読 (autopilot.md の 5-B) |
| Claude のレビューの認証 | setup が Claude のレビューのワークフローを置くときだけ。`CLAUDE_CODE_OAUTH_TOKEN` か `ANTHROPIC_API_KEY` | シークレット (autopilot.md の 5-A) |
| アカウント | 下の「アカウント」 | ルーティン |
| デフォルトブランチ | main・master | ルールセット |

## 移行の提案
技術スタックが方針 (JS は bun・Biome・Playwright・shadcn/ui・Tailwind CSS、Python は uv・ruff・ty・deptry・import-linter・pytest) と違うときは、移行を推奨として提案します。移行は、必須ではありません。理由と、変わるものを短く伝え、移行するかはユーザーに選んでもらいます。選ばれなかった方の手順 (frontend.md・python.md) は行いません。

## アカウント
claude.ai と GitHub のそれぞれで、自動化専用のアカウントか個人のアカウントかを選んでもらいます。

| | 自動化専用 | 個人 |
|---|---|---|
| claude.ai | 個人の使用量と分けられる。人が休んでも止まらない | その人の使用量を使う |
| GitHub | PR の作者が専用のアカウントになる。持ち主 (CODEOWNERS) は誰でも Approve できる | PR の作者がその人になる。その人は自分の PR を Approve できない |

- ルーティンは、持ち主の claude.ai のアカウントに結び付いた GitHub のアカウントで、commit と PR を作ります
- GitHub は、autopilot を使うリポジトリだけに届く、自動化専用のアカウントを勧めます。ルーティンは、そのアカウントの権限で書き込み、PR の指摘も直すためです。個人のアカウントでは、その人が届くリポジトリすべてに、ルーティンの書き込みが届きます
- 公開リポジトリでは、だれが書いたコメントも、通知としてルーティンのセッション (自動モード) に入ります。セッションは、信頼できない書き手の指摘を無視しますが、それは中身を読んだ後のモデルの判断で、コードの絞り込みではありません。公開リポジトリに入れるときは、このことを伝え、届く範囲を絞るために、自動化専用のアカウントにするよう強く勧めます
- 個人の GitHub アカウントを選んだときは、持ち主 (CODEOWNERS) に、その人以外がいるかを確かめます。いなければ、そのパスを変える PR がマージできなくなることを伝えます

## 提案
聞き終わったら、変える内容の一覧を見せ、ユーザーが「進めてよい」と答えてから次の手順に進みます。

| 手順 | 内容 |
|---|---|
| 技術スタック | 移行する・しない |
| Docker・検査・シークレットと脆弱性 | 直す内容 |
| autopilot | ラベル 2 つ・Project (持ち主ごとに 1 つ。もうあれば、このリポジトリをつなぐだけ)・`.github/autopilot.yml`・`.github/CODEOWNERS`・(無ければ) Claude のレビューと CI・ルールセット・ルーティン |
| ユーザーがすること | Claude の GitHub App・(Claude のレビューのワークフローを置くとき) シークレット・GitHub の Slack アプリの購読・Project の Issue の自動の追加・Web の環境 |
