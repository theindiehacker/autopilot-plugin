# 検査を入れる
編集後・commit 前・push 前の検査を、リポジトリに入れます。lefthook (git の hook) と `.claude/settings.json` の hooks に書くので、Claude だけでなく、人がターミナルで commit・push したときにも動きます。プラグインは、検査の hook を持ちません。

| いつ | どこに入れるか | 中身 |
|---|---|---|
| 編集後 | `.claude/settings.json` の `PostToolUse` | 編集したファイルの整形と lint (Biome・Ruff) |
| commit 前 | lefthook の `pre-commit` | 型検査・ty・deptry・import-linter・Gitleaks |
| push 前 | lefthook の `pre-push` | Semgrep・Trivy |

## 1. 調べる
すでにある git hook の仕組みを調べてください。

```bash
ls lefthook.yml lefthook.yaml .lefthook.yml .pre-commit-config.yaml .husky 2>/dev/null
```

| 見つかったもの | すること |
|---|---|
| 何も無い | 手順 2 で、ひな形から `lefthook.yml` を作る |
| `lefthook.yml` | 足りない検査だけを足す。既存の検査は消さない |
| `.pre-commit-config.yaml` | lefthook への移行を勧め、ユーザーに選んでもらう。移行しないと答えたら、pre-commit に同じ検査を足す |
| `.husky/` | ユーザーに、lefthook に移すか、husky に足すかを聞く |

## 2. 検査の中身を決める
[templates/lefthook.yml](templates/lefthook.yml) を、リポジトリのルートに `lefthook.yml` として置きます。ひな形の各検査は、対象が無いリポジトリでは何もせず通ります。リポジトリに合わせて、次を直してください。

| 検査 | 動かすコマンド | 直すとき |
|---|---|---|
| 型検査 | `bun run typecheck` | `package.json` に `typecheck` が無ければ、frontend.md の手順で足す |
| ty | `uv run --frozen ty check` | |
| deptry | `uv run --frozen deptry src` (src レイアウトでなければ `.`) | `deptry` が dev 依存に無ければ `uv add --dev deptry` |
| import-linter | `uv run --frozen lint-imports` | 設定があるときだけ動く。`import-linter` が dev 依存に無ければ `uv add --dev import-linter` |
| Gitleaks | `gitleaks git --staged --redact --verbose --ignore-gitleaks-allow` | commit に入る差分だけを検査する。`--ignore-gitleaks-allow` は、`gitleaks:allow` のコメントで検査を避けられないようにする |
| Semgrep | `semgrep scan --config p/owasp-top-ten --metrics off --severity ERROR --error --disable-nosem` | 指摘があるとき (exit 1) だけ止める。ルールを取得できないなどの失敗は、通す。`--disable-nosem` は、`nosemgrep` のコメントで検査を避けられないようにする |
| Trivy | `trivy fs --scanners vuln,misconfig,secret --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 .` | |

- リポジトリのタスクランナー (`Taskfile.yml`・`Makefile`・`package.json` の `scripts` など) に同じ検査のコマンドがあれば、ひな形のコマンドではなく、それを呼びます (例: `run: task security:check`)。リポジトリで決めた検査の条件を、二重に書かないためです
- フロントエンドやバックエンドが `frontend/`・`backend/` のようにフォルダで分かれていれば、検査ごとに `root: frontend/` を付けます
- `.gitleaks.toml`・`.gitleaksignore`・`.semgrepignore`・`trivy.yaml` が既にあれば、そのまま使われます
- ひな形は、ツール (Gitleaks・Semgrep・Trivy・uv・bun) が無いと、警告を 1 行出してその検査を飛ばします (ローカルで入れていない人の commit・push を止めないため)。Web では起動時の処理が入れるので、飛ばされません。ローカルでは、Mac なら `brew install semgrep gitleaks trivy` で入れるよう、README に書いてください
- pre-commit に足すときは、同じコマンドを `repo: local` の `hooks` (`language: system`・`pass_filenames: false`・`stages: [pre-commit]` か `[pre-push]`) に書きます
- Trivy は、git に入らないファイル (`node_modules` など) も見ます。時間がかかるときは、`trivy.yaml` の `scan.skip-dirs` で絞ります

