# autopilot を入れる
Issue から本番までの自動の流れを、リポジトリに入れます。survey.md の結果と interview.md の答えを使います。次の 10 の手順を、この順に行います。

## 1. ラベルを 2 つ作る
手順 1 は、PR を作る前に、リモートのリポジトリを変えます (ラベルは、PR をマージしなくても残ります)。SKILL.md の「同意するまでリポジトリは変えない」の例外なので、提案 (interview.md) の一覧に入れ、同意の後に行います。

```bash
gh label create autopilot:ready --force --color 0E8A16 --description "開発を始めてよい"
gh label create needs-human --force --color D93F0B --description "止まった。人の判断が要る"
```
`.github/ISSUE_TEMPLATE/` のテンプレートの `labels:` に `autopilot:ready` があれば、消すようユーザーに提案します。`autopilot:ready` は、権限のある人が付けるものだからです。

## 2. `.github/autopilot.yml` を書く
[templates/autopilot.yml](templates/autopilot.yml) から、聞いた答えで書きます。`routine_github_user`・`qa.start`・`qa.url` を必ず入れます。置き換える文字列は、次の答えから取ります。

| 文字列 | 取る先 |
|---|---|
| `{{ROUTINE_GITHUB_USER}}` | interview のアカウント (ルーティンの持ち主の GitHub のユーザー名) |
| `{{QA_START}}`・`{{QA_URL}}` | interview の「アプリの起動」 |
| `{{REVIEWER}}` | interview の「Claude のレビュー」の bot。Claude なら `claude[bot]` |
| `{{CI_CHECK}}` | interview の「必須にするチェック」(survey の CI のジョブ名)。1 つずつ行を足す。0 件なら、この行ごと消す (下の「CI の必須のチェック」) |
| `{{IRREVERSIBLE_PATH}}` | interview の「取り消せない変更」のパス |
| `{{TERRAFORM_PLAN_ARTIFACT}}` | 手順 6 で決めた artifact 名 (Terraform の apply がマージで動くときだけ) |
| `{{APPROVER}}` | interview の「承認する人」 |
| `{{SLACK_CHANNEL}}`・`{{APPROVER_SLACK_MENTION}}` | interview の「Slack の通知先」 |

当てはまらない項目 (取り消せない変更が無ければ `irreversible` と `approvers` など) は、行ごと消します。`required_checks` には、`autopilot QA`・`autopilot/irreversible` を残します。

### `qa.start`
`qa.start` は、アプリを **background で起動して、すぐ終わる**コマンドにします。起動したまま終わらないコマンド (`bun run dev` だけなど) だと、ワークフローの step が終わらず、QA が進みません。

- compose で起動できるなら、`docker compose up -d --wait <サービス>` (サービスが healthy になるまで待って戻る)
- dev サーバーなら、`nohup <コマンド> > /tmp/app.log 2>&1 &` で background にし、準備ができるまで待つ (例: `npx wait-on http://localhost:3000`、または `curl --retry 30 --retry-connrefused --retry-delay 2 -fsS http://localhost:3000 >/dev/null`)
- 値は、Taskfile・compose から取る。E2E の起動 (`task dev:e2e` など) があれば、その中身を踏襲する。例: `docker compose up --build -d --wait api && cd frontend && bun install --frozen-lockfile && (nohup bun run dev > /tmp/frontend.log 2>&1 &) && curl --retry 30 --retry-connrefused --retry-delay 2 -fsS http://localhost:3000 >/dev/null`
- アプリが MCP サーバーを出していれば、それも起動し、応答を確かめる (QA が MCP のツールの条件を確かめられるように。登録は手順 3 の `{{QA_MCP_SERVERS}}`)
- ツール (bun・uv・task など) は、ワークフローのひな形が `qa.start` の前に入れます (手順 3)。`qa.start` で `npm install -g bun` のように入れ直さない

### CI の必須のチェック
CI のジョブがすべて `paths:` で飛ぶか、Draft の PR を飛ばすときは、毎回は結果を報告しないため、そのまま必須にできません (必須にすると、報告されない PR が永遠に待ちになる)。次のようにします。

1. `autopilot QA` と `autopilot/irreversible` は、これまでどおり必須のままにする
2. 常に動く集約のジョブを、CI のワークフローに足すことをユーザーに提案する。`needs:` に、絞り込みのあるジョブを並べ、`if: always()` で必ず動かし、1 つでも失敗か取り消しなら失敗にする。`paths:` で飛んだジョブ (skipped) は、失敗に数えない。この集約のジョブ名を、`{{CI_CHECK}}` に入れる

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

   ワークフロー自体が `on.pull_request.paths:` で絞られていると、集約のジョブも動きません。その場合は、`paths:` をワークフローから外し、各ジョブの手前で変更を見分ける形 (`dorny/paths-filter` など。SHA で固定する) に直す案を見せます。Draft の PR を飛ばすジョブは、集約のジョブには `if: always()` だけを付け (Draft を飛ばさない)、結果を必ず出します
