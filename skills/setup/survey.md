# 調べる
リポジトリの今の状態を調べ、結果を表にまとめます。ここでは何も変えません。リポジトリのルートで実行します。`{o}` と `{r}` は、`gh repo view --json owner,name` の値です。

| 項目 | 調べるコマンド | 見るところ |
|---|---|---|
| 技術スタック | `git ls-files -- '*package.json' '*pyproject.toml' '*requirements*.txt' '*setup.py' '*bun.lock*' '*package-lock.json' '*yarn.lock' '*pnpm-lock.yaml' '*uv.lock'` | JS か Python か。lock ファイルから、npm・yarn・pnpm・bun・uv などの別 |
| タスクランナー・git hook | `ls Taskfile.yml Makefile mise.toml .mise.toml lefthook.yml .pre-commit-config.yaml .husky 2>/dev/null` | あるもの |
| CI | `ls .github/workflows` | 各ファイルの `on:` (動く条件)・`name:`・ジョブ名。`paths:` で飛ぶものはどれか |
| Claude のレビュー | `grep -rl -e claude-code-action -e claude-code-review .github/workflows` | あるか。起動のしかた (PR の作成・コメント) |
| デプロイ | `grep -il -e 'uses: .*deploy' -e 'gcloud run deploy' -e 'gcloud app deploy' -e aws-actions -e vercel .github/workflows/*` | 候補だけ。説明文・コメント・E2E のワークフローも当たるので、各ファイルの `on:` とジョブの中身 (デプロイするコマンドか) を読んで決める。動く条件 (main への push・`workflow_dispatch`)。デプロイ先 (Cloud Run・ECS・Vercel など)。環境の名前 |
| ロールバック | `ls .github/workflows/*rollback* 2>/dev/null` | あるか |
| DB とマイグレーション | `git ls-files -- '*migration*' '*alembic*' '*.sql' 'prisma/*'` | マイグレーションのパス |
| IaC | `git ls-files -- '*.tf'` と、`grep -l 'terraform' .github/workflows/*` | Terraform があるか。plan と apply が動く条件。apply がマージで動くか |
| compose | `git ls-files -- '*compose*.y*ml' '*Dockerfile*'` | アプリを `docker compose up` で起動できそうか |
| ルールセット | `gh api repos/{o}/{r}/rulesets` と `gh api repos/{o}/{r}/rules/branches/<デフォルトブランチ>` | 今ある必須のチェック・必須のレビュー。org のルールセットは `gh api repos/{o}/{r}/rulesets?includes_parents=true` で見る |
| デフォルトブランチ | `gh repo view --json defaultBranchRef,viewerPermission` と `gh api repos/{o}/{r} --jq .allow_auto_merge` | main か master。自動マージが有効か (`gh repo view` に自動マージのフィールドは無い)。自分の権限が admin か |
| 環境 | `gh api repos/{o}/{r}/environments` | 環境の名前と、保護ルール |
| Renovate | `ls renovate.json .github/renovate.json .renovaterc* 2>/dev/null` | あるか |
| `.claude/` | `ls .claude; cat .claude/settings.json` | 既存の設定。hooks・permissions |
| Issue のテンプレート | `ls .github/ISSUE_TEMPLATE; grep -rn 'autopilot:ready' .github` | `autopilot:ready` を自動で付けていないか |
| シークレット | `gh secret list` | `AUTOPILOT_APP_ID` などが既にあるか |

権限が足りずに `gh api` が失敗した項目は、「調べられなかった」と表に書き、interview.md でユーザーに聞きます。推測で埋めません。

## 結果の表
調べたら、次の形でユーザーに見せます。

| 項目 | 分かったこと | 根拠 (ファイル・コマンド) |
|---|---|---|
| 技術スタック | 例: JS (npm)・Python (poetry) | `package-lock.json`・`poetry.lock` |
| CI | 例: `ci.yml` (lint・test) | `.github/workflows/ci.yml` |
| デプロイ | 例: Cloud Run・main への push | `deploy.yml` |
| ... | ... | ... |
