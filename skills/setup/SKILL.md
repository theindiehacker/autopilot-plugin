---
name: setup
description: リポジトリを、Claude Code on the Web で開発・テストできるように整える。フロントエンド (bun・Biome・Playwright・shadcn/ui・Tailwind CSS) と Python (uv・ruff・ty・deptry・import-linter・pytest) の技術スタックへの移行、Web で docker compose を起動するための compose ファイルと Dockerfile の修正、編集後・commit 前・push 前の検査をリポジトリに入れること、その検査 (Gitleaks・Semgrep・Trivy) を通すための既存のシークレット・脆弱性の修正を、ユーザーに確かめながら行い、最後に PR を作る。使い方 → /autopilot:setup
---

# 手順
次の 5 つの手順を、この順に行ってください。各手順の中身は、同じフォルダのファイルに書いてあります。始める前に、どの手順を行うかをユーザーに伝えてください。

| 順 | 手順 | ファイル | 行う条件 |
|---|---|---|---|
| 1 | フロントエンドの技術スタックの移行 | [frontend.md](frontend.md) | `git ls-files -- '*package.json'` が出る |
| 2 | Python の技術スタックの移行 | [python.md](python.md) | `git ls-files -- '*pyproject.toml' '*requirements*.txt' '*setup.py'` が出る |
| 3 | Web で Docker を起動できるようにする | [cloud.md](cloud.md) | 毎回 |
| 4 | 検査を入れる | [checks.md](checks.md) | 毎回 |
| 5 | 既存のシークレット・脆弱性を直す | [security.md](security.md) | 毎回 |

- 技術スタックの移行を先に行います。3 の確かめで動かす `docker compose up --build` が、移行した後の lock ファイルでビルドするためです
- 検査を入れるのは、3 の後、5 の前です。5 で、入れた検査と同じコマンドを動かして、既存の指摘を直すためです
- セキュリティを最後に行います。移行で変わった依存も、最後の検査で見るためです
- 手順の途中では commit しません。最後の PR でまとめて commit します

## PR を作る
5 つの手順が終わったら、PR を作るかユーザーに聞いてください。作ると答えたら、変更を commit して PR を 1 つ作ります。本文には次を書きます。

- 手順ごとに、直した項目
- 除外した指摘と、その理由・期限
- ユーザーがすること (許可されたドメインの追加、シークレットのローテーションなど)

マージすると、以後の commit・push は、lefthook の検査が動き、新しく入った指摘だけで止まるようになります。
