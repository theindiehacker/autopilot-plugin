# autopilot を入れる
Issue から本番までの自動の流れを、リポジトリに入れます。survey.md の結果と interview.md の答えを使います。次の 10 の手順を、この順に行います。

## 1. ラベルを 2 つ作る
```bash
gh label create autopilot:ready --force --color 0E8A16 --description "開発を始めてよい"
gh label create needs-human --force --color D93F0B --description "止まった。人の判断が要る"
```
`.github/ISSUE_TEMPLATE/` のテンプレートの `labels:` に `autopilot:ready` があれば、消すようユーザーに提案します。`autopilot:ready` は、権限のある人が付けるものだからです。

## 2. `.github/autopilot.yml` を書く
[templates/autopilot.yml](templates/autopilot.yml) から、聞いた答えで書きます。`routine_github_user`・`qa.start`・`qa.url` を必ず入れます。当てはまらない項目 (取り消せない変更が無ければ `irreversible` と `approvers` など) は、行ごと消します。`required_checks` には、`autopilot QA`・`autopilot/irreversible` を残します。

## 3. ワークフローを 2 つ書く
| 書くファイル | ひな形 |
|---|---|
| `.github/workflows/autopilot.yml` | [templates/autopilot-workflow.yml](templates/autopilot-workflow.yml) |
| `.github/workflows/autopilot-qa.yml` | [templates/autopilot-qa-workflow.yml](templates/autopilot-qa-workflow.yml) |

QA を別のファイルにするのは、別のイベントで起きた実行で QA のジョブが飛ばされ、必須のチェックを通してしまうのを防ぐためです。

| 置き換える文字列 | 値 |
|---|---|
| `{{AUTOPILOT_REF}}` | `v<.claude-plugin/plugin.json の version>` |
| `{{CI_WORKFLOWS}}` | CI のワークフロー名と `autopilot-qa` の YAML の配列。例: `["ci", "autopilot-qa"]`。Terraform の plan のワークフローがあれば、その名前も足す |
| `{{TERRAFORM_PLAN_WORKFLOW}}` | Terraform の plan のワークフロー名。無ければ `(none)` |
| `{{QA_START}}` | `qa.start` と同じコマンド |
| `{{REVIEWER_BOTS}}` | Claude のレビューの bot。既定は `claude` |

- Terraform の plan が無いリポジトリでは、`# TERRAFORM_PLAN:BEGIN` から `# TERRAFORM_PLAN:END` までの行を消します
- `autopilot QA` は、必ず必須のチェックにします。自動マージが QA の成功を待つためです
- 書いたら `actionlint` で確かめます

## 4. Claude のレビューと CI
- Claude のレビューが無ければ、[templates/claude-code-review-workflow.yml](templates/claude-code-review-workflow.yml) を `.github/workflows/claude-code-review.yml` に置きます。`review.trigger` が `ready_for_review` ならこのままで、`comment` ならコメントで起動します
- CI が無ければ、そのリポジトリのテストを動かす CI を作ります (survey.md で見たタスクランナーのコマンドを呼びます)。`pull_request` で、`paths:` を付けずに動かします

## 5. ロールバック (デプロイがあり、ロールバックが無いとき)
ユーザーに提案し、選ばれたときだけ用意します。

1. デプロイのワークフローから、デプロイ先 (Cloud Run・ECS・Vercel など) を見分け、案を見せる
2. 選ばれたら `.github/workflows/rollback.yml` を書き、`deploy.rollback` に `rollback.yml` を登録する

| デプロイ先 | 書き方 |
|---|---|
| Cloud Run | [templates/rollback-cloud-run.yml](templates/rollback-cloud-run.yml)。`{{SERVICE}}`・`{{REGION}}`・認証 (`{{WORKLOAD_IDENTITY_PROVIDER}}`・`{{SERVICE_ACCOUNT}}`) は、デプロイのワークフローの値に合わせる。トラフィックを 1 つ前のリビジョンに戻す |
| そのほか | そのリポジトリのデプロイのワークフローに合わせて書く。`workflow_dispatch` で動き、前の版に戻す |

ワークフローの変更なので、この PR で人が承認します。actions は、SHA で固定し、`# vX.Y.Z` を付けます。

## 6. Terraform の plan の JSON を残す
Terraform の apply がマージで動くときだけ行います。plan のワークフローに、plan の JSON を artifact で残す step を足し、その名前を `irreversible.terraform_plan_artifact` に書きます。artifact には、JSON のファイル 1 つだけを入れます。

```yaml
      - run: terraform show -json tfplan > plan.json
      - uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2
        with:
          name: terraform-plan
          path: plan.json
```

`tfplan` は、そのワークフローの `terraform plan -out` のファイル名に合わせます。

