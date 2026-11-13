# 検査を入れる
検査と起動を、リポジトリのタスクランナーの 4 つのタスクにそろえます。人 (lefthook)・CI・Claude の hook・動作確認・QA は、どれもこのタスクを呼びます。検査の条件を 1 か所に書き、どこで動かしても同じ結果にするためです。プラグインは、検査の hook を持ちません。

| タスク | 中身 |
|---|---|
| `style:check` | スタイルの検査 (lint・整形・型・依存)。直さない |
| `style:fix` | スタイルの自動修正 |
| `security:check` | セキュリティの検査 (Gitleaks・Semgrep・Trivy など) |
| `dev:up` | アプリの全部を後ろで起動し、準備ができるまで待って終わる (MCP サーバーがあれば、その応答も確かめる)。ログは `dev:logs`、止めるのは `dev:down` |

| 時点 | 動かすもの | どこに書くか |
|---|---|---|
| 編集のたび | 動かさない (`style:fix` が、使う前に足した import を消すため) | |
| Claude が作業を終えるとき | `style:fix` → `style:check`。通らなければ Claude に直させる | `.claude/settings.json` の `Stop` |
| commit 前 | `style:check` と、Gitleaks の `--staged` (commit に入る差分だけ) | lefthook の `pre-commit` |
| push 前 | `security:check` | lefthook の `pre-push` |
| CI | `style:check`・`security:check` | CI のワークフロー |
| 動作確認・QA | `dev:up` | `.github/autopilot.yml` の `qa.start` (autopilot.md の手順 2) |

lefthook は git の hook なので、Claude だけでなく、人がターミナルで commit・push したときにも動きます。

## 1. 調べる
### タスクランナー
リポジトリのタスクランナー (`Taskfile.yml`・`Makefile`・`package.json` の `scripts`) を見つけ、4 つのタスクと `dev:logs`・`dev:down` があるかを確かめます。タスクは、そのランナーに書きます。

| 見つかったもの | タスクを書く先 | タスクの名前 | 呼ぶコマンド |
|---|---|---|---|
| `Taskfile.yml` | `Taskfile.yml` | `style:check` など、そのまま | `task style:check` |
| `Makefile` | `Makefile` | `style-check` など (`:` を `-` にする) | `make style-check` |
| `package.json` の `scripts` だけ | ルートの `package.json` の `scripts` | `style:check` など、そのまま | `bun run style:check` (npm なら `npm run style:check`) |
| 何も無い | `Taskfile.yml` を足す | `style:check` など | `task style:check` |

- 名前は、そのランナーで書ける形にします。Make のターゲットには `:` をそのまま書けないため、`-` にします (`style-check`・`style-fix`・`security-check`・`dev-up`・`dev-logs`・`dev-down`)。Taskfile と `package.json` の `scripts` は `:` を書けるので、そのままにします
- hook・lefthook・CI・`qa.start` には、表の「呼ぶコマンド」を書きます
- `package.json` の `scripts` は、Taskfile・Makefile が無いときだけ使います。Taskfile と Makefile の両方があれば、どちらに書くかをユーザーに聞きます
- 名前が違っても同じ中身のタスク (`lint`・`format` など) があれば、検査を書き直さず、新しいタスクからそれを呼びます。リポジトリで決めた検査の条件を、二重に書かないためです
- あるタスクは消さず、足りない検査だけを足します
- Taskfile を足したときは、`task` を `mise.toml` に足すか (`mise use task`) をユーザーに聞きます。QA のワークフローと Web の起動時の処理は、`mise.toml` のツールを入れるためです。`task` が無い環境では、hook と lefthook は検査を飛ばし、QA の `qa.start` は失敗します

### git hook
すでにある git hook の仕組みを調べてください。

```bash
ls lefthook.yml lefthook.yaml .lefthook.yml .pre-commit-config.yaml .husky 2>/dev/null
```

