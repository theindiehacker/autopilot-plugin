# 既存のシークレット・脆弱性を直す
commit・push の前の検査 (lefthook の Gitleaks・Semgrep・Trivy。「検査を入れる」の手順で入れたもの) が通るよう、リポジトリにすでにあるシークレットと脆弱性を直します。直せない指摘は、ユーザーに確かめて理由付きで除外ファイルに書きます。

対象はリポジトリ全体です。push の前の検査 (Semgrep・Trivy) は、差分ではなくリポジトリ全体を検査します。既存の指摘が 1 つでもあると、関係のない変更でも止まります。commit の前の Gitleaks は、commit に入る差分 (`gitleaks git --staged`) だけを見るため、既存のシークレットは、この手順で全体を検査して見つけます。

## このプラグインの前提
- 検査は行内の除外 (`nosemgrep`・`gitleaks:allow`) を読みません (`--disable-nosem`・`--ignore-gitleaks-allow`)。除外は、下の除外ファイルだけで行います
- この手順の全体の検査では、Gitleaks と Trivy は、git に入るファイル (追跡中と、無視していない新規ファイル) だけを検査します (`in-git-files.sh` を通すため)。除外ファイルも git に入れてください

## 1. 調べる
まず、起動時と同じ処理でツールを揃えます。出た警告 (ツールが無い・起動できない) は、ユーザーに伝えてください。

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/security/setup.sh"
```

続けて、全体を検査します。Gitleaks は、commit 前の検査 (`git --staged`) とは違い、全体を見る `dir` で動かします。Semgrep と Trivy は、push 前の検査と同じコマンドです (push 前の Semgrep は、指摘 (exit 1) 以外の失敗を通します)。

```bash
CLAUDE_PROJECT_DIR="$PWD" bash "${CLAUDE_PLUGIN_ROOT}/scripts/security/in-git-files.sh" gitleaks dir . --redact --verbose --ignore-gitleaks-allow --exit-code 1
```

```bash
semgrep scan --config p/owasp-top-ten --metrics off --severity ERROR --error --disable-nosem
```

```bash
CLAUDE_PROJECT_DIR="$PWD" bash "${CLAUDE_PLUGIN_ROOT}/scripts/security/in-git-files.sh" trivy fs --scanners vuln,misconfig,secret --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 .
```

Semgrep が `semgrep.dev` に、Trivy が DB の取得先に繋げないときは、環境の設定の「許可されたドメイン」に足すよう、ユーザーに頼んでください。足すまでは、その検査を確かめられないと伝えます。

## 2. 聞く
指摘を一覧にし、項目ごとに「直す」か「理由を書いて除外する」かを、ユーザーに聞いてください。一覧には、ファイル・行・ルール (CVE) と、どちらを勧めるかとその理由を書きます。

- 本物のシークレット・使われている脆弱なコードは、直すことを勧める
- 除外を勧めてよいのは、誤検出・テスト用のダミーの値・上げると壊れる依存 (メジャー版の移行が要るなど) だけ。直す版の無い依存は、検査が `--ignore-unfixed` で出さないため、一覧に出ません

## 3. 直す
聞いた順に、1 項目ずつ行ってください。

### シークレット
- コードから消し、環境変数などから読むようにする。`.env.example` があれば、値を空にしたキーを足す
- git の履歴には残るため、そのシークレットを無効にして作り直す (ローテーション) よう、ユーザーに頼む。履歴の書き換えは、頼まれたときだけ行う

### Semgrep
指摘されたコードを、ルールの説明に沿って直してください (`shell=True` をやめて引数の配列で渡す、SQL をパラメータで渡す、など)。

### Trivy
- 依存の脆弱性: 指摘の `Fixed Version` 以上に上げ、lock ファイルを作り直す (`bun update <名前>`・`uv lock --upgrade-package <名前>` など)。build とテストが通ることを確かめる
- 設定の不備 (Dockerfile・IaC など): 指摘に沿って直す

## 4. 除外する
ユーザーが除外を選んだ項目だけを、次のファイルに書いてください。どれも、1 件ごとに理由をコメント (Trivy は `statement`) で書きます。

### Gitleaks → `.gitleaksignore`
指摘の `Fingerprint` (`パス:ルール:行`) を 1 行ずつ書きます。行がずれると効かなくなるため、そのファイルを直したら、検査をやり直してください。

```
# テスト用のダミーの鍵。本物ではない
tests/fixtures/config.py:aws-access-token:3
```

### Semgrep → `.semgrepignore`
パス単位でしか除外できません。範囲を、指摘のあるファイルだけに絞ってください。

`.semgrepignore` を作ると、Semgrep の既定の除外 (`tests/` など) が効かなくなり、新しい指摘が出ます。作るときは、先頭に既定の除外を書いてください。

```
# Semgrep の既定の除外
node_modules/
build/
dist/
vendor/
.env/
.venv/
.tox/
*.min.js
.npm/
.yarn/
test/
tests/
*_test.go
.semgrep
.semgrep_logs/

# 管理者だけが動かす内部の CLI。入力は固定値
scripts/admin.py
```

### Trivy → `.trivyignore.yaml` と `trivy.yaml`
リポジトリに、すでに Trivy を動かすタスク (`task security:check` など) と除外ファイルがあれば、それを優先します。ここの `trivy.yaml` や、上のコマンドの条件を重ねて足さず、そのタスクのコマンドと除外ファイルの方式に合わせてください (例: `--ignorefile .trivyignore.yaml` を渡している)。

Trivy は `.trivyignore.yaml` を自動では読まないため、リポジトリのルートの `trivy.yaml` で読ませます。`.trivyignore` (テキスト) はパスで絞れず、シークレットのルールをリポジトリ全体で消してしまうため使いません。

```yaml
# trivy.yaml
ignorefile: .trivyignore.yaml
```

```yaml
# .trivyignore.yaml
vulnerabilities:
  - id: CVE-2023-30861
    statement: セッションを使っていないため影響しない。flask 3 への移行は別の PR で行う
    expired_at: 2027-03-01
secrets:
  - id: aws-access-key-id
    paths: ["tests/fixtures/config.py"]
    statement: テスト用のダミーの鍵。本物ではない
```

依存の脆弱性には `expired_at` で期限を付けてください (期限の後は、また検出されます)。期限はユーザーに聞きます。

## 5. 確かめる
1 の 3 つの検査を、もう一度動かしてください。すべてが exit 0 なら完了です。動かせなかった検査があれば、理由と一緒に伝えてください。
