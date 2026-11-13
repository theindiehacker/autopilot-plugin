# autopilot を入れる
Issue からマージまでの自動の流れを、リポジトリに入れます。survey.md の結果と interview.md の答えを使います。次の 8 つの手順を、この順に行います。前の形の autopilot が入っているリポジトリでは、最後の「入れ済みのリポジトリを新しい形に移す」に従います。

autopilot のための GitHub Actions のワークフローは置きません。受入条件の確かめ (QA) は、開発のルーティンが「レビュー可能」にする前に行う動作確認 (`skills/qa/self-check.md`) だけです。別の Claude が確かめ直すことはありません。GitHub Actions で動くのは、リポジトリの CI と Claude のレビューだけです。

## 1. ラベルを 2 つ作る
手順 1 は、PR を作る前に、リモートのリポジトリを変えます (ラベルは、PR をマージしなくても残ります)。SKILL.md の「同意するまでリポジトリは変えない」の例外なので、提案 (interview.md) の一覧に入れ、同意の後に行います。

```bash
gh label create autopilot:ready --force --color 0E8A16 --description "開発を始めてよい"
gh label create needs-human --force --color D93F0B --description "止まった。人の判断が要る"
```
`.github/ISSUE_TEMPLATE/` のテンプレートの `labels:` に `autopilot:ready` があれば、消すようユーザーに提案します。`autopilot:ready` は、権限のある人が付けるものだからです。

## 2. `.github/autopilot.yml` を書く
[templates/autopilot.yml](templates/autopilot.yml) から、聞いた答えで書きます。`qa.start`・`qa.url` を必ず入れます。置き換える文字列は、次の答えから取ります。

| 文字列 | 取る先 |
|---|---|
| `{{QA_START}}`・`{{QA_URL}}` | interview の「アプリの起動」 |
| `{{REVIEWER}}` | interview の「Claude のレビュー」の bot。Claude なら `claude[bot]` |
| `{{CI_CHECK}}` | interview の「必須にするチェック」(survey の CI のジョブ名)。1 つずつ行を足す。0 件なら、`required_checks` ごと消す (下の「CI の必須のチェック」) |

当てはまらない項目は、行ごと消します。`required_checks` は、手順 7 のルールセットに入れるチェックの記録です。autopilot のコードは読みません。

### `qa.start`
`qa.start` は、`dev:up` のコマンド (checks.md で作る。例: `task dev:up`) にします。人と、開発のルーティンの動作確認が、同じ方法でアプリを起動するためです。`dev:up` の中身 (後ろで起動して、準備ができるまで待つ・MCP サーバーの応答を確かめる) は、checks.md の「`dev:up`」にあります。

- ツール (bun・uv・task など) は、Web の環境の起動時の処理が入れます (`mise.toml` があれば `mise install`)。`qa.start` で `npm install -g bun` のように入れ直さない

### CI の必須のチェック
CI のジョブがすべて `paths:` で飛ぶか、Draft の PR を飛ばすときは、毎回は結果を報告しないため、そのまま必須にできません (必須にすると、報告されない PR が永遠に待ちになる)。次のようにします。

1. 常に動く集約のジョブを足すことを、ユーザーに提案する。1 つでも失敗か取り消しなら失敗にし、`paths:` などで飛んだジョブ (skipped) は、失敗に数えない。この集約のジョブ名を、`{{CI_CHECK}}` に入れる。足し方は、CI の形で決まる
   - (A) CI が 1 つのワークフローで、ジョブごとに `if:` で絞っているとき: そのワークフローに集約のジョブを足す。`needs:` に絞り込みのあるジョブを並べ、`if: always()` で必ず動かす