## 7. ユーザーに頼むこと
画面でしかできないことを、手順を示して頼みます。1 つ終えるごとに、できたかを聞きます。

| 頼むこと | 手順 |
|---|---|
| GitHub App を作る | [templates/github-app-manifest.json](templates/github-app-manifest.json) の権限で作る (下の表)。webhook は無効 |
| GitHub App を入れる | **autopilot を使うリポジトリにだけ**入れる |
| Slack の Incoming Webhook | Slack の画面で作り、通知先のチャンネルを選ぶ |
| シークレットを登録 | 下の表 |
| Web の環境を作る | README の手順 |

GitHub App を、autopilot を使うリポジトリにだけ入れるのは、QA と対応のジョブが PR のコードを動かすためです。ほかのリポジトリに入れると、App の権限が、そのリポジトリにも及びます。

| App の権限 | 値 | 使うところ |
|---|---|---|
| Contents・Pull requests・Issues・Commit statuses・Actions | Read and write | ラベル・コメント・ステータス・自動マージ・push・ワークフローの起動 |
| Checks | Read | 必須のチェックの結果 |
| Metadata | Read | 常に付く |
| Organization の Members | Read | 承認する人の team を読む (`irreversible`) |

作成の画面は、個人のアカウントなら `https://github.com/settings/apps/new`、org なら `https://github.com/organizations/<org>/settings/apps/new` です。manifest の権限を、画面で同じにしてもらいます。

| シークレット | 内容 |
|---|---|
| `AUTOPILOT_APP_ID` | App の ID |
| `AUTOPILOT_APP_PRIVATE_KEY` | App の秘密鍵 (`.pem` の中身) |
| `AUTOPILOT_SLACK_WEBHOOK_URL` | Slack の Incoming Webhook の URL |
| `CLAUDE_CODE_OAUTH_TOKEN` か `ANTHROPIC_API_KEY` | claude-code-action の認証 (どちらか) |

登録は `gh secret set <名前>` (org で共有するなら `--org <org> --repos <リポジトリ>`) です。環境変数とシークレットは、使う操作に要る最小の権限にしてもらいます。値は、会話や commit に書きません。

## 8. ルールセットを作る
1. 必須にするチェックが、PR ごとに必ず結果を出すかを確かめます。ワークフローの `paths:` で飛ぶものは、必須にしないか、いつも動くジョブにまとめることをユーザーに提案します
2. 今あるルールセットを `gh api repos/{o}/{r}/rulesets` で見ます。あれば、新しく作らず、足りないものだけを足す案を見せます
3. 作ります。`<デフォルトブランチ>`・チェック名は、survey.md と `.github/autopilot.yml` の値にします。

```bash
gh api -X POST repos/{o}/{r}/rulesets --input - <<'JSON'
{
  "name": "autopilot",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "rules": [
    { "type": "pull_request", "parameters": {
        "required_approving_review_count": 1,
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false } },
    { "type": "required_status_checks", "parameters": {
        "strict_required_status_checks_policy": false,
        "required_status_checks": [
          { "context": "<CI のジョブ名>" },
          { "context": "autopilot QA" },
          { "context": "autopilot/irreversible" }
        ] } }
  ]
}
JSON
gh api -X PATCH repos/{o}/{r} -F allow_auto_merge=true
```

org のルールセットは変えません。変える必要があれば、ユーザーに伝えます。

## 9. ルーティンを作る
ルーティンは、いまログインしている claude.ai アカウントのものになります。作る前に、interview.md で選んだアカウント (自動化専用か個人) でログインしているかを、ユーザーに確かめます。違えば、ここで止まってログインし直してもらいます。

RemoteTrigger で、次の 2 つを順に呼びます。

1. `create`: スケジュールなし、`clear_mcp_connections: true`。プロンプトは `/autopilot:develop` を実行すること。環境は、README の手順で作った Web の環境
2. `create_webhook_trigger`: 1 で返った ID を使う

```json
{
  "routine_trigger_id": "<1 の ID>",
  "source": "github",
  "hook_type": "app",
  "scope_id": "<owner>/<repo>",
  "events": ["issues.labeled"]
}
```

絞り込み (ラベル名など) は効かないので付けません。ルーティンが最初にラベルを確かめます。

作れなかったとき (ログインが違う・RemoteTrigger が使えない) は、claude.ai/code の画面で作る手順を示して、ユーザーに頼みます。

## 10. PR にまとめる
SKILL.md の「PR を作る」の節のとおりに、ここまでの変更を 1 つの PR にまとめます。本文には、次も書きます。

- 入れたワークフローと、`.github/autopilot.yml` の内容
- ユーザーがすること (まだ終えていないシークレット・App・Webhook・Web の環境)
- ルールセットの作成と、自動マージの有効化
