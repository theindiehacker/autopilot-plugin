<p align="center">
  <img src="docs/images/readme/hero.svg" width="100%" alt="autopilot-plugin">
</p>

<p align="center">
  <a href="https://code.claude.com/docs/en/discover-plugins"><img src="https://img.shields.io/badge/Claude_Code-indiehacker-D97757?style=for-the-badge&logo=claude&logoColor=white&labelColor=0B0B12" alt="Claude Code"></a>
  <a href=".claude-plugin/plugin.json"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Ftheindiehacker%2Fautopilot-plugin%2Fmain%2F.claude-plugin%2Fplugin.json&query=%24.version&prefix=v&label=autopilot&style=for-the-badge&color=38BDF8&labelColor=0B0B12" alt="autopilot"></a>
  <a href="renovate.json"><img src="https://img.shields.io/badge/Renovate-308BE3?style=for-the-badge&logo=renovate&logoColor=white" alt="Renovate"></a>
</p>

<p align="center"><b><code>autopilot:ready</code> を付けた Issue から、人が触らずに PR のマージまで進める流れを、<code>/autopilot:setup</code> でリポジトリに入れるプラグインです。Claude Code on the Web のセッションの準備、技術スタックの統一、自動の検査 (lint・型検査・シークレット検出・脆弱性スキャン) の導入も行います。</b></p>

## ✨ 入れるとどう変わる？

<p align="center">
  <img src="docs/images/readme/demo.svg" width="100%" alt="autopilot なしとありを、4 つの場面で比べるアニメーション。起動時: 依存を手で入れる → bun install --frozen-lockfile と uv sync --locked が自動で走る。作業の終わり: format・lint は Claude の判断しだい → Claude が作業を終えるとき task style:fix と task style:check が自動で走り、残った問題を exit 2 で Claude に返す。commit 前: 型エラーや API キーが入ったまま commit → tsc・Gitleaks が検出して中止し、Claude が修正する。push 前: 脆弱なコード・依存のまま公開 → Semgrep・Trivy が検出して中止し、Claude が修正する。">
</p>

<p align="center"><sub>※ 出力はイメージです</sub></p>

## 🤖 autopilot (Issue からマージまで)

`autopilot:ready` が付いた Issue から、人が触らずに PR のマージまで進みます。人がするのは、取り消せない変更を含む PR の承認だけです。

### 流れ

| 順 | だれが | すること |
|---|---|---|
| 1 | 人 | Issue を書く。権限のある人 (triage 以上) が `autopilot:ready` を付ける |
| 2 | ルーティン | 起動して、Issue のラベルを確かめる (`autopilot:ready` が無いか `needs-human` があれば、何もしない)。ブランチ `autopilot/<番号>-dev` と、`Closes #<番号>` を入れた Draft PR を作る |
| 3 | ルーティン | 受入条件を Issue にコメントする。条件を確かめるテストを書き、失敗するのを確かめてから実装する |
| 4 | ルーティン | アプリを起動して受入条件を確かめ、PR の本文に動作確認とエビデンスを書く (これが QA。別の Claude による確かめ直しはしない)。「レビュー可能」にして自動マージを有効にし、PR を購読する |
| 5 | GitHub Actions | Claude のレビューが動く。CODEOWNERS のパスを変える PR は、GitHub が持ち主にレビューを頼む |
| 6 | ルーティン | Request changes・CI の失敗があると、購読の通知でセッションが起きる。`autopilot:fix` の手順で、指摘ごとに採否を決めて、直して push し、返信する |
| 7 | GitHub の標準の仕組み | 必須のチェックと必須のレビューがそろうと、自動マージでマージされる |
| 8 | リポジトリ | マージの後は、リポジトリのデプロイの仕組みが動く (デプロイがあるリポジトリだけ)。autopilot は、デプロイを動かさず、確かめません |

ルーティンの持ち主が PR に書いたコメントでは、セッションは起きません (同じアカウントの書き込みは通知されないため)。直してほしいときは、ルーティンの commit の `Claude-Session:` の行のリンクから、そのセッションに直接書いてください。

### ラベル

| ラベル | 付く先 | 付ける人 | 意味 |
|---|---|---|---|
| `autopilot:ready` | Issue | triage 以上の権限がある人 | 開発を始めてよい。ルーティンが起動する |
| `needs-human` | Issue・PR | ルーティン | 止まった。人の判断が要る |

### 止まる条件と、再開のしかた

次のときは、`needs-human` を付けて止まり、理由を `<!-- autopilot:needs-human -->` 付きのコメントに書きます。

