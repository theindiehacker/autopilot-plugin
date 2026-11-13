# #40 の引き継ぎ (2026-11-12)

PC の Claude Code のセッションから、Claude Code on the Web のセッションに引き継ぐための記録。設計書は `docs/superpowers/specs/2026-11-12-autopilot-dev-flow-design.md`、計画は `docs/superpowers/plans/2026-11-12-autopilot-dev-flow.md`。進め方は superpowers:subagent-driven-development (タスクごとに実装役とレビュー役のエージェントを分ける)。

試験に使うリポジトリの名前は、公開リポジトリなのでここに書かない。セッションを始めるときに、ユーザーから伝えてもらう。

## 状態

| タスク | 状態 |
|---|---|
| 1 作る前の確かめ | 完了 (結果は設計書 9.1)。試験用に作ったものの片付けが残る (下の「片付け」) |
| 2〜7・21 判定のコード (`automation/`) | 完了。テスト 157 件 (取り消せない変更の確認を CODEOWNERS に替えて減った) |
| 8 GitHub の呼び出しと CLI | 完了 (5 回の修正。本番へのデプロイの規則は下の R18〜R25) |
| 9 composite action とワークフローのひな形 | 完了 |
| 10〜12 開発のスキル、QA・対応のプロンプト | 完了 |
| 13 onboard を setup に改名 | 完了 |
| 14 setup の手順 | 完了 |
| 20 検査の hook をリポジトリの lefthook に移す | 完了 |
| 15 試験 1 (デプロイの無いテンプレートのリポジトリ) | 完了 (下の「試験 1 の結果」と「2026-11-13 までに変えたこと」) |
| 16〜18 試験 2〜4 | 未着手。試験 2 の setup の 1 (調べる) を始めたところで、セッションを区切った (結果は残っていない。やり直す) |
| 19 README と完了の確かめ | 未着手 |
| ブランチ全体のレビュー | 未着手 (最も性能の高いモデルで行う) |

プラグインの PR は #46 (CI はすべて通っている。試験が終わるまでマージしない)。

### 2026-11-12 の Web のセッションでしたこと

- セキュリティの自動レビューの指摘 2 つを直した。QA と対応の job は、デフォルトブランチの `mise.toml` でツールを入れ、shim を PATH に足さない。`in-git-files.sh` は、元の mise の設定が信頼済みのときだけ一時フォルダを信頼する
- 試験 1 の setup の PR を最新のひな形で作り直し、claude[bot] のレビュー 6 回の必須の指摘を直した (プラグインのひな形に戻して直し、PR は描き直した)
  - fix の起動を、`pr` 付きの手動の実行・設定のレビュアー (`{{REVIEWER}}`、新しい置き換え文字列)・`autopilot/` のブランチ・CI の `failure`/`timed_out`/`startup_failure` に絞った
  - ベースの変更 (`edited` の `changes.base`) で `autopilot/irreversible` を付け直す
  - QA と対応の job の中の commit では git の hook を止める (`LEFTHOOK=0`・`HUSKY=0`・`core.hooksPath=/dev/null`)
  - setup-bun・setup-uv のキャッシュを、PR のコードの後に保存しない
  - すべての job に `permissions` と `timeout-minutes` (ghalint)。zizmor の `dangerous-triggers` は、リポジトリの `.github/zizmor.yml` に行番号で除外する (組織の CI がインラインの除外を禁じるため)
  - 対応の Claude が失敗しても `ready` で Draft から戻す
  - 編集後の hook: 入っている Biome だけを動かす (`bunx` をやめた)、`uv run --frozen`、Ruff は `--force-exclude` で、F401 を自動で直さない
- 組織の CI のために `automation/` に knip を入れ、試験用の偽の鍵の 1 件を `.gitleaksignore` で除いた

### 試験 1 の結果

