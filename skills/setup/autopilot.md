# autopilot を入れる
Issue からマージまでの自動の流れを、リポジトリに入れます。survey.md の結果と interview.md の答えを使います。次の 9 の手順を、この順に行います。前の形の autopilot が入っているリポジトリでは、最後の「入れ済みのリポジトリを新しい形に移す」に従います。

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
| `{{CI_CHECK}}` | interview の「必須にするチェック」(survey の CI のジョブ名)。1 つずつ行を足す。0 件なら、この行ごと消す (下の「CI の必須のチェック」) |

当てはまらない項目は、行ごと消します。`required_checks` には、`autopilot QA` を残します。

### `qa.start`
`qa.start` は、`dev:up` のコマンド (checks.md で作る。例: `task dev:up`) にします。人・Claude の動作確認・QA が、同じ方法でアプリを起動するためです。`dev:up` の中身 (後ろで起動して、準備ができるまで待つ・MCP サーバーの応答を確かめる) は、checks.md の「`dev:up`」にあります。

- ツール (bun・uv・task など) は、ワークフローのひな形が `qa.start` の前に入れます (手順 3)。`qa.start` で `npm install -g bun` のように入れ直さない

### CI の必須のチェック
CI のジョブがすべて `paths:` で飛ぶか、Draft の PR を飛ばすときは、毎回は結果を報告しないため、そのまま必須にできません (必須にすると、報告されない PR が永遠に待ちになる)。次のようにします。