| 見つかったもの | すること |
|---|---|
| 何も無い | 手順 3 で、ひな形から `lefthook.yml` を作る |
| `lefthook.yml` | 足りない検査だけを足す。既存の検査は消さない |
| `.pre-commit-config.yaml` | lefthook への移行を勧め、ユーザーに選んでもらう。移行しないと答えたら、pre-commit に同じ検査を足す |
| `.husky/` | ユーザーに、lefthook に移すか、husky に足すかを聞く |

## 2. タスクを書く
無いタスクを、技術スタックから中身を決めて足します。次の表は、どの検査をどのタスクに入れるかの例です。リポジトリに無いもの (Python が無ければ Ruff・ty など) は入れません。

| タスク | 検査 | コマンド | 注意 |
|---|---|---|---|
| `style:check` | 型検査 | `bun run typecheck` | `package.json` に `typecheck` が無ければ、frontend.md の手順で足す |
| | Biome | `bun run biome check .` | |
| | Ruff | `uv run --frozen ruff check .`・`uv run --frozen ruff format --check .` | |
| | ty | `uv run --frozen ty check` | |
| | deptry | `uv run --frozen deptry src` (src レイアウトでなければ `.`) | `deptry` が dev 依存に無ければ `uv add --dev deptry` |
| | import-linter | `uv run --frozen lint-imports` | 設定 (`.importlinter`、`pyproject.toml`・`setup.cfg` の importlinter) があるときだけ入れる。`import-linter` が dev 依存に無ければ `uv add --dev import-linter` |
| `style:fix` | Biome | `bun run biome check --write .` | |
| | Ruff | `uv run --frozen ruff check --fix .` → `uv run --frozen ruff format .` | |
| `security:check` | Gitleaks | `gitleaks git --redact --verbose --ignore-gitleaks-allow` | commit した履歴を見る。`gitleaks dir` は `.gitignore` を見ず、`.env` などで止まるため使わない。`--ignore-gitleaks-allow` は、`gitleaks:allow` のコメントで検査を避けられないようにする |
| | Semgrep | `semgrep scan --config p/owasp-top-ten --metrics off --severity ERROR --error --disable-nosem` | 指摘があるとき (exit 1) だけ止める。ルールを取得できないなどの失敗は、通す (後ろに `\|\| [ $? -ne 1 ]` を付ける。Makefile では `$$?`)。`--disable-nosem` は、`nosemgrep` のコメントで検査を避けられないようにする |
| | Trivy | `trivy fs --scanners vuln,misconfig,secret --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 .` | |

- commit 前の Gitleaks (`--staged`) は、タスクに入れません。lefthook のひな形が直接呼びます (手順 3)
- フロントエンドやバックエンドが `frontend/`・`backend/` のようにフォルダで分かれていれば、それぞれのフォルダで動かします。Taskfile なら、フォルダごとのタスクに `dir:` を付け、`style:check` などから呼びます (下の例)
- `.gitleaks.toml`・`.gitleaksignore`・`.semgrepignore`・`trivy.yaml` が既にあれば、そのまま使われます
- タスクの中のツール (uv・bun・Gitleaks・Semgrep・Trivy) が無いと、そのタスクは失敗します。Web では起動時の処理が入れます。ローカルでは、Mac なら `brew install semgrep gitleaks trivy` で入れるよう、README に書いてください
- Trivy は、git に入らないファイル (`node_modules` など) も見ます。時間がかかるときは、`trivy.yaml` の `scan.skip-dirs` で絞ります

### `dev:up`
`dev:up` は、アプリの全部を後ろで起動し、準備ができるまで待って**終わる**タスクにします。人・Claude の動作確認・QA が、同じ方法で起動します (`.github/autopilot.yml` の `qa.start` は、このタスクのコマンドです)。起動したまま終わらないコマンド (`bun run dev` だけなど) だと、ワークフローの step が終わらず、QA が進みません。