- setup の PR をマージし、ルールセットとルーティンをユーザーに作ってもらった (App の ID はユーザーに聞く)
- 本流が通った: Issue → 受入条件 → PR → claude[bot] の承認 → `autopilot/irreversible` → QA (スクリーンショットを残す) → 自動マージ → Slack の「対応が終わりました」。ルーティンからの git push と PR の作成ができた (設計書 9.1 の未確認の行)
- 止まる条件: `documentation` のラベルだけの Issue では何もしない。直せない Issue は `needs-human` になり、Slack に 1 回知らせる
- `.github/` を変える PR は、`autopilot/irreversible` が承認を待ち、Slack に承認の依頼が届いた。作者のほかに承認する人がいないので、管理者が迂回してマージする (ルールセットの bypass)
- 見つけて直した不具合
  - 開発のルーティンが、同じ Issue で 6 秒差で 2 回動いた → 開始の印を書いた後に読み直し、先に書いたほうだけが進む
  - QA が、確かめていない条件を残したまま合格にした → 確かめられなかった条件は不合格にし、テストのような条件は CI の check run の結果で決める
  - QA の Claude が、アプリの MCP サーバーのツールを呼べない → `actions/claude` の `mcp-servers` で登録する (ひな形の `{{QA_MCP_SERVERS}}`)
- ユーザーの感想: Issue に残っていた「決めたいこと」を、開発が自分で決めて進めたのは問題なかった
- ユーザーの要望で、開発を空の Draft PR (`autopilot/<番号>-dev`) で始めるようにした (プロジェクトの画面で作業中と分かる)。成果物がずれそうなときは、Issue に質問と案を書いて `needs-human` で止まる。試験で、Draft PR → 受入条件と「決めたこと」 → 自動マージまで通った (約 12 分)
- 開発のルーティンは、GitHub の MCP の `update_pull_request` で、PR の本文の書き換えと Draft の切り替えができた (設計書 9.1 の 5)。ユーザーの判断で、GitHub Actions に頼む予備の道は消した
- **ルーティンの環境は、設定のスクリプトの結果を写し (キャッシュ、約 7 日) にして使い回す。** プラグインをブランチから入れていると、写しを作った時のプラグインのまま動く。プラグインを変えて試すときは、環境の設定のスクリプトを変えて (コメントを 1 行変えるだけでよい) 写しを作り直す

### 2026-11-13 までに変えたこと (ユーザーとの試験の中で決めた)