- 対応を 3 回行った後に、また失敗した (回数は `.github/autopilot.yml` の `limits.max_fix_rounds`)
- 同じ失敗が 2 回続いた
- Issue があいまいで受入条件が書けないなど、ルーティンが進めない (質問と案を書く)
- 同じ head で、PR が 2 回 Draft に戻された (1 回目は、直すことが無いので「レビュー可能」に戻した)

`needs-human` の付いた Issue・PR では、ルーティンは動きません。再開するには、答えを Issue にコメントし (読まれるのは、権限が triage 以上の人のコメントだけです)、Issue の `needs-human` を外します。続けて、Issue の `autopilot:ready` を一度外してから、付け直します。`autopilot:ready` を付けたままでは、ルーティンは起動しません。

起動しなかった Issue と、通知が来ないまま止まった PR は、自動では拾いません。気づいたら、Issue は `autopilot:ready` を一度外してから付け直します。PR は、ルーティンの commit の `Claude-Session:` の行のリンクから、そのセッションに直接書きます。

### 人がすること

| こと | 条件 |
|---|---|
| CODEOWNERS のパスを変える PR の Approve | `/autopilot:setup` が CODEOWNERS を入れたリポジトリだけ。GitHub のレビューの依頼で届く |
| `needs-human` への答え | 止まったとき。Issue にコメントして、再開する |
| Slack の通知を見る | GitHub の Slack アプリを購読したチャンネルに届く。例: `/github subscribe <owner>/<repo> issues pulls comments +label:"needs-human"` |
| 起動しなかった Issue・止まった PR に気づく | 自動では拾わない。上の「止まる条件と、再開のしかた」のとおり、付け直すか、セッションに直接書く |

### 入れたら setup の後にすること

`/autopilot:setup` は、ラベル・`.github/autopilot.yml`・CODEOWNERS (無ければ、Claude のレビューと CI のワークフローも) を入れた PR を作ります。autopilot のためのワークフローは置きません。次は、画面でしかできないので、手順を案内されてユーザーがします。

| こと | 中身 |
|---|---|
| Claude の GitHub App | https://github.com/apps/claude をリポジトリに入れる。Claude のレビューが、PR にレビューを書くために要る。既存の Claude のレビューを使うときも、入っているかを確かめる |
| シークレット | setup が Claude のレビューのワークフローを置いたときだけ。`CLAUDE_CODE_OAUTH_TOKEN` か `ANTHROPIC_API_KEY` |
| GitHub の Slack アプリ | Slack で `/github signin` を打つ。GitHub の側に Slack のアプリを入れてリポジトリを選ぶ。通知先のチャンネルで `/github subscribe …` を打つ |
| Web の環境 | 下の「入れ方」の手順 |

PR がマージされたら、setup が続きを行います。ルールセットを先に作ると、この PR も必須のレビューを待つことになり、ルーティンは、デフォルトブランチの `.github/autopilot.yml` を読むためです。

| こと | 中身 |
|---|---|
| ルールセット | 必須のチェック (CI のジョブ。必須にできる CI が無ければ無し)・必須のレビュー 1 件・push で古い Approve を取り消す・コードオーナーのレビューを必須にする。自動マージを許可する。ワークフローの既定の権限を読み取りだけにし、Actions が PR を Approve することを禁じる |
| ルーティン | プロンプトは `/autopilot:develop`、トリガーは `issues.labeled`。ルーティンは、ログインしている claude.ai のアカウントのものになる |

## ⚙️ 自動で動くもの

| タイミング | 処理 | 動く条件 |
|---|---|---|
| 起動時 | `dockerd --registry-mirror=https://mirror.gcr.io` | Web のみ |
| 起動時 | `mise install` | Web で、`mise.toml` がある |
| 起動時 | `docker compose up --build -d --wait` (プロキシの CA をビルドと起動後のコンテナに渡す) | Web で、compose ファイルがある |
| 起動時 | `packageManager` の版の bun を用意し、`bun install --frozen-lockfile` | `bun.lock` がある |
| 起動時 | uv が無ければ導入し、Ruff・ty を導入 | `pyproject.toml`・`requirements*.txt`・`setup.py` がある |
| 起動時 | `uv sync --locked` | `uv.lock` がある |
| 起動時 | Gitleaks・Semgrep・Trivy を導入 | Web のみ。ローカルは無ければ警告だけ |
| 起動時 | 下の「技術スタックの方針」を Claude に伝える | フロントエンドは `package.json`、Python は `pyproject.toml`・`requirements*.txt`・`setup.py` がある |
| 起動時・再開時・`/clear` の後・要約の後 | 下の「Claude に渡す指示」を渡す | PC でも Web でも。下書きの 2 つは Web のみ |

