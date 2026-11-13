# ⚙️ 自動で動くもの

[← README に戻る](../README.md)

## 起動時の処理

| タイミング | 処理 | 動く条件 |
|---|---|---|
| 起動時 | `dockerd --registry-mirror=https://mirror.gcr.io` | Web のみ |
| 起動時 | `mise install` | Web で、`mise.toml` がある |
| 起動時 | `lefthook install` (`pre-commit` を使うリポジトリでは `pre-commit install`) | Web で、`lefthook.yml` (か `.pre-commit-config.yaml`) がある |
| 起動時 | `docker compose up --build -d --wait` (プロキシの CA をビルドと起動後のコンテナに渡す) | Web で、compose ファイルがある |
| 起動時 | `packageManager` の版の bun を用意し、`bun install --frozen-lockfile` | `bun.lock` がある |
| 起動時 | uv が無ければ導入し、Ruff・ty を導入 | `pyproject.toml`・`requirements*.txt`・`setup.py` がある |
| 起動時 | `uv sync --locked` | `uv.lock` がある |
| 起動時 | Gitleaks・Semgrep・Trivy を導入 | Web のみ。ローカルは無ければ警告だけ |
| 起動時 | 下の「技術スタックの方針」を Claude に伝える | フロントエンドは `package.json`、Python は `pyproject.toml`・`requirements*.txt`・`setup.py` がある |
| 起動時・再開時・`/clear` の後・要約の後 | 下の「Claude に渡す指示」を渡す | PC でも Web でも。下書きの 2 つは Web のみ |

PC の Claude Code では、「Web のみ」「Web で」の処理は動きません。

## 検査

作業の終わり・commit 前・push 前の検査は、プラグインの hook ではありません。`/autopilot:setup` が、リポジトリに入れます。編集のたびには動かしません (`style:fix` が、使う前に足した import を消すため)。

| 時点 | 動かすもの | 入れる先 |
|---|---|---|
| Claude が作業を終えるとき | `style:fix` → `style:check` (30 分まで)。通らなければ exit 2 で Claude に直させる | `.claude/settings.json` の `Stop` の hook |
| commit 前 | `style:check`・`gitleaks --staged` | lefthook の `pre-commit` |
| push 前 | `security:check` | lefthook の `pre-push` |

リポジトリのタスクランナーの `style:check`・`style:fix`・`security:check` (と、アプリを起動する `dev:up`) を呼びます。Gitleaks だけは、lefthook から直接呼びます。lefthook は git の hook なので、人がターミナルで commit・push したときにも動きます。

- **git の hook を入れる:** Web では、起動時に `lefthook install` を行います。PC では自動では入りません。setup を動かしたリポジトリでは setup が行いますが、別に clone したら `lefthook install` を行ってください
- **ローカルでの準備:** 検査には、Gitleaks・Semgrep・Trivy と、タスクが使うツール (タスクランナー・bun・uv など) が要ります。Mac では `brew install semgrep gitleaks trivy` で入れられます。タスクランナーか Gitleaks が無いときは、その検査を飛ばします (警告が 1 行出ます)。ほかのツールが無いと、タスクが失敗して、commit・push が止まることがあります
- **LSP:** Claude が TypeScript と ty の LSP を使えます

## 📐 技術スタックの方針

**フロントエンド**

- パッケージの管理と実行は bun。npm・npx・yarn・pnpm は使わない
- lint と整形は Biome。ESLint・Prettier は使わない
- UI は shadcn/ui のコンポーネントを使う。無いものだけ、shadcn/ui を組み合わせて作る
- スタイルは Tailwind CSS のクラスとテーマの変数で書く。`style` 属性・色コード・Tailwind の任意値は書かない
- 画面を足す・変えるときは、Playwright で E2E テストを書く

**Python**

- パッケージの管理と実行は uv。pip・poetry・pipenv は使わない
- lint と整形は Ruff。flake8・black・isort・pylint は使わない
- 型の検査は ty。mypy・pyright は使わない
- 依存の過不足は deptry、import の向きは import-linter で検査する
- 機能を足す・変えるときは、pytest でテストを書く

## 📝 Claude に渡す指示

起動時・再開時・`/clear` の後・要約の後に、次の指示を Claude に渡します (`scripts/cloud/instructions.sh`)。

**PC でも Web でも**

- 作業の途中の進み具合は、メッセージに書かない。書くのは、ユーザーに聞くことがあるときと、作業を終えたときだけにする
- ユーザーは、任せている間は画面を見ていない。途中のメッセージは読まれず、文脈を使うだけになる
- 聞くときは、前のやり取りを読まなくても分かるように、前提・選べる案・おすすめを書く
- 終えたときは、したこと・確かめたこと・ユーザーがすることを短くまとめる

**Web のみ**

- 自分の作った PR を `claude[bot]` のレビューが下書きに戻したときは、指摘を直す (または返信する) push をして CI が通ったら、ユーザーに聞かずに「レビュー可能」に戻してよい
- ほかの人が下書きに戻した PR は戻さない

Claude は、自分以外が下書きに戻した PR を、ユーザーに頼まれない限り「レビュー可能」に戻しません。この指示で、bot が戻した場合だけ Claude が戻せるようにします。

## 🎁 一緒に入るプラグイン

| プラグイン | 内容 |
|---|---|
| superpowers | 設計・実装計画・TDD・サブエージェント開発 |
| frontend-design | UI の見た目とタイポグラフィの方針 |
| playwright | ブラウザ操作と E2E テストの MCP サーバー |
| shadcn | shadcn/ui コンポーネントの追加・検索・修正 |
| security-guidance | 編集時の警告と diff・commit のレビュー |
| security-audit | Cloudflare のセキュリティ監査スキル |
| claude-security | 脆弱性スキャンと修正パッチの提案 |