3. ユーザーが集約のジョブを足さないと答えたら、CI のチェックは必須にしません。このとき、`.github/autopilot.yml` の `required_checks` から `- "{{CI_CHECK}}"` の行を**消し** (空の文字列や、プレースホルダーのまま残さない)、`autopilot QA`・`autopilot/irreversible` の 2 つだけにします。手順 9 のルールセットでも、CI のチェックの行を入れません。CI の失敗は、`workflow_run` の `fix` ジョブが拾うので、自動マージは止まりませんが、CI の結果でマージが止まらないことを、PR の本文に書きます

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
| `{{CI_WORKFLOWS}}` | CI のワークフロー名と `autopilot-qa` の YAML の配列。例: `["ci", "autopilot-qa"]`。Terraform の plan のワークフローがあれば、その名前も足す |
| `{{TERRAFORM_PLAN_WORKFLOW}}` | Terraform の plan のワークフロー名。無ければ `(none)` |
| `{{QA_START}}` | `qa.start` と同じコマンド |
| `{{QA_MCP_SERVERS}}` | アプリが MCP サーバーを出していれば (survey の compose・README・CI)、`{"<名前>":{"type":"http","url":"<URL>"}}`。無ければ `{}`。そのサービスも `qa.start` で起動し、`qa.start` の最後で応答を確かめる (例: `tools/list` を curl で送る。CI に同じ確かめがあれば、それを踏襲する) |
| `{{REVIEWER_BOTS}}` | Claude のレビューの bot。既定は `claude` |
| `{{REVIEWER}}` | `.github/autopilot.yml` の `review.reviewer` と同じ値。例 `claude[bot]` |

- QA のワークフロー (`autopilot-qa.yml`) と、`fix` ジョブ (`autopilot.yml`) は、アプリやテストを動かす前に、リポジトリが固定したツールを入れます。`mise.toml` (`.mise.toml`) があれば `jdx/mise-action` (bun・uv・task など、mise が入れるものすべて)。無ければ、`bun.lock` があるとき `oven-sh/setup-bun`、`uv.lock` があるとき `astral-sh/setup-uv` です。どれも SHA で固定してあり、ひな形のままでよい。ほかのツール (Node・Go など) が要るときは、同じ位置に setup の step を足します。トークンは、これらより前に作ってあり、PR のコードを動かす前という順を崩さないでください
- Terraform の plan が無いリポジトリでは、`# TERRAFORM_PLAN:BEGIN` から `# TERRAFORM_PLAN:END` までの行を消します
- `autopilot QA` は、必ず必須のチェックにします。自動マージが QA の成功を待つためです
- 書いたら `actionlint` で確かめます
- リポジトリの CI がワークフローを ghalint・zizmor などで検査していれば、同じ版を手元で動かして通します (版は survey.md で見た CI から取る)。ひな形は ghalint v1.6.0 で通ります
- zizmor は、`autopilot.yml` の `pull_request_target`・`issue_comment`・`workflow_run` の 3 つを `dangerous-triggers` (high) として出します。3 つは設計で要るトリガーなので、除外します
  - リポジトリに zizmor の設定 (`.github/zizmor.yml` か `zizmor.yml`) があれば、`rules.dangerous-triggers.ignore` に `autopilot.yml:<行>` を 3 つ足し、上に理由のコメントを書きます (理由は、ひな形のトリガーの上のコメントと同じ)。行番号は、書いた `autopilot.yml` で数えます。設定の変更に、組織のルールで承認が要ることがあります (設定のコメントや、ルールセットを見る)。そのときは PR の本文に書きます
  - 設定が無ければ、`.github/zizmor.yml` を作って同じように書きます。インラインの除外のコメント (`# zizmor` で始まるコメント) は、禁じる CI があるので使いません
  - 行番号で除外するので、`autopilot.yml` を書き直して行がずれたら、除外の行番号も直します
- zizmor を手元で動かすときは、リポジトリの設定を読ませます: `zizmor --config .github/zizmor.yml .github/workflows/autopilot.yml .github/workflows/autopilot-qa.yml` → error が 0 件