## 3. 編集後の hook を入れる
[templates/claude-settings.json](templates/claude-settings.json) の `hooks` を、リポジトリの `.claude/settings.json` に足します。ファイルが無ければ、そのまま置きます。あれば、既存の設定は消さず、`hooks.PostToolUse` の配列に足します。

この hook は、`Edit`・`Write`・`MultiEdit` で編集したファイルだけを検査します。

| 対象 | 動かすもの | 条件 |
|---|---|---|
| `.py`・`.pyi` | `uv run --frozen ruff check --force-exclude --fix --unfixable F401` → `uv run --frozen ruff format --force-exclude` → `uv run --frozen ruff check --force-exclude --ignore F401` | 編集したファイルから親フォルダをたどって、最初に見つかる `pyproject.toml` のフォルダで動かす |
| そのほか | `node_modules/.bin/biome check --write` | 同じく、最初に見つかる `biome.json(c)` のフォルダで動かす |

- ファイルのパスを直接渡すと、ruff は pyproject.toml の exclude を見ないため、--force-exclude を付ける。

- 使う前に足した import を消さないため、F401 (使っていない import) は自動で直さず、hook では伝えません (commit 前の検査と CI が見ます)
- 直せない問題が残ったら、exit 2 で出力を Claude に渡し、直させます (編集は取り消しません)
- 1 行で書いてあるのは、スクリプトを別に置かないためです。ファイルの読み取りに `jq` を使わないのは、Mac に無いことがあるためです
- ツール (`uv`・ruff・`bunx`・Biome) が無いときや、`pyproject.toml`・`biome.json(c)` が無いときは、何もせず通します (直す問題として Claude に伝えないため)。プロジェクトの外のファイルとシンボリックリンクも見ません
- hook は、`biome.json(c)` のあるフォルダの `node_modules/.bin/biome` があるときだけ動き、無ければ何もしません (`bunx` は、入っていないと版を固定せずに取ってくるため使いません)
- ひな形は、`pyproject.toml`・`biome.json(c)` を、編集したファイルの親フォルダからリポジトリのルートまでたどって探し、見つかったフォルダに `cd` して動かします。`backend/`・`frontend/` のように分かれていても、直さずに動きます。見つからなければ何もしません
- Python の型検査 (ty) は、編集のたびには動かしません。commit 前の検査で動きます

## 4. 入れて、確かめる
1. `lefthook install` を動かす (pre-commit なら `pre-commit install`)。`lefthook` が無ければ、`brew install lefthook` か `bun add -d lefthook` で入れる。Web では起動時の処理が `lefthook install` を行います。PATH の `lefthook`、`node_modules/.bin/lefthook`、`bunx lefthook` の順に探すので、`bun add -d lefthook` で入れておけば動きます (どれも無いと警告が出ます)
2. わざとシークレットを入れたファイルを作り、`git add` して commit する。Gitleaks が止めれば成功
   ```bash
   printf 'AWS_KEY=AKIA%s\n' Z3MSJV4WWD7QXK2N > leak-test.txt
   ```
   (AWS の例の鍵 (`AKIA` と `IOSFODNN7EXAMPLE`) は Gitleaks が見逃すため使いません。鍵を分けて書くのは、この文書自体が検出されないようにするためです)
3. そのファイルを `git reset` で外してから消す。commit は残さない
4. `lefthook run pre-commit --all-files` を動かし、既存のコードで失敗する検査があれば、一覧にしてユーザーに伝える。直すのは、次の手順 (security.md) と、各技術スタックの手順で行う

変更は、手順の途中では commit しません。最後の PR でまとめて commit します。
