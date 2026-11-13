# GitHub Actions の QA と見回りをやめる Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** autopilot から、GitHub Actions の QA (`autopilot QA`、別の Claude が確かめ直す) と、見回り (1 時間ごとの `sweep`) を消す。QA は、開発のルーティンが PR を出す前に行う動作確認 (`skills/qa/self-check.md`、PR の本文の `## 動作確認 (<sha7>)`) だけにする。

**Spec:** `docs/superpowers/specs/2026-11-12-autopilot-dev-flow-design.md` (この計画で書き直す)

## ユーザーが決めたこと (2026-11-13)

| | 決めたこと |
|---|---|
| U5 | QA と見回りのワークフローは要らない。QA の自己申告 (開発のルーティンの動作確認) を許す |
| U6 | 入れ済みの試験のリポジトリ 2 つからも消す (それぞれの PR で行う。この計画の外) |

## 計画で決めたこと (設計者)

| | 決めたこと | 間違っていたときの影響 |
|---|---|---|
| R54 | GitHub App・シークレット (`AUTOPILOT_APP_ID`・`AUTOPILOT_APP_PRIVATE_KEY`)・QA 用の `CLAUDE_CODE_OAUTH_TOKEN`/`ANTHROPIC_API_KEY` は、setup から外す (使うところが無くなるため)。Claude のレビューのワークフローを setup が置くときに要る認証は、残す | レビューのワークフローの認証の案内が欠ける |
| R55 | `automation/`・`actions/` は丸ごと消す (見回りと QA だけが使っていたため) | 後で見回りを戻すときに作り直しが要る |
| R56 | 見回りが拾っていた「起動しなかった Issue」「止まった PR」は、自動では拾わない。開発のルーティンが止まるときは、これまでどおり `needs-human` を付ける。同じ head で 2 回 Draft に戻された PR は、対応が `needs-human` で止める | 起動しなかった Issue は、人が気づくまで進まない |
| R57 | CODEOWNERS のセキュリティの設定・除外のファイルの行は、ファイルが無くても残す (AI の PR が新しく作って検査を弱めないように) | 持ち主の承認が要るパスが増える |
| R58 | `.github/autopilot.yml` の `limits.stale_hours`・`limits.ready_retry_minutes` は消す (見回りだけが読んでいた)。`required_checks` は、ルールセットに入れるチェックの記録として残す (コードは読まない) | 古い設定が残っていても害は無い |

## Global Constraints

- 文書・スキルは、既存のファイルと同じ書き方にする (短い文。1 文に 1 つのこと。「〜します」の体。漢語より和語)
- コミットのメッセージは `<場所>: <何をしたか>`。末尾に、会話の指示どおりの `Co-Authored-By` と `Claude-Session` の 2 行を付ける
- 公開リポジトリなので、試験のリポジトリの名前を commit するファイルに書かない
- 同梱のプラグインのスキルは、呼ぶだけにして作り直さない
- ラベル: `autopilot:ready`・`needs-human` の 2 つ (名前を変えない)。コメントの印は `<!-- autopilot:needs-human -->`・`<!-- autopilot:fix-round -->` と、対応の手順が使う印だけを残す (`wake`・`head` は消す)

---

### Task 1: QA と見回りを、設計書・コード・スキル・setup・README から消す

**Files:**
- Delete: `automation/` (全部)、`actions/` (全部)、`skills/qa/SKILL.md`、`skills/setup/templates/autopilot-workflow.yml`・`autopilot-qa-workflow.yml`・`github-app-manifest.json`・`github-app-create.html`
- Modify: 設計書、`skills/develop/SKILL.md`・`skills/fix/SKILL.md`・`skills/qa/self-check.md`・`skills/qa/evidence.md`、`skills/setup/` の `SKILL.md`・`survey.md`・`interview.md`・`autopilot.md`・`checks.md` (QA・`AUTOPILOT_QA` に触れる行)・`templates/autopilot.yml`・`templates/CODEOWNERS`・`templates/claude-settings.json` (`AUTOPILOT_QA` の分岐)・`templates/pr-body.md`、`README.md`、`renovate.json` と `.claude-plugin/plugin.json` (消したものへの言及があれば)