## 4. Claude のレビューと CI
- Claude のレビューが無ければ、[templates/claude-code-review-workflow.yml](templates/claude-code-review-workflow.yml) を `.github/workflows/claude-code-review.yml` に置きます。`review.trigger` が `ready_for_review` ならこのままで、`comment` ならコメントで起動します (合図は `review.command` に合わせる)。`review.reviewer: claude[bot]` と、ワークフローの `{{REVIEWER_BOTS}}: claude`、`fix` の `{{REVIEWER}}` は、同じ bot を 3 通りに書いたものです
- CI が無ければ、そのリポジトリのテストを動かす CI を作ります (survey.md で見たタスクランナーのコマンドを呼びます)。`pull_request` で、`paths:` を付けずに動かします

## 5. ロールバック (デプロイがあり、ロールバックが無いとき)
ユーザーに提案し、選ばれたときだけ用意します。

1. デプロイのワークフローから、デプロイ先 (Cloud Run・ECS・Vercel など) を見分け、案を見せる
2. 選ばれたら `.github/workflows/rollback.yml` を書き、`deploy.rollback` に `rollback.yml` を登録する

| デプロイ先 | 書き方 |
|---|---|
| Cloud Run | [templates/rollback-cloud-run.yml](templates/rollback-cloud-run.yml)。`{{SERVICE}}`・`{{REGION}}`・認証 (`{{WORKLOAD_IDENTITY_PROVIDER}}`・`{{SERVICE_ACCOUNT}}`) は、デプロイのワークフローの値に合わせる。トラフィックを、最後に正常だったリビジョン (Ready で、配信中でなく、`AUTOPILOT_BAD_REVISIONS` に無い、いちばん新しいもの) に戻す。戻した後、戻す元を Actions の変数 `AUTOPILOT_BAD_REVISIONS` に記録し、次の候補から外す (トラフィックのタグは作らない。タグは公開の URL になるため)。候補が無ければ失敗する。App の ID・秘密鍵のシークレットを使う |
| そのほか | そのリポジトリのデプロイのワークフローに合わせて書く。`workflow_dispatch` で動き、最後に正常だった版に戻す |

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
| 組織にもうあるかを確かめる | 下の「7-A」。org のときだけ |
| GitHub App を作る | 7-A で見つからなかったとき、[templates/github-app-manifest.json](templates/github-app-manifest.json) をもとに、ボタンで作る (下の「7-B」)。権限は下の表。webhook は無効 |
| GitHub App を入れる | **autopilot を使うリポジトリにだけ**入れる |
| Slack の App と Incoming Webhook | 7-A で見つからなかったとき、manifest で作る (下の「7-C」) |
| シークレットを登録 | 下の表。7-B・7-C で登録したものと、7-A で足したものは飛ばす |
| Web の環境を作る | README の手順 |

GitHub App を、autopilot を使うリポジトリにだけ入れるのは、QA と対応のジョブが PR のコードを動かすためです。ほかのリポジトリに入れると、App の権限が、そのリポジトリにも及びます。

### 7-A. 組織にもうあるかを確かめる
リポジトリの持ち主が org のときだけ行います。個人のアカウントなら飛ばします (App もシークレットもリポジトリごと)。App は会社ごとに 1 つです。人ごとに作りません。

1. GitHub App: `gh api orgs/<org>/installations --jq '.installations[] | {id, app_slug, repository_selection}'` で、入っている App を読みます (org の owner の権限が要る)。
   - autopilot の App (名前に autopilot を含むものなど) があれば、どれかをユーザーに確かめ、新しく作りません。その App を入れるリポジトリに、このリポジトリを足してもらいます (`https://github.com/organizations/<org>/settings/installations/<id>` の「Only select repositories」)。権限が下の表と合っているかは、下の「権限の照らし合わせ」のとおり照らします
   - 読めない (403) ときは、org の owner に確かめてもらいます。**自分で新しい App を作りません** (人ごとに App ができるのを防ぐため)
2. シークレット: `gh api orgs/<org>/actions/secrets --jq '.secrets[] | {name, visibility}'` で、`AUTOPILOT_APP_ID`・`AUTOPILOT_APP_PRIVATE_KEY`・`AUTOPILOT_SLACK_WEBHOOK_URL`・`CLAUDE_CODE_OAUTH_TOKEN`・`ANTHROPIC_API_KEY` があるかを見ます。
   - `visibility` が `selected` なら、値を変えずに、このリポジトリを足します: `gh api -X PUT orgs/<org>/actions/secrets/<名前>/repositories/<リポジトリの id>` (id は `gh api repos/{owner}/{repo} --jq .id`)
   - `all`・`private` なら、もう使えます。何もしません