```yaml
  ci-ok:
    name: ci-ok
    if: always()
    needs: [lint, test]
    runs-on: ubuntu-latest
    steps:
      - run: |
          if [ "${{ contains(needs.*.result, 'failure') || contains(needs.*.result, 'cancelled') }}" = "true" ]; then
            echo "::error::CI のジョブが失敗しました"; exit 1
          fi
```

   Draft の PR を飛ばすジョブは、集約のジョブには `if: always()` だけを付け (Draft を飛ばさない)、結果を必ず出します。

   - (B) CI がいくつかのワークフローに分かれ、`on.pull_request.paths:` で絞っているとき (1 つのワークフロー全体を `paths:` で絞っているときも同じ): `needs:` は、ほかのワークフローのジョブを指せません。ワークフロー全体が `paths:` で絞られていると、集約のジョブも動きません。そこで、次の `ci.yml` を新しく足し、PR のたびに必ず動かします。第三者の Action は要りません
     - `changes` のジョブが、PR の変更されたファイルを API で読み、呼ぶワークフローごとに `true` か `false` を出す。checkout はしません (PR のコードを動かさないため)
     - 正規表現は、そのワークフローがもともと `paths:` に持っていたものに、`ci.yml` 自身を足したもの。名前を変えたファイルは、`previous_filename` も入れる
     - 変更が 3000 ファイル以上のときは、一覧が欠けるので、すべて `true` にする (API の上限)
     - ワークフローごとに、`uses: ./.github/workflows/<ファイル>.yml` で呼ぶジョブを置く。`if:` で `changes` の出力を見る
     - 呼ぶジョブの `permissions:` は、呼ばれるワークフローのどのジョブの権限も含めます。足りないと、起動の時点で失敗します
     - `secrets: inherit` は付けず、呼ばれる側が使うものだけを渡す
     - 呼ばれる側は、`pull_request:` (`types`・`paths`) を `workflow_call:` に替える。`push:` は残す。`github.event.pull_request.draft` や `github.event_name` を読む `if:` は、呼ぶ側のイベントを見るので、そのまま使えます
     - `ci-ok` は、`needs:` に `changes` と呼ぶジョブをすべて並べ、`if: always()` で必ず動かす。`failure` と `cancelled` を失敗にし、`skipped` は失敗にしない。結果は `env:` で渡し、失敗したジョブ名を出す

```yaml
name: CI

on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]

permissions: {}

concurrency:
  group: ci-${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  changes:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    permissions:
      pull-requests: read
    outputs:
      lint: ${{ steps.filter.outputs.lint }}
      test: ${{ steps.filter.outputs.test }}
    steps:
      - id: filter
        env:
          GH_TOKEN: ${{ github.token }}
          PR: ${{ github.event.pull_request.number }}
        run: |
          files=$(gh api "repos/$GITHUB_REPOSITORY/pulls/$PR/files?per_page=100" --paginate --jq '.[] | .filename, (.previous_filename // empty)')
          # files API は 3000 ファイルまで。それ以上は、一覧が欠けるので、すべて動かす
          count=$(gh api "repos/$GITHUB_REPOSITORY/pulls/$PR" --jq '.changed_files')
          all=false
          if [ "$count" -ge 3000 ]; then all=true; fi
          # <出力の名前> <正規表現>: 変更されたファイルのどれかが合えば true
          # パイプ (printf | grep -q) にしない。grep が先に終わると printf が SIGPIPE で落ち、pipefail で「合わない」になる
          filter() {
            if [ "$all" = true ] || grep -Eq "$2" <<<"$files"; then
              echo "$1=true" >> "$GITHUB_OUTPUT"
            else
              echo "$1=false" >> "$GITHUB_OUTPUT"
            fi
          }
          filter lint '^src/|^\.github/workflows/lint\.yml$|^\.github/workflows/ci\.yml$'
          filter test '^src/|^tests/|^\.github/workflows/test\.yml$|^\.github/workflows/ci\.yml$'

  lint:
    needs: changes
    if: ${{ needs.changes.outputs.lint == 'true' }}
    permissions:
      contents: read
    uses: ./.github/workflows/lint.yml

  test:
    needs: changes
    if: ${{ needs.changes.outputs.test == 'true' }}
    permissions:
      contents: read
    uses: ./.github/workflows/test.yml

  ci-ok:
    name: ci-ok
    if: always()
    needs: [changes, lint, test]
    runs-on: ubuntu-latest
    timeout-minutes: 5
    permissions: {}
    steps:
      - env:
          NEEDS: ${{ toJSON(needs) }}
        run: |
          failed=$(printf '%s' "$NEEDS" | jq -r 'to_entries[] | select(.value.result == "failure" or .value.result == "cancelled") | "\(.key): \(.value.result)"')
          if [ -n "$failed" ]; then
            echo "::error::CI のジョブが失敗か取り消しになりました"
            echo "$failed"
            exit 1
          fi
```

     - クラウドに OIDC (Google の WIF・AWS など) で認証し、信頼の条件が、ワークフローのファイル (`workflow_ref`・`job_workflow_ref`) を見ているものは、`ci.yml` から呼ぶと認証に失敗します。`workflow_ref` が、呼ぶ側の `ci.yml` になるためです。そのワークフローは、これまでどおり単独にして (自分の `pull_request` と `paths:`)、`ci-ok` に入れません。必須にはできないことを、ユーザーに伝えます。必須にしたければ、クラウドの信頼の条件を広げることを、管理者に頼みます
     - これまで `ready_for_review` で飛ばしていたジョブも、Ready にしたときに動くようになります。`ready_for_review` で飛ばさないでください。Draft の run が Ready の run に取り消されると、その SHA では終わらず、`ci-ok` がテストなしで通るためです
     - zizmor が、`uses: ./.github/workflows/...` に、重大度の低い `self-repository` を出すことがあります。actionlint は zizmor が勧める `$/` の形を受け付けないので、`./` のままにします
