---
name: setup
description: リポジトリを、Claude Code on the Web で開発・テストできるように整える。フロントエンド (bun・Biome・Playwright・shadcn/ui・Tailwind CSS) と Python (uv・ruff・ty・deptry・import-linter・pytest) の技術スタックへの移行、Web で docker compose を起動するための compose ファイルと Dockerfile の修正、作業の終わり・commit 前・push 前の検査をリポジトリに入れること、その検査 (Gitleaks・Semgrep・Trivy) を通すための既存のシークレット・脆弱性の修正を、ユーザーに確かめながら行う。さらに、リポジトリを調べて聞き取りをし、Issue からマージまでの自動の流れ (autopilot: ラベル・設定・CODEOWNERS・無ければ Claude のレビューと CI・GitHub の Slack アプリ・ルールセット・ルーティン) を入れる。最後に PR を作る。使い方 → /autopilot:setup
---

# 始める前に
最初に、環境変数 `CLAUDE_CODE_REMOTE` を確かめてください。

```bash
if [ "${CLAUDE_CODE_REMOTE:-}" = "true" ]; then echo remote; fi
```

`remote` と出たら、クラウドのセッション (Claude Code on the Web) です。何も変えずに、ここで止まります。ユーザーに、次を伝えてください。

- PC の Claude Code で、このリポジトリを開いて `/autopilot:setup` を動かしてください
- クラウドのセッションでは、ルールセットとワークフローの権限を変える GitHub の API が拒否されます。ルーティンも作れません
- PC で動かすと、setup が、PR のマージの後に、ルールセットとルーティンまで作ります

# 手順
次の 8 つの手順を、この順に行ってください。各手順の中身は、同じフォルダのファイルに書いてあります。始める前に、どの手順を行うかをユーザーに伝えてください。

| 順 | 手順 | ファイル | 行う条件 |
|---|---|---|---|
| 1 | 調べる | [survey.md](survey.md) | 毎回 |
| 2 | 聞いて、提案する | [interview.md](interview.md) | 毎回 |
| 3 | フロントエンドの技術スタックの移行 | [frontend.md](frontend.md) | `git ls-files -- '*package.json'` が出て、2 で移行を選んだ |
| 4 | Python の技術スタックの移行 | [python.md](python.md) | `git ls-files -- '*pyproject.toml' '*requirements*.txt' '*setup.py'` が出て、2 で移行を選んだ |
| 5 | Web で Docker を起動できるようにする | [cloud.md](cloud.md) | 毎回 |
| 6 | 検査を入れる | [checks.md](checks.md) | 毎回 |
| 7 | 既存のシークレット・脆弱性を直す | [security.md](security.md) | 毎回 |
| 8 | autopilot を入れる | [autopilot.md](autopilot.md) | 毎回 |

- 調べて、聞いて、提案してから変えます。ユーザーが提案に同意するまで、リポジトリは変えません
- 技術スタックの移行を先に行います。5 の確かめで動かす `docker compose up --build` が、移行した後の lock ファイルでビルドするためです
- 検査を入れるのは、5 の後、7 の前です。7 で、入れた検査と同じコマンドを動かして、既存の指摘を直すためです
- セキュリティは、autopilot の前に行います。移行で変わった依存も、最後の検査で見るためです
- 手順の途中では commit しません。1〜7 と autopilot.md の 1〜5 の変更は、autopilot.md の 6 で 1 つの PR にまとめて commit します
- autopilot.md の 7・8 (ルールセット・ワークフローの既定の権限・ルーティン) は、この PR がマージされた後に、setup が続けて行います。ルールセットを先に作ると、この PR も必須のレビューを待つことになります。ルーティンは、デフォルトブランチの `.github/autopilot.yml` を読みます

## PR を作る
autopilot.md の 6 まで終わったら、PR を作るかユーザーに聞いてください。作ると答えたら、変更を commit して PR を 1 つ作ります。本文には次を書きます。

- 手順ごとに、直した項目
- 除外した指摘と、その理由・期限
- ユーザーがすること (許可されたドメインの追加、シークレットのローテーションなど)。autopilot.md の 5 の一覧と合わせて、1 つの一覧にする

PR を作ったら、マージを頼み、マージされるのを待ちます。マージされたら、autopilot.md の 7・8 に進みます。

マージすると、以後の commit・push は、lefthook の検査が動き、新しく入った指摘だけで止まるようになります。
