<p align="center">
  <img src="docs/images/readme/hero.svg" width="100%" alt="dev-plugins">
</p>

<p align="center">
  <a href="https://code.claude.com/docs/en/discover-plugins"><img src="https://img.shields.io/badge/Claude_Code-indiehacker-D97757?style=for-the-badge&logo=claude&logoColor=white&labelColor=0B0B12" alt="Claude Code"></a>
  <a href="plugins/frontend"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Ftheindiehacker%2Fdev-plugins%2Fmain%2Fplugins%2Ffrontend%2F.claude-plugin%2Fplugin.json&query=%24.version&prefix=v&label=frontend&style=for-the-badge&color=A78BFA&labelColor=0B0B12" alt="frontend"></a>
  <a href="plugins/python"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Ftheindiehacker%2Fdev-plugins%2Fmain%2Fplugins%2Fpython%2F.claude-plugin%2Fplugin.json&query=%24.version&prefix=v&label=python&style=for-the-badge&color=FACC15&labelColor=0B0B12" alt="python"></a>
  <a href="plugins/cloud"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Ftheindiehacker%2Fdev-plugins%2Fmain%2Fplugins%2Fcloud%2F.claude-plugin%2Fplugin.json&query=%24.version&prefix=v&label=cloud&style=for-the-badge&color=38BDF8&labelColor=0B0B12" alt="cloud"></a>
  <a href="plugins/security"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Ftheindiehacker%2Fdev-plugins%2Fmain%2Fplugins%2Fsecurity%2F.claude-plugin%2Fplugin.json&query=%24.version&prefix=v&label=security&style=for-the-badge&color=34D399&labelColor=0B0B12" alt="security"></a>
  <a href="renovate.json"><img src="https://img.shields.io/badge/Renovate-308BE3?style=for-the-badge&logo=renovate&logoColor=white" alt="Renovate"></a>
</p>

<p align="center"><b>Claude Code に、技術スタックの統一と、hooks による自動チェック (lint・型検査・シークレット検出・脆弱性スキャン) を追加するプラグイン集です。</b></p>

## ✨ 入れるとどう変わる？

<p align="center">
  <img src="docs/images/readme/demo.svg" width="100%" alt="dev-plugins なしとありを、4 つの場面で比べるアニメーション。起動時: 依存を手で入れる → bun install --frozen-lockfile と uv sync --locked が自動で走る。編集後: format・lint は Claude の判断しだい → biome check --write が自動で走り、残った問題を exit 2 で Claude に通知する。commit 前: 型エラーや API キーが入ったまま commit → tsc・Gitleaks が検出して中止し、Claude が修正する。push 前: 脆弱なコード・依存のまま公開 → Semgrep・Trivy が検出して中止し、Claude が修正する。">
</p>

<p align="center"><sub>※ 出力はイメージです</sub></p>

## 🧩 プラグイン

<p align="center">
  <a href="plugins/frontend/README.md"><img src="docs/images/readme/plugin-frontend.svg" width="49%" alt="frontend の README を開く。対象: TypeScript・Next.js のフロントエンド。Bun・Biome・TypeScript・Next.js・Tailwind CSS・shadcn/ui・Playwright、一緒に入る superpowers・frontend-design・playwright・shadcn・security-guidance、コマンド /frontend:setup"></a>
  <a href="plugins/python/README.md"><img src="docs/images/readme/plugin-python.svg" width="49%" alt="python の README を開く。対象: Python。Python・uv・Ruff・ty・deptry・import-linter、一緒に入る superpowers・security-guidance、コマンド /python:setup"></a>
</p>

<p align="center">
  <a href="plugins/cloud/README.md"><img src="docs/images/readme/plugin-cloud.svg" width="49%" alt="cloud の README を開く。対象: Claude Code on the Web のみ。Docker・Docker Compose・mise、起動時に dockerd・mise install・docker compose up を実行、コマンド /cloud:setup"></a>
  <a href="plugins/security/README.md"><img src="docs/images/readme/plugin-security.svg" width="49%" alt="security の README を開く。対象: すべてのリポジトリ。Gitleaks・Semgrep・Trivy・OWASP Top 10、一緒に入る security-guidance・security-audit・claude-security"></a>
</p>

カードを押すと、自動で動くものや技術スタックの移行を書いた README を開けます。

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
  claude plugin marketplace add theindiehacker/dev-plugins
  claude plugin install cloud@indiehacker
  claude plugin install security@indiehacker
  claude plugin install frontend@indiehacker
  claude plugin install python@indiehacker
  claude plugin install dev@indiehacker

  # 2026-11-08
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
claude plugin marketplace add theindiehacker/dev-plugins

claude plugin install security@indiehacker
claude plugin install frontend@indiehacker
claude plugin install python@indiehacker
claude plugin install dev@indiehacker
```

**3. 結果を確かめる**

赤枠のように `✔` が 6 つ出れば成功です。

<img src="docs/images/pc-install.png" width="700" alt="ターミナルの画面。コマンドごとに出る ✔ Successfully の表示を赤枠で示している">

**4. Claude Code を起動し直す**

Claude Code を開いていたら、起動し直します。

> [!NOTE]
> - `cloud` は Claude Code on the Web のセッションを準備するプラグインなので、PC には入れません。
> - `security` のコミット・push 前の検査には、Semgrep・Gitleaks・Trivy が要ります。Mac では `brew install semgrep gitleaks trivy` で入れられます。

</details>

## ⚠️ 注意

- hooks が動くのは Claude Code の操作だけです。ターミナルで直接 commit・push すると動きません。
- これらのツールで検出できない脆弱性もあります。
