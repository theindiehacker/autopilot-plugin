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

<details><summary><b>☁️ クラウド環境を編集</b></summary>

**ネットワークアクセス**: 「制限付き」
```
semgrep.dev
pkg-containers.githubusercontent.com
dl.google.com
dl-cdn.alpinelinux.org
ui.shadcn.com
```
✅ [パッケージマネージャー](https://code.claude.com/docs/en/cloud-environments#default-allowed-domains)を許可

**セットアップスクリプト**:
```bash
claude plugin marketplace add anthropics/claude-plugins-official
claude plugin marketplace add theindiehacker/dev-plugins
claude plugin install cloud@indiehacker
claude plugin install security@indiehacker
claude plugin install frontend@indiehacker
claude plugin install python@indiehacker

# 2026-11-08
```

> [!WARNING]
> プラグインを更新したら、「セットアップスクリプト」の最後の行の日付を、更新した日に書き換えてください。書き換えないと、古いプラグインのまま動くことがあります。

</details>