3. Slack: org のシークレットに `AUTOPILOT_SLACK_WEBHOOK_URL` があれば、同じチャンネルでよいかをユーザーに聞きます。別のチャンネルにするときだけ、組織の Slack の App (7-C で作ったもの) に Webhook を足し (App の設定の Incoming Webhooks の「Add New Webhook to Workspace」)、リポジトリのシークレットとして登録します (リポジトリのシークレットが org のものより優先される)

### 7-B. GitHub App を manifest で作る
7-A で見つからなかったときに行います。

1. `github-app-manifest.json` の `{{APP_NAME}}` を、org なら `autopilot-<org>` (組織で 1 つと分かる名前) にし、`{{REPO_URL}}` をこのリポジトリの URL にします (`redirect_url` も同じ。作った後に、ここへ `?code=...&state=...` が付いて戻る)
2. [templates/github-app-create.html](templates/github-app-create.html) の `{{CREATE_URL}}`・`{{MANIFEST}}` を置き換えます。
   - `{{CREATE_URL}}`: org なら `https://github.com/organizations/<org>/settings/apps/new?state=<ランダム>`、個人なら `https://github.com/settings/apps/new?state=<ランダム>`。`state` は setup が覚えておく
   - `{{MANIFEST}}`: 1 の JSON を、HTML の属性値として escape したもの (`&`・`"`・`<`・`>`)
3. HTML を一時フォルダに書き、ブラウザで開きます (`open` (Mac)・`xdg-open` (Linux)・WSL なら `explorer.exe`)。開けない環境 (Web のセッションなど) では、手順 2 以降をやめ、下の「画面で作るとき」にします。
4. ユーザーに「GitHub App を作る」を押して作ってもらい、戻った先のアドレスの `code` と `state` を教えてもらいます。`state` が送ったものと同じかを確かめます。
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

org では、シークレットを org のシークレット (`--visibility selected`) にします。次のリポジトリの setup が、7-A の 2 で足すだけで済むようにするためです。

### 7-C. Slack App を manifest で作る
7-A で見つからなかったときに行います。組織の Slack に、もう autopilot の App があれば作りません (7-A の 3)。

[templates/slack-app-manifest.json](templates/slack-app-manifest.json) は、Incoming Webhook だけの App です (ほかの権限は付けない)。次の手順で作ってもらいます。

1. https://api.slack.com/apps の「Create New App」→「From an app manifest」を選ぶ
2. ワークスペースを選び、manifest を貼って作る
3. 「Install to Workspace」で、通知先のチャンネルを選ぶ
4. 「Incoming Webhooks」に出る URL を、自分のターミナルで `gh secret set AUTOPILOT_SLACK_WEBHOOK_URL --org <org> --visibility selected --repos <repo>` (個人なら `--repo <owner>/<repo>`) に貼る。値は会話に書かない

### 権限の照らし合わせ
| App の権限 | 値 | 使うところ |
|---|---|---|
| Contents・Pull requests・Issues・Commit statuses・Actions | Read and write | ラベル・コメント・ステータス・自動マージ・push・ワークフローの起動 |
| Variables (リポジトリ) | Read and write | ロールバックのワークフローが、戻す元のリビジョンを変数 `AUTOPILOT_BAD_REVISIONS` に記録する |
| Checks | Read | 必須のチェックの結果 |
| Metadata | Read | 常に付く |
| Organization の Members | Read | 承認する人の team を読む (`irreversible`) |

画面で作るとき (7-B の 3 で開けないとき) は、作成の画面を、個人のアカウントなら `https://github.com/settings/apps/new`、org なら `https://github.com/organizations/<org>/settings/apps/new` として、manifest の権限を、画面で同じにしてもらいます。

作り終えたら (7-A で見つけた App も同じ)、App の設定の「Permissions & events」の画面を見せてもらい (または、スクリーンショットか、`gh api` で読める範囲の値)、上の表と 1 つずつ照らします。すでに App があるリポジトリや、7-A で見つけた App では、Variables (Read and write) が足りないので、App の設定で足してもらいます (足したら、導入先で権限の更新を承認してもらう)。ロールバックを入れないなら、要りません。違いがあれば直してもらいます。App の ID も控えてもらいます (手順 9 で使います)。

| シークレット | 内容 |
|---|---|
| `AUTOPILOT_APP_ID` | App の ID |
| `AUTOPILOT_APP_PRIVATE_KEY` | App の秘密鍵 (`.pem` の中身) |
| `AUTOPILOT_SLACK_WEBHOOK_URL` | Slack の Incoming Webhook の URL |
| `CLAUDE_CODE_OAUTH_TOKEN` か `ANTHROPIC_API_KEY` | claude-code-action の認証 (どちらか) |