2. ユーザーが集約のジョブを足さないと答えたら、CI のチェックは必須にしません。このとき、`.github/autopilot.yml` の `required_checks` から `- "{{CI_CHECK}}"` の行を**消し** (空の文字列や、プレースホルダーのまま残さない)、ほかに必須にするチェックが無ければ、`required_checks` ごと消します。手順 7 のルールセットでも、CI のチェックの行を入れません。必須のチェックが 1 つも無ければ、`required_status_checks` のルールごと入れません。CI の失敗は、開発のルーティンが購読で拾います。ただし、必須のチェックが無いと、CI の結果では自動マージが止まらず、レビューの承認だけでマージされます。そのことを PR の本文に書きます

## 3. Claude のレビューと CI
- Claude のレビューが無ければ、[templates/claude-code-review-workflow.yml](templates/claude-code-review-workflow.yml) を `.github/workflows/claude-code-review.yml` に置きます。`review.trigger` が `ready_for_review` ならこのままで、`comment` ならコメントで起動します (合図は `review.command` に合わせる)。`review.reviewer` は、判定を出す bot です (Claude なら `claude[bot]`)。置いたときは、手順 5 の「5-A」で、認証のシークレットを頼みます
- CI が無ければ、そのリポジトリのテストを動かす CI を作ります (survey.md で見たタスクランナーのコマンドを呼びます)。`pull_request` で、`paths:` を付けずに動かします
- 書いたワークフローは、`actionlint` で確かめます。リポジトリの CI がワークフローを ghalint・zizmor などで検査していれば、同じ版を手元で動かして通します (版は survey.md で見た CI から取る)

## 4. CODEOWNERS を書く
[templates/CODEOWNERS](templates/CODEOWNERS) から、interview の「人の承認が要るパスと、その持ち主」で `.github/CODEOWNERS` を書きます。手順 7 のルールセットの「コードオーナーのレビューを必須」と合わせて、ここに書いたパスを変える PR は、持ち主が Approve するまでマージされません。

| 文字列 | 値 |
|---|---|
| `{{MIGRATION_PATH}}` | マイグレーションのフォルダ。例: `/backend/migration/versions/` |
| `{{TERRAFORM_PATH}}` | Terraform のフォルダ。例: `/infrastructure/` |
| `{{TASK_FILE}}` | checks.md で `style:check`・`security:check`・`dev:up` を書いたタスクランナーのファイル。例: `/Taskfile.yml`・`/Makefile`。タスクをルートの `package.json` の `scripts` に書いたときは `/package.json` |
| `{{OWNER}}` | 持ち主。GitHub のユーザー名 (`@user`) か team (`@org/team`)。複数なら空白で区切る |