- 開発は空の Draft PR (`autopilot/<番号>-dev`) で始め、終わったら GitHub の MCP (`update_pull_request`) で本文を書き換えて「レビュー可能」にする (試験で通った。断られたら `needs-human`)
- 成果物がずれそうなときは、Issue に質問と案を書いて `needs-human` で止まる。小さな選択は自分で決め、「決めたこと」に書く
- 開発と対応は、レビューの前に自分で動作確認し (`skills/qa/self-check.md`)、エビデンスを本文の `## 動作確認 (<sha7>)` に書く。GitHub Actions の QA (別の Claude) も必須のチェックとして残す
- QA の Claude に、アプリの MCP サーバーを登録できる (`actions/claude` の `mcp-servers`)
- 取り消せない変更の確認は、`autopilot/irreversible` をやめ、CODEOWNERS とルールセット (コードオーナーのレビューを必須・push で古い承認を外す) にした。初めの値は autopilot を動かす設定 (`.github/`・`.claude/`・`.mcp.json`・git の hook の設定)・マイグレーション・Terraform。デプロイを自動で戻さない判定は `deploy.irreversible_paths`
- 検査と起動は、タスクランナーの 4 つのタスク (`style:check`・`style:fix`・`security:check`・`dev:up`) にそろえた (#47)。Claude は作業を終えるとき (Stop の hook、30 分、QA では動かない) に `style:fix` → `style:check`。`qa.start` は `task dev:up`
- 途中の進み具合を送らない: プラグインの SessionStart の指示で、書くのは人に聞くときと終わったときだけにした
- GitHub App・Slack App は manifest で作り、組織で 1 つを共有する (setup の 7-A〜7-C)
- 試験 1 のリポジトリには、ここまでをすべて入れた (ワークフローの版はこのブランチの `c7868e9`)
- Issue の整理: #45 は不要として閉じた。#47 は、このブランチで済んだ (マージで閉じる)

## 次にすること

1. **試験 2 (マージで本番へデプロイするリポジトリ):** setup の 1 (調べる) からやり直す。聞くことは 1 回にまとめる。Terraform の apply がマージで動くなら、手動のワークフローか別のリポジトリにする案を勧める (作りはしない)
2. **試験 3・4:** 試験の範囲は下のとおり
3. **README (Task 19):** 古い記述が残っている。編集後の hook・`qa.start` の長いコマンド・`demo.svg`・`skills/setup/SKILL.md` の description (「編集後・commit 前・push 前の検査」)
4. **ブランチ全体のレビュー** (最も性能の高いモデルで。下の「残りの指摘」を直すかを決める)
5. **#46 のマージの後:** `v2.0.0` のタグを打ち、各リポジトリの `{{AUTOPILOT_REF}}` をタグの SHA に固定し直す (このブランチの commit は消えることがある)
6. **プラグインの開発の手順を変えて試すとき:** ルーティンの環境の設定のスクリプトを、ユーザーに少し変えてもらう (写しを作り直す。下の「写し」)

試験の範囲 (2026-11-12 にユーザーが指示):
- デプロイを別のリポジトリで行うリポジトリ: Issue からマージまで
- マージで本番へデプロイするリポジトリ 2 つ (うち 1 つは Cloudflare に Astro をデプロイし、docker compose と DB が無い): Issue から本番へのデプロイまで
- 他社のリポジトリ 3 つ: PC の Claude Code で、手元で setup を動かすだけ (Web のセッションでは行わない)
- 計画の試験 3 (`dispatch` 方式) は今回の範囲に無い。`dispatch` は未試験のまま残る
- 自分の PR は承認できないので、守るパスを変える PR は、管理者が迂回してマージする (ユーザー以外の GitHub アカウントが無い)

Web のセッションで気をつけること:
- 作業フォルダが複数のリポジトリの親 (`/home/user`) だと、SessionStart の hook がそのリポジトリの Docker の準備 (プロキシの CA) をしない。そのリポジトリで `docker compose` を動かすときは、`scripts/cloud/setup.sh` と同じく `.claude/session/compose.proxy-ca.yaml` を作り、`COMPOSE_FILE` に足す
- セッションの機械が作り直されると、dockerd が止まっていることがある。`containerd` と `dockerd --registry-mirror=https://mirror.gcr.io` を起動し直す
- commit 前の lefthook がタスクを呼ぶリポジトリでは、`mise exec -- git commit` で、mise のツールを PATH に入れて commit する

## プラグインの残りの指摘 (試験 1 のレビューで出て、直していないもの)

ブランチ全体のレビューで、直すかを決める。

| 指摘 | メモ |
|---|---|
| QA を Draft で `if:` で飛ばすと、skipped が必須のチェックを通る | 承認を必須にするリポジトリでは、push で承認が外れ、新しい承認より先に QA が pending になるので通らない。承認を必須にしないリポジトリで効く |
| QA の job で、PR のプロセスと書き込みのトークン・Claude の認証が同じ runner に同居する | 設計の既知の残りのリスク (R28)。アプリを別のユーザーやコンテナで動かす案 |
| fix の PR の checkout がブランチ名で、`fix-round` が確かめた SHA ではない | 確かめた SHA を出力し、それを checkout する |
| `irreversible-plan` は workflow の名前だけで動き、fork の PR の plan の実行でも、その artifact を読む | fork が plan の JSON を作れるなら、削除の無い plan で success にできないか (セキュリティ) |
| `label` の Bot の条件を、App の slug に絞る | CLI が中で書いた人を確かめ直すので、今は無駄に動くだけ |
| `qa.start`・`review.reviewer` がワークフローに手で写されている | デフォルトブランチの checkout の `.github/autopilot.yml` から読む形にする |
| QA と fix で、ツールを入れる手順が重複している | composite action にまとめる |
| mise-action の `install_args` と mise の版を固定していない | 試験で時間を見て決める |
| zizmor の除外が行番号で、ワークフローを書き直すとずれる | ファイルごとの除外にするかは、承認する人が決める |
| hook の `up()` が `/` で止まらない | `[ "$d" = / ] && return 1` を足す (#47 で hook ごと入れ替えるなら不要) |
| setup-bun・setup-uv の `hashFiles` がルートの lock だけを見る | `frontend/`・`backend/` に lock があるリポジトリで効かない |
| hook の `uv run` が新しい checkout で同期する | #47 で入れ替えるなら不要 |
| `dev:down` の `pkill -f '[n]ext dev'` が、ほかの worktree の `next dev` も止め、子の `next-server` が残りうる | PID かプロセスグループで止める (Task のシェルでは `$!` を当てにできない) |
| `dev:up` を 2 回動かすと、前の `next dev` に待ちの curl が通る | 前のものを止めてから起動するか、ポートが使われていれば失敗にする |
| `actions/autopilot` の `profile` の入力が使われていない (どれも同じ権限) | 消すか、権限を分けるか |
| 起動に失敗したときのログを残さない | ログに秘密が出うるので、出し方を決める |
| `deploy: none` でも deploy の job が動く | Slack の `done` を送るため。設計どおり |
| 手元の bun 1.4 で、automation のテスト 12 件が YAML の読み取りで落ちる | テストの入力のフロー形式の `claude[bot]` が 1.4 の YAML で不正。固定の 1.3.10 では通る |

## Issue の整理

- #45 (プラグインの更新を各リポジトリに自動で反映する) は、不要とユーザーが判断した (2026-11-12)。not planned で閉じた

## 片付け (試験がすべて終わってから、ユーザーに確かめて行う)

- 済み: 試験 1 のリポジトリの Issue #195・PR #194・ラベル `autopilot:spike` を片付けた
- ユーザーに頼んだ (済んだかを確かめる): 試験用のルーティン 2 つ (`autopilot 試験 A`・`autopilot 試験 B`。API では消せない)、ブランチ `autopilot-spike-*` (Web のセッションからは消せない)

## 承認の試験

(2026-11-12) 承認は CODEOWNERS で求める形になった (R46)。自分の PR は Approve できないことは変わらない。

ルーティンはユーザーの個人のアカウントで動くので、AI の PR の作者もユーザーになる。GitHub では自分の PR を Approve できないため、取り消せない変更の承認の試験には、ユーザー以外の GitHub のアカウント (自動化専用のアカウントなど) が要る。ユーザーは今は持っていない。

## 設計者 (Claude) が決めたこと

それぞれ、間違っていたときの影響を添える。ユーザーに見直してもらう。

| | 決めたこと | 間違っていたときの影響 |
|---|---|---|
| R2 | 見回りの付け直しの回数 = `autopilot:ready` が付いた回数 − 1 | 付け直しが 1 回多いか少ない |
| R3 | 承認の依頼は、Slack に送ってから印のコメントを書く | まれに Slack が 2 回届く |
| R6 | 必須のチェックの `paths: []` は、絞り込みなし | 止めたつもりのチェックを待つ |
| R7 | (やめた) Terraform の plan による承認。2026-11-12 に、取り消せない変更の確認を CODEOWNERS に替えた (R46) | — |
| R9・R10・R12 | 人ごとの最新の判定だけを数え、取り下げは判定なし。Claude の判定は最新のコミットへのものだけ。同じ時刻なら後のもの | 数えるべき承認を数えない (安全側) |
| R16 | 状態はコメントの印で伝え、ルーティンの持ち主と App が書いた印だけを受け付ける | 印の読み取りの細かな漏れ |
| R18・R21 | 失敗の Issue にはコマンドの出力を書かず、印はハッシュにする | Issue の情報が少ない |
| R19 | `.github/`・`.claude/`・`.mcp.json`・git の hook の設定は、CODEOWNERS の初めの値で人の承認を求める (AI の PR が自分の検査を変えられないように) | 設定の PR に人の承認が要る |
| R20・R23・R24 | ロールバックは、デプロイが `failure` のときか、確認が失敗したときだけ。結果が分からないとき (見つからない・時間切れ・取り消し・API の失敗) は止めて人に回す。デプロイは 1 つずつ動かす | 自動で戻せた失敗にも人の判断が要る |
| R25 | 設定が読めないデプロイも、Issue と Slack で知らせる | 知らせが増える |
| R26 | 対応のジョブは、設定のレビューの bot か書き込み権限のある人のレビューでだけ起動する | 正当なレビューで起動しない |
| R27 | QA は別のワークフローにする (飛ばされたジョブが必須のチェックを通さないように) | リポジトリのファイルが 1 つ増える |
| R28・R29 | App のトークンはジョブごとに権限を絞り、PR のコードより前に作る。AI に環境変数を表示させない。App は autopilot のリポジトリにだけ入れる | PR のコードが App の鍵を読む危険は残る (秘密を持つ CI に共通) |
| R30 | 開発のルーティンは、開始の印か PR がすでにあれば何もしない | やり直すときはラベルを付け直す |
| R31・R34 | Cloud Run のロールバックは、正常で動いていない最新の版に戻す。失敗した版は、リポジトリの変数 `AUTOPILOT_BAD_REVISIONS` に記録する (タグは公開の URL を作るので使わない) | App に Variables の権限が要る |
| R32 | ルールセットで、必須のチェックを付けてよい相手を GitHub Actions に限る。コードオーナーのレビューを必須にする。ワークフローの既定の権限を読み取りだけにする | — |
| R33 | ルールセットとルーティンは、setup の PR のマージの後に作る | setup が 2 回に分かれる |
| R35・R36 | CI の失敗からの対応は、同じリポジトリの最新のコミットのときだけ。lefthook の設定は、場所と形式を問わず守る | — |
| R37 | 各リポジトリは、プラグインの action をコミットの SHA で固定する | 版を上げるときに SHA を書き換える |
| R38 | 試験の間は、`{{AUTOPILOT_REF}}` を、このブランチの commit の SHA と行末の `# feat/40-autopilot-dev-flow` にする (`v2.0.0` のタグがまだ無い) | Renovate が版を読めず、更新しない |
| R39 | QA と対応の job の中の commit では git の hook を止める。検査は push の後の CI が行う | CI の失敗が push の後で見つかり、対応がもう一度動く |
| R40 | `in-git-files.sh` は、元のフォルダと親の mise の設定を確かめるだけで、サブフォルダの mise.toml は確かめずに信頼する (呼び出し元はルートで検査するだけ) | サブフォルダでコマンドを動かす呼び出し元が増えると、信頼していない設定が動く |
| R41 | 試験用の偽の鍵は、履歴を書き換えず `.gitleaksignore` で 1 件だけ除く | 履歴から消したいなら、マージで squash する |
| R42 | レビューの指摘のうち、設計の範囲・既知のリスク・組織の書き方に関わるものは、直さず理由を返信した (上の「残りの指摘」) | ブランチ全体のレビューで直す |
| R44 | 開発のブランチ名を `autopilot/<番号>-dev` に固定し、push の拒否で二重の起動を防ぐ。開発中の Draft (本文に `<!-- autopilot:developing -->`) には対応のジョブを動かさない | 前の試みのブランチが残っていると、`needs-human` になる |
| R45 | 成果物がずれそうなときの聞き方は、Issue のコメントと `needs-human` (Slack に届く)。セッションの中で聞く方法は、知らせが無く、持ち主しか答えられないので採らない | 答えた後に `autopilot:ready` を付け直す手間がある |
| R46 | (ユーザーの判断) 取り消せない変更の確認は、`autopilot/irreversible` をやめ、CODEOWNERS とルールセットの「コードオーナーのレビューを必須」にする。Terraform の apply は手動のワークフローか別のリポジトリを勧める。デプロイを自動で戻さない判定は `deploy.irreversible_paths` に残す | 承認の依頼は Slack ではなく GitHub のレビュー依頼になる |
| R47 | (ユーザーの判断) 開発と対応は、レビューの前に自分で動作確認し (`skills/qa/self-check.md`)、エビデンスを本文の `## 動作確認 (<sha7>)` に書く。GitHub Actions の QA (別の Claude) も必須のチェックとして残す | QA の費用は 2 回分 |
| R43 | QA に登録するアプリの MCP サーバーは、設定ファイルではなく QA のワークフローの `mcp-servers` に書く (`qa.start` と同じく、ワークフローが読む値) | 設定とワークフローの写しが 1 つ増えない代わりに、設定ファイルからは見えない |

## ユーザーへの確認が要ること

- GitHub App に Variables (Read and write) の権限を足す (ロールバックを使うリポジトリだけ)
- デプロイの設定にロールバックの方法が無いリポジトリでは、デプロイの失敗はすべて `needs-human` になる (setup はロールバックのワークフローを提案する)