登録は `gh secret set <名前>` (org で共有するなら `--org <org> --visibility selected --repos <リポジトリ>`) です。7-B・7-C で登録したものと、7-A で組織のものを足したものは、飛ばします。環境変数とシークレットは、使う操作に要る最小の権限にしてもらいます。値は、会話や commit に書きません。

## 8. PR にまとめて、マージしてもらう
SKILL.md の「PR を作る」の節のとおりに、ここまでの変更を 1 つの PR にまとめます。本文には、次も書きます。

- 入れたワークフローと、`.github/autopilot.yml` の内容
- ユーザーがすること (まだ終えていないシークレット・App・Webhook・Web の環境)
- マージした後に、setup がルールセットとルーティンを作ること

PR を作ったら、ユーザーにマージを頼み、マージされるのを待ちます。ルールセットとルーティンは、**マージの後**に作ります。ワークフローがデフォルトブランチに入るまで、`autopilot QA` と `autopilot/irreversible` は報告されません。先に必須にすると、この PR が永遠に待ちになります。マージされたら、`git fetch` でデフォルトブランチを更新してから、次に進みます。

## 9. ルールセットを作る (マージの後)
1. 必須にするチェックが、PR ごとに必ず結果を出すかを確かめます。
   - `autopilot QA` と `autopilot/irreversible` は、ひな形のワークフローに `paths:` の絞り込みが無く、PR ごとに必ず報告します。setup は、この 2 つのワークフローに `paths:` や `paths-ignore:` を足しません
   - CI のジョブは、`paths:` で飛ぶものを必須にしません。飛ぶものは、必須にしないか、いつも動くジョブにまとめます (手順 2 の「CI の必須のチェック」)。全部の CI がこれに当たるときも、`autopilot QA`・`autopilot/irreversible` は必須のままにします
2. 今あるルールセットを見ます。リポジトリのものは `gh api repos/{o}/{r}/rulesets`、組織のものは `gh api orgs/{org}/rulesets` (権限が無ければ、`gh api repos/{o}/{r}/rules/branches/<デフォルトブランチ>` が、組織のものを含めた、いま効いているルールを返す) で読みます。デフォルトブランチに効いているルール (必須のレビューの人数・必須のチェック・マージ方法) を一覧にし、すでに満たしているものは、新しいルールセットに書きません (例: 組織が承認 1 人を要求していれば、`pull_request` のルールは足さない。人数が足りなければ、そのルールだけを足す)。あれば、新しく作らず、足りないものだけを足す案を見せます。組織のルールセットは変えません
3. 作ります。チェック名は、survey.md と `.github/autopilot.yml` の値にします。`integration_id` で、チェックを出す側を固定します。同じ名前のチェックを、ほかのアプリや PR のコードが出しても、数えません。

| チェック | `integration_id` |
|---|---|
| `autopilot/irreversible` | autopilot の GitHub App の ID (手順 7 で控えたもの。App のページか `AUTOPILOT_APP_ID` と同じ) |
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
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false } },
    { "type": "required_status_checks", "parameters": {
        "strict_required_status_checks_policy": false,
        "required_status_checks": [
          { "context": "<CI のジョブ名>", "integration_id": 15368 },
          { "context": "autopilot QA", "integration_id": 15368 },
          { "context": "autopilot/irreversible", "integration_id": <App の ID> }
        ] } }
  ]
}
JSON
gh api -X PATCH repos/{o}/{r} -F allow_auto_merge=true
```

4. 最初の autopilot の PR で、`autopilot/irreversible` (App が付けるコミットステータス) が、ルールセットの `integration_id` の固定で受け付けられるかを確かめます。GitHub が App が付けたものと見なさず、必須のチェックが満たされないときは、その 1 つだけ固定を外し、ユーザーに伝えます
5. ワークフローの既定の権限を、読み取りだけにし、Actions が PR を Approve することを禁じます。

```bash
gh api -X PUT repos/{o}/{r}/actions/permissions/workflow \
  -f default_workflow_permissions=read -F can_approve_pull_request_reviews=false
```

   既存のワークフローが書き込みの権限を使っていれば、そのワークフローに `permissions:` で明示する必要があります。survey.md で見たワークフローから、該当しそうなものをユーザーに伝えます。

org のルールセットは変えません。変える必要があれば、ユーザーに伝えます。

## 10. ルーティンを作る (マージの後)
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