- **検査:** 作業の終わり・commit 前・push 前の検査は、プラグインの hook ではありません。`/autopilot:setup` が、リポジトリに入れます。編集のたびには動かしません (`style:fix` が、使う前に足した import を消すため)。

  | 時点 | 動かすもの | 入れる先 |
  |---|---|---|
  | Claude が作業を終えるとき | `style:fix` → `style:check` (30 分まで)。通らなければ exit 2 で Claude に直させる | `.claude/settings.json` の `Stop` の hook |
  | commit 前 | `style:check`・`gitleaks --staged` | lefthook の `pre-commit` |
  | push 前 | `security:check` | lefthook の `pre-push` |

  どれも、リポジトリのタスクランナーの `style:check`・`style:fix`・`security:check` (と、アプリを起動する `dev:up`) を呼びます。lefthook は git の hook なので、人がターミナルで commit・push したときにも動きます。Web では、起動時に `lefthook install` を行います (`pre-commit` を使うリポジトリでは `pre-commit install`)。
- **LSP:** Claude が TypeScript と ty の LSP を使えます。
- **ローカルでの準備:** Gitleaks・Semgrep・Trivy は、Mac では `brew install semgrep gitleaks trivy` で入れられます。無いと、警告が 1 行出て、その検査は飛ばされます (commit・push は止まりません)。

### 📐 技術スタックの方針

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

### 📝 Claude に渡す指示

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

## 📥 入れ方

<details><summary><b>☁️ Claude Code on the Web</b></summary>

**1. 環境のメニューを開く**