- 初めの値は、autopilot を動かすファイル (`.github/`・`.claude/`・`.mcp.json`・git の hook の設定)、検査を定めるファイル (タスクランナーのファイルと、セキュリティの検査の設定・除外のファイル)、マイグレーション・Terraform です。autopilot を動かすファイルと検査を定めるファイルを入れるのは、AI の PR が、人の承認なしに、自分の検査・ワークフロー・設定を変えられないようにするためです (`.github/` に、この CODEOWNERS 自身も入る)
- 検査を定めるファイルは、CI・lefthook・Claude の Stop の hook・動作確認が呼ぶ `style:check`・`security:check`・`dev:up` を書いたタスクランナーのファイル (`{{TASK_FILE}}`) と、Gitleaks・Semgrep・Trivy が読む設定・除外のファイル (`.gitleaks.toml`・`.gitleaksignore`・`.semgrepignore`・`trivy.yaml`・`.trivyignore`・`.trivyignore.yaml`) です。タスクを書いたファイルが複数あれば (Taskfile の `includes:` など)、1 つずつ行を足します
- 設定・除外のファイルの行は、リポジトリに無くても残します。AI の PR が、そのファイルを新しく作って、検査を弱めないようにするためです
- タスクをルートの `package.json` の `scripts` に書いたときは、`package.json` が持ち主のパスになります。依存を足すだけの PR にも、持ち主の Approve が要るようになることを、ユーザーに伝えます
- git の hook の設定 (`lefthook.yml`・`.lefthook.yml`・`lefthook.yaml`・`.pre-commit-config.yaml`・`.husky/`) は、リポジトリに無いものの行を消します。分からなければ、すべて残します
- マイグレーションや Terraform が無ければ、その行を消します。interview でほかのパスが挙がれば、行を足します
- 持ち主には、リポジトリへの書き込みの権限が要ります (GitHub の決まり)
- 持ち主への承認の依頼は、Slack ではなく GitHub のレビューの依頼で届きます (GitHub の Slack 連携を入れれば、Slack にも出せます)

## 5. ユーザーに頼むことの一覧
画面でしかできないことは、手順を示して、1 つの一覧にして頼みます。1 つずつ聞いて待ちません。
一覧は、手順 6 で PR を作るときに、PR の本文と、ユーザーへの返事の両方に出します。
ユーザーは、マージを待つ間に、好きな順で済ませます。済ませたら、まとめて知らせてもらいます。

| 頼むこと | 手順 |
|---|---|
| Claude の GitHub App を入れる | https://github.com/apps/claude を、このリポジトリに入れる。Claude のレビュー (claude[bot]) が、PR にレビューを書くために要る。既存の Claude のレビューのワークフローを使うときも、入っているかを確かめてもらう (リポジトリの設定の「GitHub Apps」) |
| Claude のレビューの認証 | 手順 3 で Claude のレビューのワークフローを置いたときだけ。下の「5-A」 |
| GitHub の Slack アプリの購読 | Slack に GitHub のアプリを入れ、通知先のチャンネルで購読する (下の「5-B」) |
| Web の環境を作る | README の手順。手順 8 のルーティンが使う |

### 5-A. Claude のレビューの認証
手順 3 で置いた `.github/workflows/claude-code-review.yml` は、シークレット `CLAUDE_CODE_OAUTH_TOKEN` か `ANTHROPIC_API_KEY` (どちらか) を使います。interview の「Claude のレビューの認証」で選んだほうを、登録してもらいます。既存の Claude のレビューのワークフローを使うときは、頼みません。

1. リポジトリの持ち主が org なら、まず org にもうあるかを見ます: `gh api orgs/<org>/actions/secrets --jq '.secrets[] | {name, visibility}'` (org の owner の権限が要る)
   - `visibility` が `selected` なら、値を変えずに、このリポジトリを足します: `gh api -X PUT orgs/<org>/actions/secrets/<名前>/repositories/<リポジトリの id>` (id は `gh api repos/{owner}/{repo} --jq .id`)
   - `all`・`private` なら、もう使えます。何もしません
   - 読めない (403) ときは、org の owner に確かめてもらいます
