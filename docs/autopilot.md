# 🤖 autopilot (Issue からマージまで)

[← README に戻る](../README.md)

`autopilot:ready` が付いた Issue から、人が触らずに PR のマージまで進みます。人がするのは、CODEOWNERS のパスを変える PR の承認と、止まったときの判断です。

## 流れ

| 順 | だれが | すること |
|---|---|---|
| 1 | 人 | Issue を書く。権限のある人 (triage 以上) が `autopilot:ready` を付ける |
| 2 | ルーティン | 起動して、Issue のラベルを確かめる (`autopilot:ready` が無いか `needs-human` があれば、何もしない)。ブランチ `autopilot/<番号>-dev` と、`Closes #<番号>` を入れた Draft PR を作る |
| 3 | ルーティン | 受入条件を Issue にコメントする。条件を確かめるテストを書き、失敗するのを確かめてから実装する |
| 4 | ルーティン | アプリを起動して受入条件を確かめ、PR の本文に動作確認とエビデンスを書く (これが QA。別の Claude による確かめ直しはしない)。「レビュー可能」にして自動マージを有効にし、PR を購読する |
| 5 | GitHub Actions | Claude のレビューが動く。CODEOWNERS のパスを変える PR は、GitHub が持ち主にレビューを頼む |
| 6 | ルーティン | Request changes・CI の失敗があると、購読の通知でセッションが起きる。`autopilot:fix` の手順で、指摘ごとに採否を決めて、直して push し、返信する |
| 7 | GitHub の標準の仕組み | 必須のチェックと必須のレビューがそろうと、自動マージでマージされる |
| 8 | リポジトリ | マージの後は、リポジトリのデプロイの仕組みが動く (デプロイがあるリポジトリだけ)。autopilot は、デプロイを動かさず、確かめません |

ルーティンの持ち主が PR に書いたコメントでは、セッションは起きません (同じアカウントの書き込みは通知されないため)。直してほしいときは、ルーティンの commit の `Claude-Session:` の行のリンクから、そのセッションに直接書いてください。

## ラベル

| ラベル | 付く先 | 付ける人 | 意味 |
|---|---|---|---|
| `autopilot:ready` | Issue | triage 以上の権限がある人 | 開発を始めてよい。ルーティンが起動する |
| `needs-human` | Issue・PR | ルーティン | 止まった。人の判断が要る |

## 止まる条件と、再開のしかた

主に次のときに、`needs-human` を付けて止まり、理由を `<!-- autopilot:needs-human -->` 付きのコメントに書きます。

- 対応を 3 回行った後に、また失敗した (回数は `.github/autopilot.yml` の `limits.max_fix_rounds`)
- 同じ失敗が 2 回続いた
- Issue があいまいで受入条件が書けないなど、ルーティンが進めない (質問と案を書く)
- 同じ head で、PR が 2 回 Draft に戻された (1 回目は、直すことが無いので「レビュー可能」に戻した)

`needs-human` の付いた Issue・PR では、ルーティンは動きません。再開するには、答えを Issue にコメントし (読まれるのは、権限が triage 以上の人のコメントだけです)、Issue の `needs-human` を外します。続けて、Issue の `autopilot:ready` を一度外してから、付け直します。ルーティンは Issue にラベルが付いたときに起動するので、`needs-human` を外すだけでは起動しません。

起動しなかった Issue と、通知が来ないまま止まった PR は、自動では拾いません。気づいたら、Issue は `autopilot:ready` を一度外してから付け直します。PR は、ルーティンの commit の `Claude-Session:` の行のリンクから、そのセッションに直接書きます。

## 人がすること

| こと | 条件 |
|---|---|
| CODEOWNERS のパスを変える PR の Approve | `/autopilot:setup` が CODEOWNERS を入れたリポジトリだけ。GitHub のレビューの依頼で届く |
| `needs-human` への答え | 止まったとき。Issue にコメントして、再開する |
| Slack の通知を見る | GitHub の Slack アプリを購読したチャンネルに届く。例: `/github subscribe <owner>/<repo> issues pulls comments +label:"needs-human"` |
| 起動しなかった Issue・止まった PR に気づく | 自動では拾わない。上の「止まる条件と、再開のしかた」のとおり、付け直すか、セッションに直接書く |

## setup の後にすること

`/autopilot:setup` は、`.github/autopilot.yml`・CODEOWNERS (無ければ、Claude のレビューと CI のワークフローも) を入れた PR を作ります。ラベル 2 つは、PR とは別に、同意の後すぐにリポジトリに作ります。autopilot のためのワークフローは置きません。次は、画面でしかできないので、手順を案内されてユーザーがします。setup は、PR を作るときに、1 つの一覧にして頼みます。

| こと | 中身 |
|---|---|
| Claude の GitHub App | https://github.com/apps/claude をリポジトリに入れる。Claude のレビューが、PR にレビューを書くために要る。既存の Claude のレビューを使うときも、入っているかを確かめる |
| シークレット | setup が Claude のレビューのワークフローを置いたときだけ。`CLAUDE_CODE_OAUTH_TOKEN` か `ANTHROPIC_API_KEY` |
| GitHub の Slack アプリ | Slack で `/github signin` を打つ。GitHub の側に Slack のアプリを入れてリポジトリを選ぶ。通知先のチャンネルで `/github subscribe …` を打つ |
| Web の環境 | README の「プラグインを入れる」の手順 |

PR がマージされたら、setup が続きを行います。ユーザーが「マージした」と答えるか、PR の状態が `MERGED` になると、setup が `gh` と RemoteTrigger で作ります。ルールセットを先に作ると、この PR も必須のレビューを待つことになります。ルーティンは、デフォルトブランチの `.github/autopilot.yml` を読みます。

| こと | 中身 |
|---|---|
| ルールセット | 必須のチェック (CI のジョブ。必須にできる CI が無ければ無し)・必須のレビュー 1 件・push で古い Approve を取り消す・コードオーナーのレビューを必須にする。自動マージを許可する。ワークフローの既定の権限を読み取りだけにし、Actions が PR を Approve することを禁じる |
| ルーティン | プロンプトは `/autopilot:develop`、トリガーは `issues.labeled`。ルーティンは、ログインしている claude.ai のアカウントのものになる |

## 注意

- これらのツールで検出できない脆弱性もあります。
- 受入条件の確かめ (QA) は、ルーティンが PR の本文に書く動作確認だけです (自己申告。受入条件ごとのエビデンスが付きます)。別の Claude が確かめ直すことはありません。
- 必須にできる CI が無いリポジトリでは、必須のチェックが無いので、CI の結果を待たずに、Claude のレビューの承認だけで自動マージされます。
- 公開リポジトリでは、だれのコメントも、自動モードのルーティンのセッションに入ります。autopilot のリポジトリだけに届く、自動化専用の GitHub アカウントを使うことを勧めます。
- Terraform の apply がマージで動くリポジトリでは、CODEOWNERS の Approve の後に、取り消せない操作が自動で走ります。apply を、手動のワークフローか別のリポジトリにすることを勧めます (setup は案を出すだけで、作りません)。
- デプロイは、autopilot ではなく、リポジトリのデプロイの仕組みが動きます。autopilot は、デプロイを動かさず、確かめません。デプロイの失敗は、GitHub の Slack アプリの購読 (`/github subscribe <owner>/<repo> workflows:{event:"push" branch:"<デフォルトブランチ>"}`) で知らせられます。成功も届くので、`needs-human` とは別のチャンネルで購読します。