1. `autopilot QA` は、これまでどおり必須のままにする
2. 常に動く集約のジョブを足すことを、ユーザーに提案する。1 つでも失敗か取り消しなら失敗にし、`paths:` などで飛んだジョブ (skipped) は、失敗に数えない。この集約のジョブ名を、`{{CI_CHECK}}` に入れる。足し方は、CI の形で決まる
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
          files=$(gh api "repos/$GITHUB_REPOSITORY/pulls/$PR/files" --paginate --jq '.[] | .filename, (.previous_filename // empty)')
          # files API は 3000 ファイルまで。それ以上は、一覧が欠けるので、すべて動かす
          count=$(gh api "repos/$GITHUB_REPOSITORY/pulls/$PR" --jq '.changed_files')
          all=false
          if [ "$count" -ge 3000 ]; then all=true; fi
          # <出力の名前> <正規表現>: 変更されたファイルのどれかが合えば true
          filter() {
            if [ "$all" = true ] || printf '%s\n' "$files" | grep -Eq "$2"; then
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
3. ユーザーが集約のジョブを足さないと答えたら、CI のチェックは必須にしません。このとき、`.github/autopilot.yml` の `required_checks` から `- "{{CI_CHECK}}"` の行を**消し** (空の文字列や、プレースホルダーのまま残さない)、`autopilot QA` だけにします。手順 8 のルールセットでも、CI のチェックの行を入れません。CI の失敗は、開発のルーティンが購読で拾います。ただし、CI の結果では自動マージが止まらないので、そのことを PR の本文に書きます

## 3. ワークフローを 2 つ書く
| 書くファイル | ひな形 |
|---|---|
| `.github/workflows/autopilot.yml` | [templates/autopilot-workflow.yml](templates/autopilot-workflow.yml) |
| `.github/workflows/autopilot-qa.yml` | [templates/autopilot-qa-workflow.yml](templates/autopilot-qa-workflow.yml) |

`{{AUTOPILOT_REF}}` の SHA は、`gh api repos/theindiehacker/autopilot-plugin/git/ref/tags/v<version> --jq '.object|[.type,.sha]|@tsv'` で取ります。`type` が `tag` (annotated tag) なら、`gh api repos/theindiehacker/autopilot-plugin/git/tags/<その sha> --jq .object.sha` で、指しているコミットの SHA に直します (`commit` ならそのまま)。プラグインのリリースの前に試すときは、ブランチの先頭 (`gh api repos/theindiehacker/autopilot-plugin/commits/<ブランチ> --jq .sha`) の SHA を使います。Renovate (survey.md で確認) が、`# v<version>` の付いた SHA の固定を、新しいリリースへ更新します。Renovate が無ければ、更新が手作業になることをユーザーに伝えます。

QA を別のファイルにするのは、別のイベントで起きた実行で QA のジョブが飛ばされ、必須のチェックを通してしまうのを防ぐためです。

| 置き換える文字列 | 値 |
|---|---|
| `{{AUTOPILOT_REF}}` | プラグインのリリースの**コミットの SHA (40 文字)** と、続けて ` # v<version>`。ブランチ名・タグ名は入れない (動く中身が、後から変わってしまうため)。`<version>` は `.claude-plugin/plugin.json` の version。例: `uses: theindiehacker/autopilot-plugin/actions/claude@0123abcd… # v1.2.3` |
| `{{QA_START}}` | `qa.start` と同じコマンド |
| `{{QA_MCP_SERVERS}}` | アプリが MCP サーバーを出していれば (survey の compose・README・CI)、`{"<名前>":{"type":"http","url":"<URL>"}}`。無ければ `{}`。そのサービスは `dev:up` (`qa.start`) が起動し、応答を確かめる (checks.md の「`dev:up`」)。QA のワークフローに入れる |

- QA のワークフロー (`autopilot-qa.yml`) は、アプリを動かす前に、リポジトリが固定したツールを入れます。`mise.toml` (`.mise.toml`) があれば `jdx/mise-action` (bun・uv・task など、mise が入れるものすべて)。無ければ、`bun.lock` があるとき `oven-sh/setup-bun`、`uv.lock` があるとき `astral-sh/setup-uv` です。どれも SHA で固定してあり、ひな形のままでよい。ほかのツール (Node・Go など) が要るときは、同じ位置に setup の step を足します。トークンは、これらより前に作ってあり、PR のコードを動かす前という順を崩さないでください
- `autopilot QA` は、必ず必須のチェックにします。自動マージが QA の成功を待つためです
- 書いたら `actionlint` で確かめます
- リポジトリの CI がワークフローを ghalint・zizmor などで検査していれば、同じ版を手元で動かして通します (版は survey.md で見た CI から取る)。ひな形は ghalint v1.6.0 で通ります
- 入れ済みのリポジトリで、`.github/zizmor.yml` に `autopilot.yml:<行>` の除外 (`dangerous-triggers`) があれば消します。今のひな形は、そのトリガーを使いません
- zizmor を手元で動かすときは、リポジトリの設定を読ませます: `zizmor --config .github/zizmor.yml .github/workflows/autopilot.yml .github/workflows/autopilot-qa.yml` → error が 0 件

## 4. Claude のレビューと CI
- Claude のレビューが無ければ、[templates/claude-code-review-workflow.yml](templates/claude-code-review-workflow.yml) を `.github/workflows/claude-code-review.yml` に置きます。`review.trigger` が `ready_for_review` ならこのままで、`comment` ならコメントで起動します (合図は `review.command` に合わせる)。`review.reviewer` は、判定を出す bot です (Claude なら `claude[bot]`)
- CI が無ければ、そのリポジトリのテストを動かす CI を作ります (survey.md で見たタスクランナーのコマンドを呼びます)。`pull_request` で、`paths:` を付けずに動かします

## 5. CODEOWNERS を書く
[templates/CODEOWNERS](templates/CODEOWNERS) から、interview の「人の承認が要るパスと、その持ち主」で `.github/CODEOWNERS` を書きます。手順 8 のルールセットの「コードオーナーのレビューを必須」と合わせて、ここに書いたパスを変える PR は、持ち主が Approve するまでマージされません。

| 文字列 | 値 |
|---|---|
| `{{MIGRATION_PATH}}` | マイグレーションのフォルダ。例: `/backend/migration/versions/` |
| `{{TERRAFORM_PATH}}` | Terraform のフォルダ。例: `/infrastructure/` |
| `{{OWNER}}` | 持ち主。GitHub のユーザー名 (`@user`) か team (`@org/team`)。複数なら空白で区切る |

- 初めの値は、autopilot を動かすファイル (`.github/`・`.claude/`・`.mcp.json`・git の hook の設定) と、マイグレーション・Terraform です。autopilot を動かすファイルを入れるのは、AI の PR が、人の承認なしに、自分の検査・ワークフロー・設定を変えられないようにするためです (`.github/` に、この CODEOWNERS 自身も入る)
- git の hook の設定 (`lefthook.yml`・`.lefthook.yml`・`lefthook.yaml`・`.pre-commit-config.yaml`・`.husky/`) は、リポジトリに無いものの行を消します。分からなければ、すべて残します
- マイグレーションや Terraform が無ければ、その行を消します。interview でほかのパスが挙がれば、行を足します
- 持ち主には、リポジトリへの書き込みの権限が要ります (GitHub の決まり)
- 持ち主への承認の依頼は、Slack ではなく GitHub のレビューの依頼で届きます (GitHub の Slack 連携を入れれば、Slack にも出せます)

## 6. ユーザーに頼むこと
画面でしかできないことを、手順を示して頼みます。1 つ終えるごとに、できたかを聞きます。

| 頼むこと | 手順 |
|---|---|
| 組織にもうあるかを確かめる | 下の「6-A」。org のときだけ |
| GitHub App を作る | 6-A で見つからなかったとき、[templates/github-app-manifest.json](templates/github-app-manifest.json) をもとに、ボタンで作る (下の「6-B」)。権限は下の表。webhook は無効 |
| GitHub App を入れる | **autopilot を使うリポジトリにだけ**入れる |
| GitHub の Slack アプリの購読 | Slack に GitHub のアプリを入れ、通知先のチャンネルで購読する (下の「6-C」) |
| シークレットを登録 | 下の表。6-B で登録したものと、6-A で足したものは飛ばす |
| Web の環境を作る | README の手順 |

GitHub App を、autopilot を使うリポジトリにだけ入れるのは、QA が、App のトークンで PR のコードを動かすためです (見回りは、PR のコードを動かしません)。ほかのリポジトリに入れると、App の権限が、そのリポジトリにも及びます。

### 6-A. 組織にもうあるかを確かめる
リポジトリの持ち主が org のときだけ行います。個人のアカウントなら飛ばします (App もシークレットもリポジトリごと)。App は会社ごとに 1 つです。人ごとに作りません。

1. GitHub App: `gh api orgs/<org>/installations --jq '.installations[] | {id, app_slug, repository_selection}'` で、入っている App を読みます (org の owner の権限が要る)。
   - autopilot の App (名前に autopilot を含むものなど) があれば、どれかをユーザーに確かめ、新しく作りません。その App を入れるリポジトリに、このリポジトリを足してもらいます (`https://github.com/organizations/<org>/settings/installations/<id>` の「Only select repositories」)。権限が下の表と合っているかは、下の「権限の照らし合わせ」のとおり照らします
   - 読めない (403) ときは、org の owner に確かめてもらいます。**自分で新しい App を作りません** (人ごとに App ができるのを防ぐため)
2. シークレット: `gh api orgs/<org>/actions/secrets --jq '.secrets[] | {name, visibility}'` で、`AUTOPILOT_APP_ID`・`AUTOPILOT_APP_PRIVATE_KEY`・`CLAUDE_CODE_OAUTH_TOKEN`・`ANTHROPIC_API_KEY` があるかを見ます。
   - `visibility` が `selected` なら、値を変えずに、このリポジトリを足します: `gh api -X PUT orgs/<org>/actions/secrets/<名前>/repositories/<リポジトリの id>` (id は `gh api repos/{owner}/{repo} --jq .id`)
   - `all`・`private` なら、もう使えます。何もしません
### 6-B. GitHub App を manifest で作る
6-A で見つからなかったときに行います。

1. `github-app-manifest.json` の `{{APP_NAME}}` を、org なら `autopilot-<org>` (組織で 1 つと分かる名前) にし、`{{REPO_URL}}` をこのリポジトリの URL にします (`redirect_url` も同じ。作った後に、ここへ `?code=...&state=...` が付いて戻る)
2. [templates/github-app-create.html](templates/github-app-create.html) の `{{CREATE_URL}}`・`{{MANIFEST}}` を置き換えます。
   - `{{CREATE_URL}}`: org なら `https://github.com/organizations/<org>/settings/apps/new?state=<ランダム>`、個人なら `https://github.com/settings/apps/new?state=<ランダム>`。`state` は setup が覚えておく
   - `{{MANIFEST}}`: 1 の JSON を、HTML の属性値として escape したもの (`&`・`"`・`<`・`>`)
3. HTML を一時フォルダに書き、ブラウザで開きます (`open` (Mac)・`xdg-open` (Linux)・WSL なら `explorer.exe`)。開けない環境 (Web のセッションなど) では、手順 2 以降をやめ、下の「画面で作るとき」にします。
4. ユーザーに「GitHub App を作る」を押して作ってもらい、戻った先のアドレスの `state` だけを教えてもらいます。送ったものと同じかを確かめます (違えば、5 に進まず作り直す)。`code` は会話に書かず、5 のコマンドに入れてもらいます。
5. `code` は 1 時間だけ、1 回だけ、App の ID と秘密鍵に替えられます。秘密鍵が会話に出ないよう、ユーザーに自分のターミナルで次を動かしてもらいます (setup が値を入れたコマンドを示す。`--org` の行は org のとき、`--repo` の行は個人のとき)。

```bash
read -rs -p 'code: ' CODE; echo
out=$(mktemp); chmod 600 "$out"
gh api -X POST "/app-manifests/$CODE/conversions" > "$out"
jq -r .id "$out" | gh secret set AUTOPILOT_APP_ID --org <org> --visibility selected --repos <repo>
jq -r .pem "$out" | gh secret set AUTOPILOT_APP_PRIVATE_KEY --org <org> --visibility selected --repos <repo>
jq -r '"App: \(.slug) (ID \(.id))"' "$out"
rm -f "$out"
```

   個人のアカウントでは、`gh secret set` の `--org <org> --visibility selected --repos <repo>` を `--repo <owner>/<repo>` に替えます。
6. 次に、App をこのリポジトリにだけ入れてもらいます: `https://github.com/apps/<slug>/installations/new` で「Only select repositories」を選びます。

org では、シークレットを org のシークレット (`--visibility selected`) にします。次のリポジトリの setup が、6-A の 2 で足すだけで済むようにするためです。

### 6-C. 通知を、GitHub の Slack アプリの購読にする
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

### 権限の照らし合わせ
| App の権限 | 値 | 使うところ |
|---|---|---|
| Contents | Read and write | QA のエビデンスの push。見回りと QA が、設定とコードを読む |
| Pull requests・Issues | Read and write | 見回りと QA のコメント。見回りのラベル (`autopilot:ready` の付け直しと `needs-human`) |
| Checks | Read | 今は使いません (見回りも QA も、トークンに求めていません) |
| Metadata | Read | 常に付く |

自動マージの有効化と、指摘を直す push は、開発のルーティンが、ルーティンの持ち主の GitHub の権限で行います (App の権限は使いません)。

画面で作るとき (6-B の 3 で開けないとき) は、作成の画面を、個人のアカウントなら `https://github.com/settings/apps/new`、org なら `https://github.com/organizations/<org>/settings/apps/new` として、manifest の権限を、画面で同じにしてもらいます。

作り終えたら (6-A で見つけた App も同じ)、App の設定の「Permissions & events」の画面を見せてもらい (または、スクリーンショットか、`gh api` で読める範囲の値)、上の表と 1 つずつ照らします。違いがあれば、App の設定で直してもらいます (権限を足したら、導入先で権限の更新を承認してもらう)。

| シークレット | 内容 |
|---|---|
| `AUTOPILOT_APP_ID` | App の ID |
| `AUTOPILOT_APP_PRIVATE_KEY` | App の秘密鍵 (`.pem` の中身) |
| `CLAUDE_CODE_OAUTH_TOKEN` か `ANTHROPIC_API_KEY` | claude-code-action の認証 (どちらか) |

登録は `gh secret set <名前>` (org で共有するなら `--org <org> --visibility selected --repos <リポジトリ>`) です。6-B で登録したものと、6-A で組織のものを足したものは、飛ばします。環境変数とシークレットは、使う操作に要る最小の権限にしてもらいます。値は、会話や commit に書きません。

## 7. PR にまとめて、マージしてもらう
SKILL.md の「PR を作る」の節のとおりに、ここまでの変更を 1 つの PR にまとめます。本文には、次も書きます。

- 入れたワークフローと、`.github/autopilot.yml` の内容
- ユーザーがすること (まだ終えていないシークレット・App・Slack の購読・Web の環境)
- マージした後に、setup がルールセットとルーティンを作ること

PR を作ったら、ユーザーにマージを頼み、マージされるのを待ちます。ルールセットとルーティンは、**マージの後**に作ります。ワークフローがデフォルトブランチに入るまで、`autopilot QA` は報告されません。先に必須にすると、この PR が永遠に待ちになります。マージされたら、`git fetch` でデフォルトブランチを更新してから、次に進みます。

## 8. ルールセットを作る (マージの後)
1. 必須にするチェックが、PR ごとに必ず結果を出すかを確かめます。
   - `autopilot QA` は、ひな形のワークフローに `paths:` の絞り込みが無く、PR ごとに必ず報告します。setup は、autopilot の 2 つのワークフローに `paths:` や `paths-ignore:` を足しません
   - CI のジョブは、`paths:` で飛ぶものを必須にしません。飛ぶものは、必須にしないか、いつも動くジョブにまとめます (手順 2 の「CI の必須のチェック」)。全部の CI がこれに当たるときも、`autopilot QA` は必須のままにします
2. 今あるルールセットを見ます。リポジトリのものは `gh api repos/{o}/{r}/rulesets`、組織のものは `gh api orgs/{org}/rulesets` (権限が無ければ、`gh api repos/{o}/{r}/rules/branches/<デフォルトブランチ>` が、組織のものを含めた、いま効いているルールを返す) で読みます。デフォルトブランチに効いているルール (必須のレビューの人数・コードオーナーのレビュー・必須のチェック・マージ方法) を一覧にし、すでに満たしているものは、新しいルールセットに書きません (例: 組織が承認 1 人とコードオーナーのレビューを要求していれば、`pull_request` のルールは足さない。足りなければ、足りないものだけを足す)。あれば、新しく作らず、足りないものだけを足す案を見せます。組織のルールセットは変えません
3. 作ります。チェック名は、survey.md と `.github/autopilot.yml` の値にします。`integration_id` で、チェックを出す側を固定します。同じ名前のチェックを、ほかのアプリや PR のコードが出しても、数えません。

| チェック | `integration_id` |
|---|---|
| `autopilot QA`・CI のジョブ | GitHub Actions の `15368` |

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
          { "context": "<CI のジョブ名>", "integration_id": 15368 },
          { "context": "autopilot QA", "integration_id": 15368 }
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

## 9. ルーティンを作る (マージの後)
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

## 入れ済みのリポジトリを新しい形に移す
`.github/workflows/autopilot.yml` に `automerge`・`label`・`fix`・`ready`・`deploy` の job があれば、前の形の autopilot が入っています。次の順に、新しい形に移します。

1. 開いている autopilot の PR (ブランチが `autopilot/` で始まる) が無いときに行います。あれば、マージか close されるのを待つか、その Issue と PR に `needs-human` を付けて止めます。止めた PR は、移した後に、Issue の `needs-human` を外して `autopilot:ready` を付け直すと、同じ PR で続きから進みます
2. 新しいワークフローと設定を入れる PR を作り、マージしてもらいます。手順 2 (`.github/autopilot.yml`) と手順 3 (ワークフロー) のひな形から書き直し、手順 7 のとおり PR にします。下の「消すもの」のうち、リポジトリのファイルも、同じ PR で消します
3. ルーティンの Web の環境の写しを、作り直してもらいます (環境の設定のスクリプトのコメントを 1 行変えると、作り直されます)。ルーティンが、新しいプラグインの開発と対応の手順を読むためです。ルーティンは作り直しません

| 消すもの | 消し方 |
|---|---|
| シークレット `AUTOPILOT_SLACK_WEBHOOK_URL` | `gh secret delete AUTOPILOT_SLACK_WEBHOOK_URL` (org のシークレットなら `--org <org>` を付ける) |
| `.github/workflows/rollback.yml` | 2 の PR で消す |
| 変数 `AUTOPILOT_BAD_REVISIONS` | `gh variable delete AUTOPILOT_BAD_REVISIONS` |
| Slack の App (前の setup が manifest で作ったもの) | Slack の App の設定の画面で消してもらう。通知は、6-C の購読にする |
| zizmor の除外 | 2 の PR で、`.github/zizmor.yml` の `autopilot.yml:<行>` の除外を消す (手順 3) |

- GitHub App の権限は、Actions と Variables を外してかまいません (上の「権限の照らし合わせ」)。外したら、導入先で権限の更新を承認してもらいます
- org で共有しているもの (シークレット・Slack の App・GitHub App の権限) は、その org の前の形のリポジトリを、すべて移し終えてから消します。前の形のワークフローが、まだ使っているためです
- Renovate (survey.md で確認) は、前の形のリポジトリで、`autopilot-plugin` の SHA だけを新しい版に上げることがあります。そのままマージすると、前の形のワークフローが消したコマンド (`automerge` など) を呼んで、job が落ちます。その PR はマージせず、この節の順に、ひな形ごと入れ直します