2. 無ければ、ユーザーに自分のターミナルで `gh secret set <名前>` を動かしてもらいます (値は、聞かれたときに貼り付ける)。org で共有するなら、`--org <org> --visibility selected --repos <リポジトリ>` を付けます

値は、会話や commit に書きません。シークレットは、使う操作に要る最小の権限にしてもらいます。

### 5-B. 通知を、GitHub の Slack アプリの購読にする
Slack への通知は、GitHub の Slack アプリの購読で届けます (Webhook も、Slack の App を作ることも要りません)。次を頼みます。

1. Slack のワークスペースに GitHub のアプリを入れてもらいます (もう入っていれば、入れ直しません)
2. Slack で `/github signin` を打ち、GitHub のアカウントとつないでもらいます
3. GitHub の側に、Slack のアプリ (https://github.com/apps/slack) を入れてもらいます。組織のリポジトリなら、「Install on another account」から組織を選びます。入れるリポジトリに、このリポジトリを選びます (もう入っていれば、このリポジトリを足します)。入れていないと、購読のコマンドに「`I couldn't find <owner>/<repo>`」と返ります
4. 通知先のチャンネル (interview の「Slack の通知先」) で、次を打ってもらいます
5. デプロイがあれば、デプロイのワークフローの失敗を知らせる購読も案内します (名前は、survey.md で見たデプロイのワークフローの `name:`)

```text
/github subscribe <owner>/<repo> issues pulls comments +label:"needs-human"
/github subscribe <owner>/<repo> workflows:{name:"<デプロイのワークフローの名前>"}
```

コマンドの細かな形は、Slack で `/github help` を見て合わせてもらいます。ラベルで絞る 1 つ目の購読で、止まった知らせと質問のコメントが届くことは、確かめ済みです。

## 6. PR にまとめて、マージしてもらう
SKILL.md の「PR を作る」の節のとおりに、ここまでの変更を 1 つの PR にまとめます。本文には、次も書きます。

- 入れたもの (`.github/autopilot.yml` の内容・CODEOWNERS・手順 2 と 3 で置いたワークフロー)
- 必須のチェックが無いときは、そのこと (CI の結果では自動マージが止まらず、レビューの承認だけでマージされる。手順 2 の「CI の必須のチェック」)
- ユーザーがすること (手順 5 の一覧のうち、まだ終えていないもの)
- マージした後に、setup がルールセット・ワークフローの既定の権限・ルーティンを作ること

PR を作ったら、手順 5 の一覧をユーザーに出し、マージを頼みます。そして、マージされるのを待ちます。
ルールセット・ワークフローの既定の権限・ルーティンは、**マージの後**に、setup が行います。ルールセットを先に作ると、この PR も必須のレビューを待つことになります。ルーティンは、デフォルトブランチの `.github/autopilot.yml` (`qa.start` など) を読みます。

マージされたことは、次のどちらかで確かめます。
- ユーザーが「マージした」と答える
- `gh pr view <n> --json state --jq .state` が `MERGED` を返す

マージされたら、`git fetch` でデフォルトブランチを更新します。続けて、手順 7 (ルールセットとワークフローの既定の権限)・手順 8 (ルーティン) を、setup 自身が `gh` と RemoteTrigger で行います。ユーザーには、画面の操作を頼みません。失敗したとき (権限が足りない・RemoteTrigger が使えない) だけ、その手順の末尾のとおり、画面の手順を示して頼みます。

## 7. ルールセットを作る (マージの後)
1. 必須にするチェックが、PR ごとに必ず結果を出すかを確かめます。
   - CI のジョブは、`paths:` で飛ぶものを必須にしません。飛ぶものは、必須にしないか、いつも動くジョブにまとめます (手順 2 の「CI の必須のチェック」)
   - 必須にできる CI のジョブが無ければ、必須のチェックは入れません。下の JSON から `required_status_checks` のルールを消します (PR の本文には、手順 2 の「CI の必須のチェック」の 2 で書いてあります)
2. 今あるルールセットを見ます。リポジトリのものは `gh api repos/{o}/{r}/rulesets`、組織のものは `gh api orgs/{org}/rulesets` (権限が無ければ、`gh api repos/{o}/{r}/rules/branches/<デフォルトブランチ>` が、組織のものを含めた、いま効いているルールを返す) で読みます。デフォルトブランチに効いているルール (必須のレビューの人数・コードオーナーのレビュー・必須のチェック・マージ方法) を一覧にし、すでに満たしているものは、新しいルールセットに書きません (例: 組織が承認 1 人とコードオーナーのレビューを要求していれば、`pull_request` のルールは足さない。足りなければ、足りないものだけを足す)。あれば、新しく作らず、足りないものだけを足す案を見せます。組織のルールセットは変えません
3. 作ります。チェック名は、survey.md と `.github/autopilot.yml` の `required_checks` の値にします。`integration_id` で、チェックを出す側を固定します。同じ名前のチェックを、ほかのアプリや PR のコードが出しても、数えません。

| チェック | `integration_id` |
|---|---|
| CI のジョブ | GitHub Actions の `15368` |

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
        "require_code_owner_review": true,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false } },
    { "type": "required_status_checks", "parameters": {
        "strict_required_status_checks_policy": false,
        "required_status_checks": [
          { "context": "<CI のジョブ名>", "integration_id": 15368 }
        ] } }
  ]
}
JSON
gh api -X PATCH repos/{o}/{r} -F allow_auto_merge=true
```

4. ワークフローの既定の権限を、読み取りだけにし、Actions が PR を Approve することを禁じます。

```bash
gh api -X PUT repos/{o}/{r}/actions/permissions/workflow \
  -f default_workflow_permissions=read -F can_approve_pull_request_reviews=false