- compose で起動できるなら、`docker compose up --build -d --wait <サービス>` (サービスが healthy になるまで待って戻る)
- dev サーバーなら、`nohup <コマンド> > /tmp/<名前>.log 2>&1 &` で後ろにし、応答するまで待つ (例: `npx wait-on http://localhost:3000`、または `curl --retry 30 --retry-connrefused --retry-delay 2 -fsS http://localhost:3000 >/dev/null`)
- 中身は、Taskfile・compose から取る。E2E の起動 (`task dev:e2e` など) があれば、その中身を踏襲する
- アプリが MCP サーバーを出していれば、それも起動し、最後に `tools/list` を curl で送って応答を確かめる (QA が MCP のツールの条件を確かめられるように。登録は autopilot.md の手順 3 の `{{QA_MCP_SERVERS}}`)。CI に同じ確かめがあれば、それを踏襲する。例: `curl -fsS -o /dev/null -X POST -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' http://127.0.0.1:8002/mcp`
- すでにある `dev:up` が、起動したまま終わらない (dev サーバーを前で動かすなど) ときは、後ろで起動して待つ形に直す
- `dev:logs` は、起動したもののログを出す (compose なら `docker compose logs`、dev サーバーなら `/tmp/<名前>.log`)。`dev:down` は、起動したものを止める (compose なら `docker compose down`、dev サーバーなら起動したコマンドを `pkill -f '[b]un run dev' || true` のように探して止める。先頭の文字を `[]` で囲むのは、Make や `package.json` の scripts で、`pkill` を動かすシェル自身が当たって止まらないようにするため)

### 例 (Taskfile)
compose の `api` と、`frontend/` の dev サーバー、`backend/` の Python があるときの例です。

```yaml
version: '3'

tasks:
  style:check:
    desc: スタイルの検査 (直さない)
    cmds:
      - task: frontend:style:check
      - task: backend:style:check

  style:fix:
    desc: スタイルの自動修正
    cmds:
      - task: frontend:style:fix
      - task: backend:style:fix

  security:check:
    desc: セキュリティの検査
    cmds:
      - gitleaks git --redact --verbose --ignore-gitleaks-allow
      - semgrep scan --config p/owasp-top-ten --metrics off --severity ERROR --error --disable-nosem || [ $? -ne 1 ]
      - trivy fs --scanners vuln,misconfig,secret --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 .

  dev:up:
    desc: アプリの全部を後ろで起動し、準備ができるまで待つ
    cmds:
      - docker compose up --build -d --wait api
      - cd frontend && bun install --frozen-lockfile
      - cd frontend && (nohup bun run dev > /tmp/frontend.log 2>&1 &)
      - curl --retry 30 --retry-connrefused --retry-delay 2 -fsS http://localhost:3000 >/dev/null

  dev:logs:
    desc: ログを出す
    cmds:
      - docker compose logs
      - cat /tmp/frontend.log

  dev:down:
    desc: dev:up で起動したものを止める
    cmds:
      - pkill -f '[b]un run dev' || true
      - docker compose down

  frontend:style:check:
    dir: frontend
    cmds:
      - bun run typecheck
      - bun run biome check .

  frontend:style:fix:
    dir: frontend
    cmd: bun run biome check --write .

  backend:style:check:
    dir: backend
    cmds:
      - uv run --frozen ruff check .
      - uv run --frozen ruff format --check .
      - uv run --frozen ty check
      - uv run --frozen deptry src

  backend:style:fix:
    dir: backend
    cmds:
      - uv run --frozen ruff check --fix .
      - uv run --frozen ruff format .
```

## 3. hook と CI に入れる
### lefthook
[templates/lefthook.yml](templates/lefthook.yml) を、リポジトリのルートに `lefthook.yml` として置き、次の文字列を置き換えます。

| 文字列 | 値 (Taskfile の例) |
|---|---|
| `{{RUNNER}}` | タスクランナーのコマンド。`task` (Make なら `make`、`package.json` なら `bun`) |
| `{{STYLE_CHECK}}` | `task style:check` |
| `{{SECURITY_CHECK}}` | `task security:check` |

- commit 前の Gitleaks は、ひな形のまま lefthook に書きます。`--staged` で、commit に入る差分だけを見るためです
- ひな形は、タスクランナーや Gitleaks が無いと、警告を 1 行出してその検査を飛ばします (ローカルで入れていない人の commit・push を止めないため)
- pre-commit に足すときは、同じコマンドを `repo: local` の `hooks` (`language: system`・`pass_filenames: false`・`stages: [pre-commit]` か `[pre-push]`) に書きます