- [ ] **Step 1: 消す。** 上の Delete を消す。リポジトリ全体で `grep -rn "autopilot QA\|autopilot-qa\|actions/claude\|actions/autopilot\|sweep\|見回り\|AUTOPILOT_APP\|AUTOPILOT_QA\|stale_hours\|ready_retry_minutes\|autopilot:wake\|autopilot:head\|github-app-manifest\|github-app-create"` を、`docs/superpowers/plans/` (過去の記録) と `.superpowers/` の外で 0 件にする (設計書の 9.1 と 12 章の過去の記録は残してよい)
- [ ] **Step 2: 設計書を書き直す。** 1 章 (QA の言い方)・2 章 (失敗とみなすこと「AI の自己申告で完了にする」を U5 に合わせて直す)・3 章 (「完了・マージの条件は失敗しうる検査がすべて通ること」と、見回りの行)・4.1 の表 (QA の行は「開発のルーティンの動作確認」、見回りの行を消す)・4.2 (印の表から `wake`・`head`、`needs-human` を付ける人から見回りを消す)・4.3 の 4〜7・4.4 (見回りの行を消し、R56 を足す)・4.5 (節ごと消し、番号を詰めるか「(2026-11-13 にやめた)」と 1 行にする)・4.6 (必須のチェックから QA を消す)・4.9 (App のトークンの行)・4.10 (QA のジョブの行)・5 章 (設定の例)・6.1・6.2 (表から QA と見回り。autopilot が置くワークフローは無くなる。Claude のレビューと CI だけ)・7.2 (App・シークレットの手順)・8 章 (QA のジョブの行・R28 に当たる話)・10・11 章 (QA のエビデンス → 動作確認のエビデンス)・12 章に U5・U6・R54〜R58 を足す
- [ ] **Step 3: スキルを直す。** develop と fix から、QA のジョブ・QA の結果のコメント・QA の失敗の通知・App のボットのコメント・起こすコメント (`wake`) への言及を消す。fix の「同じ head で 2 回 Draft に戻された」ときは `needs-human` で止める (R56)。self-check.md の「そのあと、GitHub Actions の autopilot QA が…」の段落を消し、動作確認が最後の QA であることを書く。evidence.md から QA の GitHub Actions の話 (`$RUNNER_TEMP` など) を消す
- [ ] **Step 4: setup を直す。** autopilot.md: 手順 3 (ワークフローを 2 つ書く) を消す。手順 6 から GitHub App (6-A・6-B・権限の照らし合わせ)・シークレットを消す (Claude のレビューのワークフローを置くときの認証の案内は残す)。手順 8 のルールセットの例から `autopilot QA` を消す (CI のチェックだけ。CI が必須にできないときは、必須のチェックは無しで、そのことを PR の本文に書く)。「入れ済みのリポジトリを新しい形に移す」に、`autopilot.yml`・`autopilot-qa.yml` を消す・ルールセットから `autopilot QA` を外す・App とシークレットを消す、を足す。番号を詰め、中の参照も直す。survey・interview・SKILL.md の言及も直す。`templates/autopilot.yml` から `stale_hours` と `autopilot QA` を消す (R58)。CODEOWNERS は R57
- [ ] **Step 5: README を直す。** 流れの表・ラベル・止まる条件・人がすること・setup の後にすること・注意から、QA のジョブ・見回り・GitHub App・シークレットを消す
- [ ] **Step 6: 確かめる。** Step 1 の grep。`claude plugin validate .` (あれば)。試験のリポジトリの名前で `git grep -nI` して 0 件
- [ ] **Step 7: Commit** (場所ごとに分けてよい。例 `docs: 設計書から QA と見回りを消す`・`skills: …`・`automation: 見回りのコードを消す`)