```

   既存のワークフローが書き込みの権限を使っていれば、そのワークフローに `permissions:` で明示する必要があります。survey.md で見たワークフローから、該当しそうなものをユーザーに伝えます。

org のルールセットは変えません。変える必要があれば、ユーザーに伝えます。

手順 7 の `gh api` が 403 などで失敗したら (権限が足りない)、ユーザーに、リポジトリの Settings の画面で行う手順を示して頼みます。
- ルールセット: Settings → Rules → Rulesets → New branch ruleset で、上の JSON と同じ設定にする
- 自動マージ: Settings → General → Pull Requests の「Allow auto-merge」をオンにする
- ワークフローの既定の権限: Settings → Actions → General → Workflow permissions で、「Read repository contents and packages permissions」を選び、「Allow GitHub Actions to create and approve pull requests」をオフにする

## 8. ルーティンを作る (マージの後)
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

作れなかったとき (ログインが違う・RemoteTrigger が使えない) だけ、claude.ai/code の画面で作る手順を示して、ユーザーに頼みます。

## 入れ済みのリポジトリを新しい形に移す
`.github/workflows/autopilot.yml` か `.github/workflows/autopilot-qa.yml` があれば、前の形の autopilot が入っています (`autopilot.yml` に `automerge`・`label`・`fix`・`ready`・`deploy` の job がある、もっと前の形も含みます)。今の形は、autopilot のワークフローを置きません。次の順に、新しい形に移します。

1. 開いている autopilot の PR (ブランチが `autopilot/` で始まる) が無いときに行います。あれば、マージか close されるのを待つか、その Issue と PR に `needs-human` を付けて止めます。止めた PR は、移した後に、Issue の `needs-human` を外し、`autopilot:ready` を一度外してから付け直すと、同じ PR で続きから進みます
2. ルールセットの必須のチェックに `autopilot QA` があれば、先に外します。今の形には、このチェックを報告するワークフローが無いので、残すと、3 の PR も、この後の autopilot の PR も、待ちのままになります。`gh api repos/{o}/{r}/rulesets` で ID を探し、`gh api repos/{o}/{r}/rulesets/<id>` で読みます。`rules` の `required_status_checks` から `autopilot QA` を除き、`name`・`target`・`enforcement`・`conditions`・`rules`・`bypass_actors` を `gh api -X PUT repos/{o}/{r}/rulesets/<id> --input -` で書き戻します。ほかに必須のチェックが無くなれば、`required_status_checks` のルールごと消します。組織のルールセットにあれば、変えずに、ユーザーに伝えます
3. 新しい設定を入れる PR を作り、マージしてもらいます。手順 2 (`.github/autopilot.yml`) のひな形から書き直し、手順 6 のとおり PR にします。下の「消すもの」のうち、リポジトリのファイルも、同じ PR で消します。CODEOWNERS に、セキュリティの設定・除外のファイル (`/.gitleaks.toml`・`/.gitleaksignore`・`/.semgrepignore`・`/trivy.yaml`・`/.trivyignore`・`/.trivyignore.yaml`) の行が無ければ、手順 4 のひな形のとおりに足します (リポジトリに無いファイルの行も入れます)
4. ルーティンの Web の環境の写しを、作り直してもらいます (環境の設定のスクリプトのコメントを 1 行変えると、作り直されます)。ルーティンが、新しいプラグインの開発と対応の手順を読むためです。ルーティンは作り直しません

| 消すもの | 消し方 |
|---|---|
| `.github/workflows/autopilot.yml`・`.github/workflows/autopilot-qa.yml` | 3 の PR で消す |
| `.github/workflows/rollback.yml` | 3 の PR で消す |
| `.github/autopilot.yml` の `limits.stale_hours`・`limits.ready_retry_minutes` と、`required_checks` の `autopilot QA` | 3 の PR で、手順 2 のひな形から書き直すときに消す (読むものが無い。残っていても害は無い) |
| `.claude/settings.json` の Stop の hook の `[ -z "${AUTOPILOT_QA:-}" ] \|\| exit 0;` | 3 の PR で消す (QA のジョブで hook を止めるためのもの。残っていても害は無い) |
| zizmor の除外 | 3 の PR で、`.github/zizmor.yml` の `autopilot.yml:<行>`・`autopilot-qa.yml:<行>` の除外を消す |
| ルールセットの必須のチェック `autopilot QA` | 2 で外す |
| autopilot 用の GitHub App | App の導入先から、このリポジトリを外してもらう (org なら `https://github.com/organizations/<org>/settings/installations`、個人なら `https://github.com/settings/installations`)。App を使うリポジトリが無くなれば、App ごと消してもらう |
| シークレット `AUTOPILOT_APP_ID`・`AUTOPILOT_APP_PRIVATE_KEY` | `gh secret delete <名前>` (org のシークレットなら `--org <org>` を付ける) |
| QA のために入れた `CLAUDE_CODE_OAUTH_TOKEN`・`ANTHROPIC_API_KEY` | 3 の PR のマージの後に、ほかのワークフロー (Claude のレビューなど) が使っていなければ、`gh secret delete <名前>` で消す。`grep -rln -e CLAUDE_CODE_OAUTH_TOKEN -e ANTHROPIC_API_KEY -e 'secrets: inherit' .github/workflows` が何かを出したら、使っているとみなして残す |
| シークレット `AUTOPILOT_SLACK_WEBHOOK_URL` | `gh secret delete AUTOPILOT_SLACK_WEBHOOK_URL` (org のシークレットなら `--org <org>` を付ける) |
| 変数 `AUTOPILOT_BAD_REVISIONS` | `gh variable delete AUTOPILOT_BAD_REVISIONS` |
| Slack の App (前の setup が manifest で作ったもの) | Slack の App の設定の画面で消してもらう。通知は、5-B の購読にする |

- org で共有しているもの (シークレット・Slack の App・GitHub App) は、その org の前の形のリポジトリを、すべて移し終えてから消します。前の形のワークフローが、まだ使っているためです
- Renovate (survey.md で確認) は、前の形のリポジトリで、`autopilot-plugin` の SHA だけを新しい版に上げる PR を作ることがあります。新しい版には、前の形のワークフローが呼ぶ composite action がありません。そのままマージすると、job が落ちます。その PR はマージせず、この節の順に入れ直します