### Claude の Stop の hook
[templates/claude-settings.json](templates/claude-settings.json) の `hooks` を、リポジトリの `.claude/settings.json` に足します。ファイルが無ければ、そのまま置きます。あれば、既存の設定は消さず、`hooks.Stop` の配列に足します。`{{RUNNER}}`・`{{STYLE_CHECK}}` は lefthook と同じ値に、`{{STYLE_FIX}}` は `style:fix` のコマンド (例: `task style:fix`) に置き換えます。

この hook は、Claude が作業を終えて止まるときに、`style:fix` → `style:check` を動かします。

- 編集のたびには動かしません。`style:fix` は使っていない import を消すため、import を足してから使う編集の途中で動かすと、足した import が消えてしまうからです
- 通らなければ、出力の最後の 80 行を Claude に渡し (exit 2)、直させます
- 標準入力の `stop_hook_active` が true (この hook が止めた後に、もう一度止まるとき) は、動かしません。止め続けて、回り続けないためです。2 回目に残った問題は、commit 前の検査と CI が見ます
- 変えたファイルが無い (`git status --porcelain` が空) ときは、動かしません。何も変えていないセッションで、時間をかけないためです
- タスクランナーのコマンドが無いときも、何もせず通します (直す問題として Claude に伝えないため)
- 上限は 30 分 (`timeout: 1800`) です。リポジトリ全体の検査は、時間がかかることがあるためです
- 1 行で書いてあるのは、スクリプトを別に置かないためです。標準入力の読み取りに `jq` を使わないのは、Mac に無いことがあるためです

### CI
CI に、`style:check`・`security:check` を呼ぶ job が無ければ足します。CI のワークフローが無ければ、autopilot.md の手順 4 で CI を作るときに入れます。

- job は、タスクのコマンド (例: `task style:check`) を動かすだけにします。検査の条件を、ワークフローに書き直しません
- job は、タスクが使うツール (タスクランナー・bun・uv・Gitleaks・Semgrep・Trivy) を先に入れます。actions は SHA で固定し、`# vX.Y.Z` を付けます
- 組織の共通ワークフロー (survey.md で見た org のルールセットの必須のワークフローなど) でセキュリティの検査をしているリポジトリでは、`security:check` の job は足しません。push 前の lefthook では動きます。分からなければ、ユーザーに聞きます

## 4. 入れて、確かめる
1. `lefthook install` を動かす (pre-commit なら `pre-commit install`)。`lefthook` が無ければ、`brew install lefthook` か `bun add -d lefthook` で入れる。Web では起動時の処理が `lefthook install` を行います。PATH の `lefthook`、`node_modules/.bin/lefthook`、`bunx lefthook` の順に探すので、`bun add -d lefthook` で入れておけば動きます (どれも無いと警告が出ます)
2. わざとシークレットを入れたファイルを作り、`git add` して commit する。Gitleaks が止めれば成功
   ```bash
   printf 'AWS_KEY=AKIA%s\n' Z3MSJV4WWD7QXK2N > leak-test.txt
   ```
   (AWS の例の鍵 (`AKIA` と `IOSFODNN7EXAMPLE`) は Gitleaks が見逃すため使いません。鍵を分けて書くのは、この文書自体が検出されないようにするためです)
3. そのファイルを `git reset` で外してから消す。commit は残さない
4. `style:check`・`security:check` を動かし (例: `task style:check`)、既存のコードで失敗するものがあれば、一覧にしてユーザーに伝える。直すのは、次の手順 (security.md) と、各技術スタックの手順で行う
5. `dev:up` を動かし、すぐ終わることと、アプリ (と MCP サーバー) が応答することを確かめる。`dev:logs` でログが出ること、`dev:down` で止まることも確かめる

変更は、手順の途中では commit しません。最後の PR でまとめて commit します。
