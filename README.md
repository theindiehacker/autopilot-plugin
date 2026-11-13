<p align="center">
  <img src="docs/images/readme/hero.svg" width="100%" alt="autopilot-plugin">
</p>

<p align="center">
  <a href="https://code.claude.com/docs/en/discover-plugins"><img src="https://img.shields.io/badge/Claude_Code-indiehacker-D97757?style=for-the-badge&logo=claude&logoColor=white&labelColor=0B0B12" alt="Claude Code"></a>
  <a href=".claude-plugin/plugin.json"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Ftheindiehacker%2Fautopilot-plugin%2Fmain%2F.claude-plugin%2Fplugin.json&query=%24.version&prefix=v&label=autopilot&style=for-the-badge&color=38BDF8&labelColor=0B0B12" alt="autopilot"></a>
  <a href="renovate.json"><img src="https://img.shields.io/badge/Renovate-308BE3?style=for-the-badge&logo=renovate&logoColor=white" alt="Renovate"></a>
</p>

<p align="center"><b>Issue に <code>autopilot:ready</code> を付けると、Claude が実装して PR を出し、レビューと CI が通ればマージまで進みます。<br>その仕組みを、<code>/autopilot:setup</code> でリポジトリに入れる Claude Code のプラグインです。</b></p>

## ✨ できること

<p align="center">
  <img src="docs/images/readme/demo.svg" width="100%" alt="Issue からマージまでを 5 つの場面で見せるアニメーション。1. 人が Issue に autopilot:ready を付ける。2. ルーティンが Draft PR を作り、受入条件をコメントして、テストを書いてから実装する。3. アプリを起動して受入条件を確かめ、エビデンスを PR の本文に書く。4. Claude のレビューと CI が動き、指摘があれば直して push する。5. 必須のチェックとレビューがそろい、自動でマージされる。">
</p>

- 🤖 **Issue からマージまで:** 受入条件・テスト・実装・動作確認・レビューへの対応を、Claude が進める
- 🔍 **自動の検査:** 作業の終わり・commit 前・push 前に、lint・型・シークレット・脆弱性を検査する
- ☁️ **Web の準備:** Claude Code on the Web の起動時に、依存と Docker を用意する
- 📐 **技術スタックの統一:** bun・Biome・uv・Ruff・ty にそろえる

## 🚀 はじめかた

### 1. プラグインを入れる

<details><summary><b>☁️ Claude Code on the Web</b></summary>

**1. 環境のメニューを開く**

[claude.ai/code](https://claude.ai/code) を開き、入力欄の下の雲のマーク (①) を押してから、「新しい環境」(②) を押します。

<img src="docs/images/cloud-1-open-menu.png" width="356" alt="入力欄の下の雲のマークを①、メニューの「新しい環境」を②として赤枠で示した画面">

**2. 環境の名前を入れる**

「名前」(①) に、好きな名前を入れます。

<img src="docs/images/cloud-2-new-environment.png" width="420" alt="新しい環境の画面。「名前」を①、「ネットワークアクセス」を②、「セットアップスクリプト」を③、「環境を追加」を④として赤枠で示している">

**3. ネットワークアクセスを設定する**

手順 2 の画面の「ネットワークアクセス」(②) を押して、「フル」を選びます。「<」を押して、前の画面に戻ります。

通信先を絞りたいときは、[制限付きにする手順](docs/network.md)を見てください。

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
> - Web 用の処理 (`dockerd`・`mise install`・`lefthook install`・`docker compose up`・Gitleaks などの導入・Claude に渡す指示のうち下書きの 2 つ) は、PC では動きません。
> - 検査には、Semgrep・Gitleaks・Trivy が要ります。Mac では `brew install semgrep gitleaks trivy` で入れられます。
> - git の hook は、PC では自動で入りません。setup を動かしていない clone では、`lefthook install` を行ってください。

</details>

前のプラグイン (cloud・frontend・python・security) を入れている人は、[移り方](docs/migration.md)を見てください。

### 2. PC の Claude Code で `/autopilot:setup` を実行する

プラグインを入れただけでは、リポジトリに検査も autopilot も入りません。setup が、リポジトリを調べて、聞いて、提案し、同意を得てから整えて、PR を作ります。PR をマージすると、続けてルールセットとルーティンを作ります。

クラウドのセッションでは動きません (GitHub の設定を変える API が拒否されるため)。中身は [setup の手順](docs/setup.md)を見てください。

### 3. Issue に `autopilot:ready` を付ける

権限のある人 (triage 以上) が付けると、Claude のルーティンが動き出し、マージまで進みます。進めないときは、`needs-human` を付けて止まります。

## 🙋 人がすること

| こと | いつ |
|---|---|
| CODEOWNERS のパスを変える PR を Approve する | GitHub のレビューの依頼が届いたとき |
| `needs-human` の Issue に答えて、再開する | 止まったとき ([再開のしかた](docs/autopilot.md#止まる条件と再開のしかた)) |
| Slack の通知を見る | GitHub の Slack アプリを購読したチャンネルに届く |
| 起動しなかった Issue・止まった PR に気づく | 自動では拾わない。ラベルを付け直すか、セッションに直接書く |

## ⚠️ 注意

- 受入条件の確かめ (QA) は、ルーティンが PR の本文に書く動作確認だけです。別の Claude は確かめ直しません。
- 必須にできる CI が無いリポジトリでは、Claude のレビューの承認だけで自動マージされます。
- 公開リポジトリでは、だれのコメントも、ルーティンのセッションに入ります。自動化専用の GitHub アカウントを勧めます。
- Terraform の apply がマージで動くリポジトリでは、Approve の後に、取り消せない操作が自動で走ります。
- 検査で見つけられない脆弱性もあります。

## 📚 詳しく

| ドキュメント | 中身 |
|---|---|
| [autopilot](docs/autopilot.md) | 流れ・ラベル・止まる条件と再開・setup の後にすること・デプロイ |
| [setup の手順](docs/setup.md) | `/autopilot:setup` の 8 つの手順と、その順番の理由 |
| [自動で動くもの](docs/automation.md) | 起動時の処理・検査・技術スタックの方針・Claude に渡す指示・一緒に入るプラグイン |
| [ネットワークアクセスを制限付きにする](docs/network.md) | 通信先を絞りたいときの、Web の環境の設定 |
| [前のプラグインから移る](docs/migration.md) | cloud・frontend・python・security からの移り方 |
