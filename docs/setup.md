# 🔧 /autopilot:setup

[← README に戻る](../README.md)

プラグインを入れただけでは、既存のリポジトリに、検査も autopilot も入りません。Claude Code on the Web では、起動時の `docker compose up` などが失敗することもあります。`/autopilot:setup` は、PC の Claude Code で実行します。クラウドのセッションで実行すると、setup は何も変えずに止まり、PC で実行するよう伝えます。クラウドのセッションでは、ルールセットとワークフローの権限を変える GitHub の API が拒否され、ルーティンも作れないためです。

setup は、リポジトリを調べて環境を整え、autopilot を入れて、PR を作ります。PR がマージされたら、続けて setup が、ルールセット・ワークフローの既定の権限・ルーティンを作ります。画面の操作を頼むのは、それが失敗したときだけです。

## 手順

次の 8 つを、この順に行います。調べて、聞いて、提案してから変えます。ユーザーが提案に同意するまで、リポジトリは変えません。

| 順 | 手順 | 行う条件 | 直すもの・入れるもの |
|---|---|---|---|
| 1 | 調べる | 毎回 | 技術スタック・タスクランナー・CI・Claude のレビュー・デプロイ・マイグレーション・Terraform などを調べて、表にまとめる。何も変えない |
| 2 | 聞いて、提案する | 毎回 | 調べて分からないことを聞く。変える内容の一覧を見せる。技術スタックの移行は推奨として提案し、するかはユーザーが選ぶ |
| 3 | フロントエンドの技術スタックの移行 | `package.json` がある。2 で移行を選んだ | npm・yarn・pnpm を bun に、ESLint・Prettier を Biome に置き換える。Tailwind CSS・shadcn/ui・Playwright が無ければ入れる。`package.json` に `typecheck` を足す |
| 4 | Python の技術スタックの移行 | `pyproject.toml`・`requirements*.txt`・`setup.py` がある。2 で移行を選んだ | pip・poetry・pipenv を uv に、flake8・black・isort・pylint を Ruff に、mypy・pyright を ty に置き換える。deptry の指摘を直し、import-linter の `layers` の契約を書く。pytest が無ければ入れる |
| 5 | Web で Docker を起動できるようにする | 毎回 | compose ファイルを用意し、Dockerfile の通信する `RUN` でプロキシの CA を読む。`.env` が無くても起動できるようにし、Mac 専用の設定や終了するサービスを直す。遮断されたドメインは、環境の「許可されたドメイン」への追加を頼む |
| 6 | 検査を入れる | 毎回 | タスクランナーに `style:check`・`style:fix`・`security:check`・`dev:up` を作る (あるものは消さず、足りないものだけ足す)。`lefthook.yml` (commit 前・push 前) と `.claude/settings.json` の `Stop` の hook (作業の終わり) から、そのタスクを呼ぶ。すでに lefthook や pre-commit があれば、足りない検査だけを足す。`lefthook install` を動かし、シークレットを入れた commit が止まることを確かめる |
| 7 | 既存のシークレット・脆弱性を直す | 毎回 | Gitleaks・Semgrep・Trivy の指摘を直す。誤検出などでユーザーが選んだものだけ、理由を書いて除外する |
| 8 | autopilot を入れる | 毎回 | ラベル 2 つ (`autopilot:ready`・`needs-human`)・Project (持ち主ごとに 1 つ)・`.github/autopilot.yml`・`.github/CODEOWNERS` を入れる。Claude のレビューと CI が無ければ用意する。Claude の GitHub App・シークレット (Claude のレビューを置いたとき)・Slack の購読・Project の Issue の自動の追加・Web の環境は、ユーザーに頼む |

技術スタックの移行を先に行うのは、5 で動かす `docker compose up --build` が、移行した後の lock ファイルでビルドするためです。検査を入れるのは、7 で、入れた検査と同じコマンドを動かして、既存の指摘を直すためです。セキュリティを autopilot の前に行うのは、移行で変わった依存も検査するためです。

8 のラベルと Project は、同意の後すぐに GitHub に作ります (PR をマージしなくても残ります)。

入れ終えたら、PR を作るかを聞き、作ると答えたら PR を 1 つ作ります。手順の途中では commit しません。ルールセットとルーティンは、この PR のマージの後に作ります ([autopilot の「setup の後にすること」](autopilot.md#setup-の後にすること)を参照)。
