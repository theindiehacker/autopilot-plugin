# 🔌 dev-plugins

## 🚀 セットアップ

<details><summary><b><code>.claude/settings.json</code></b></summary>

```json
{
  "permissions": {
    "allow": [
      "mcp__claude-code-remote__*"
    ]
  }
}
```

</details>

<details><summary><b>クラウド環境のセットアップスクリプト</b></summary>

Claude Code on the web は、`.claude/settings.json` の `enabledPlugins` ではプラグインを入れません。クラウド環境ごとに、環境の設定の **セットアップスクリプト** に次を追加してください。

```bash
{
  claude plugin marketplace add anthropics/claude-plugins-official &&
  claude plugin marketplace add theindiehacker/dev-plugins &&
  claude plugin install session@indiehacker
} || echo "⚠️ indiehacker プラグインを入れられませんでした" >&2
```

セットアップスクリプトが 0 以外で終わるとセッションを始められないことがあるため、失敗しても警告だけを出します。

</details>

<details><summary><b>クラウド環境のネットワーク (<code>semgrep.dev</code> を許可する)</b></summary>

semgrep は検査のルールを `semgrep.dev` から取得します。既定のネットワーク (Limited) では `semgrep.dev` に届かないため、クラウド環境ごとに次の手順で許可してください。

1. セッションのタイトルバーにあるクラウド環境のメニューを開き、使う環境の **Edit** を押す
2. **Network access** を **Limited** のままにする
3. **Allowed domains** に `semgrep.dev` を足す
4. **Allow package managers** のチェックは付けたままにする (semgrep を PyPI から入れるのに使う)
5. 保存する

手順の詳細は [Claude Code のドキュメント](https://code.claude.com/docs/en/cloud-environments#network-access) にあります。

許可しないと、semgrep の検査は動きません。push は止めませんが、push のたびに semgrep の接続の失敗を約 100 秒待ちます。gitleaks・trivy は既定のネットワークで動きます。

</details>

<details><summary><b><code>mise.toml</code> (任意)</b></summary>

Claude Code on the web では、`mise.toml` があるリポジトリに限り、セッションの開始時に `mise install` も実行します。ツールは `mise.lock` の URL から入れるため、次の設定を足し、`mise install` の後に `mise lock` を実行して `mise.lock` もコミットしてください。

```toml
[settings]
experimental = true
# mise.lock に版とダウンロードの URL を残す。Claude Code on the web は lock の URL からツールを入れる
lockfile = true
```

</details>

<details><summary><b><code>Dockerfile</code></b></summary>

Claude Code on the web のプロキシは TLS を検査します。`session` はリポジトリ直下の compose ファイルのサービスを起動するときに、プロキシの CA を build の secret `ca-certificates` で渡します。イメージのビルドで uv を使うなら、Dockerfile でこの secret を受け取ってください。この設定がないと、ビルドが失敗します。

```dockerfile
# uv の通信を、uv 同梱の CA ではなくこのファイルで検証する。
# TLS を検査するプロキシ (Claude Code on the web) の内側では、session プラグインが secret の ca-certificates でプロキシの CA に差し替える。
# secret はその RUN の間だけマウントされ、イメージには残らない。渡さなければ (ローカル・CI) ベースイメージの CA のまま
ENV SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt

RUN --mount=type=secret,id=ca-certificates,target=/etc/ssl/certs/ca-certificates.crt uv sync
```

 - Claude Code on the web では、`docker compose` をリポジトリのルートで実行してください。サブディレクトリから実行すると、ビルドが CA の読み込みの許可待ちで止まります
 - uv 以外のツールは、CA の指定方法がツールごとに異なる場合があります

</details>