[claude.ai/code](https://claude.ai/code) を開き、入力欄の下の雲のマーク (①) を押してから、「新しい環境」(②) を押します。

<img src="docs/images/cloud-1-open-menu.png" width="356" alt="入力欄の下の雲のマークを①、メニューの「新しい環境」を②として赤枠で示した画面">

**2. 環境の名前を入れる**

「名前」(①) に、好きな名前を入れます。

<img src="docs/images/cloud-2-new-environment.png" width="420" alt="新しい環境の画面。「名前」を①、「ネットワークアクセス」を②、「セットアップスクリプト」を③、「環境を追加」を④として赤枠で示している">

**3. ネットワークアクセスを設定する**

手順 2 の画面の「ネットワークアクセス」(②) を押して、次のように設定します。

- ① 「制限付き」を選びます。
- ② 「許可されたドメイン」に、次の内容をコピーして貼り付けます。

  ```
  semgrep.dev
  pkg-containers.githubusercontent.com
  dl.google.com
  dl-cdn.alpinelinux.org
  ui.shadcn.com
  cdn.playwright.dev
  ```

- ③ 「[パッケージマネージャー](https://code.claude.com/docs/en/cloud-environments#default-allowed-domains)を許可」にチェックを入れます。
- ④ 「<」を押して、前の画面に戻ります。

<img src="docs/images/cloud-3-network-access.png" width="420" alt="ネットワークアクセスの画面。「制限付き」を①、「許可されたドメイン」を②、「パッケージマネージャーを許可」を③、戻るボタンを④として赤枠で示している">

**4. セットアップスクリプトを設定する**

手順 2 の画面の「セットアップスクリプト」(③) を押して、次のように設定します。

- ① 次の内容をコピーして貼り付けます。

  ```bash
  claude plugin marketplace add anthropics/claude-plugins-official
  claude plugin marketplace add theindiehacker/autopilot-plugin
  claude plugin install autopilot@indiehacker

  # 2026-11-11
  ```

- ② 「<」を押して、前の画面に戻ります。

<img src="docs/images/cloud-4-setup-script.png" width="420" alt="セットアップスクリプトの画面。入力欄を①、戻るボタンを②として赤枠で示している">

**5. 環境を追加する**

手順 2 の画面の「環境を追加」(④) を押します。新しいセッションで、この環境が使われます。

**プラグインを更新したとき**

> [!WARNING]
> プラグインを更新したら、「セットアップスクリプト」の最後の行の日付を、更新した日に書き換えてください。書き換えないと、古いプラグインのまま動くことがあります。

作った環境は、手順 1 のメニューで環境の行にマウスを乗せ、歯車のマーク (①) を押すと開けます。書き換えたら保存してください。

<img src="docs/images/cloud-5-edit-environment.png" width="356" alt="メニューの環境の行にマウスを乗せると出る歯車のマークを①として赤枠で示した画面">

</details>

<details><summary><b>💻 PC の Claude Code</b></summary>

**1. ターミナルを開く**

Mac では、`⌘` + `スペース` を押して「ターミナル」と入力し、`return` を押します。

**2. コマンドを実行する**

次のコマンドをコピーしてターミナルに貼り付け、`return` を押します。`marketplace add` が要るのは最初の 1 回だけです。

```bash
claude plugin marketplace add anthropics/claude-plugins-official
claude plugin marketplace add theindiehacker/autopilot-plugin

claude plugin install autopilot@indiehacker
```

**3. 結果を確かめる**

`✔ Successfully` が 3 つ出れば成功です。

**4. Claude Code を起動し直す**

Claude Code を開いていたら、起動し直します。

> [!NOTE]
> - Web 用の処理 (`dockerd`・`mise install`・`docker compose up`・Claude に渡す指示のうち下書きの 2 つ) は、PC では動きません。
> - lefthook の検査には、Semgrep・Gitleaks・Trivy が要ります。Mac では `brew install semgrep gitleaks trivy` で入れられます。

</details>

<details><summary><b>🔁 前のプラグイン (cloud・frontend・python・security) から移る</b></summary>

前のプラグインを入れたままにすると、hook が 2 回ずつ動きます。

**Claude Code on the Web**

「セットアップスクリプト」を、上の手順 4 の内容に書き換えてください。

**PC の Claude Code**

次のコマンドを実行してから、Claude Code を起動し直します。

```bash
claude plugin uninstall security@indiehacker
claude plugin uninstall frontend@indiehacker
claude plugin uninstall python@indiehacker
claude plugin marketplace update indiehacker

claude plugin install autopilot@indiehacker
```

</details>

## 🔧 入れたら setup を実行する

プラグインを入れただけでは、既存のリポジトリに、検査も autopilot も入りません。Claude Code on the Web では、起動時の `docker compose up` などが失敗することもあります。PC の Claude Code で `/autopilot:setup` を実行すると、リポジトリを調べて環境を整え、autopilot を入れて、PR を作ります (クラウドのセッションでは、ルーティンを作れません)。

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
| 8 | autopilot を入れる | 毎回 | ラベル 2 つ (`autopilot:ready`・`needs-human`)・`.github/autopilot.yml`・`.github/CODEOWNERS` を入れる。Claude のレビューと CI が無ければ用意する。Claude の GitHub App・シークレット (Claude のレビューを置いたとき)・Slack の購読・Web の環境は、ユーザーに頼む |

技術スタックの移行を先に行うのは、5 で動かす `docker compose up --build` が、移行した後の lock ファイルでビルドするためです。検査を入れるのは、7 で、入れた検査と同じコマンドを動かして、既存の指摘を直すためです。セキュリティを autopilot の前に行うのは、移行で変わった依存も検査するためです。

8 のラベルは、同意の後すぐに GitHub のリポジトリに作ります (ラベルは、PR をマージしなくても残ります)。

入れ終えたら、PR を作るかを聞き、作ると答えたら PR を 1 つ作ります。手順の途中では commit しません。ルールセットとルーティンは、この PR のマージの後に作ります (「🤖 autopilot」を参照)。

## ⚠️ 注意

- これらのツールで検出できない脆弱性もあります。
- 受入条件の確かめ (QA) は、ルーティンが PR の本文に書く動作確認だけです (自己申告。受入条件ごとのエビデンスが付きます)。別の Claude が確かめ直すことはありません。
- 必須にできる CI が無いリポジトリでは、必須のチェックが無いので、CI の結果を待たずに、Claude のレビューの承認だけで自動マージされます。
- 公開リポジトリでは、だれのコメントも、自動モードのルーティンのセッションに入ります。autopilot のリポジトリだけに届く、自動化専用の GitHub アカウントを使うことを勧めます。
- Terraform の apply がマージで動くリポジトリでは、CODEOWNERS の Approve の後に、取り消せない操作が自動で走ります。apply を、手動のワークフローか別のリポジトリにすることを勧めます (setup は案を出すだけで、作りません)。
- デプロイは、autopilot ではなく、リポジトリのデプロイの仕組みが動きます。autopilot は、デプロイを動かさず、確かめません。デプロイの失敗は、GitHub の Slack アプリの購読 (`/github subscribe <owner>/<repo> workflows:{name:"<デプロイのワークフローの名前>"}`) で知らせられます。
