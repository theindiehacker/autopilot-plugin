---
name: standard
description: 統一のアーキテクチャ (バックエンドはモジュラモノリス + ヘキサゴナル、フロントエンドは feature ベース、インフラは Terraform) の標準。モジュール・層・feature・Terraform のディレクトリを足す・変える・設計するとき、依存の向きの検査の設定をリポジトリに足すときに読む。使い方 → /architecture:standard [フォルダ]
argument-hint: "[フォルダ]"
---

# 標準
コードは次の構成で書いてください。言語ごとの書き方は「言語ごとの書き方」の references を読んでください。

## バックエンド (モジュラモノリス + ヘキサゴナル)
- 業務のまとまりごとにモジュールを作る (`<モジュール>/`)。フロントエンドの feature と同じ名前にする
- モジュールの中の層は、上から `core` → `middleware` → `port` → `application` → `domain` → `exception`。上の層は下の層を import できるが、逆はできない。要らない層は作らない
- `domain` を import できるのは `core`・`application`・`port/adapter/persistence`・`port/adapter/service` だけ。受け付ける側のアダプター (`resource`・`messaging`・`tool`) は `application` を通す
- モジュール同士は import しない。連携は次のどちらかにする
  - ドメインイベント (受け取る側は、相手のクラスを import せず、データとして受け取る)
  - 腐敗防止層 (`port/adapter/service/<相手>/adapter/`) から、相手の公開 IF (`port/adapter/resource`) を呼ぶ
- 全モジュールが使う技術的なコード (DB の接続・ログ・設定・基底クラス) は `shared/` に置く。`shared` からモジュールは import しない。`shared` の中に層は作らない
- モジュールを組み立てる側 (入口と DI) は、モジュールの外に置く

## フロントエンド (feature ベース)
- 画面のコードは、バックエンドのモジュールと 1 対 1 の `src/features/<モジュール>/` に置く
- `app` → `features` → 共通 (`components`・`lib` など) の向きにだけ import する
- feature は別の feature を import しない。両方が要る画面は、app の page で組み立てる
- app の外では `../` を使わず、`@/` から import する

## インフラ (Terraform)
- `infrastructure/modules/<役割>/` に部品、`infrastructure/environments/<環境>/` に環境ごとのルートを置く
- リソース名は `<project>-<env>-<role>`、Terraform の名前は snake_case
- すべてのリソースに `project`・`environment`・`managed_by` のラベル・タグを付ける
- state はクラウドのリモート (gcs・s3・azurerm) に置く

# 言語ごとの書き方
| 見分け方 | 読むもの | 検査の設定のテンプレート |
|---|---|---|
| `pyproject.toml` | [references/python.md](references/python.md) | `templates/python/importlinter.toml` |
| `go.mod` | [references/go.md](references/go.md) | `templates/go/architecture_test.go`・`templates/go/.golangci.yml` |
| `package.json` の依存に `next` | [references/nextjs.md](references/nextjs.md) | `templates/nextjs/biome.overrides.json`・`templates/nextjs/biome/` |
| `*.tf` | [references/terraform.md](references/terraform.md) | `templates/terraform/.tflint.hcl` |

テンプレートのパスは、このスキルのフォルダからの相対パスです。

# 検査の設定を足す
`/architecture:standard` で呼ばれたら、次の手順で行ってください。対象は引数のフォルダです。無ければリポジトリ全体です。

## 1. 調べて聞く
1. 「言語ごとの書き方」の表で、対象の言語とフォルダを見つける
2. 言語ごとに、検査の設定がすでにあるかを調べる。あれば、テンプレートとの違いを伝える。書き換えるのは頼まれたときだけにする
3. 今のディレクトリ構成が標準と違うとき (層の名前が違うなど) は、どう合わせるかをユーザーに聞く
4. 足す言語の一覧を見せて、どれを足すかユーザーに聞く

## 2. 足す
聞いた順に、1 つずつ足してください。足し方は、各 references の「検査」にあります。

## 3. 確かめる
references の「検査」の CI のコマンドを動かし、結果をユーザーに伝えてください。
- 違反があれば、ファイルと理由を一覧にして伝える。直すのは頼まれたときだけにする
- すぐに直さない違反は、references の「移行中の違反」の方法で許し、新しい違反だけを止める
- CI に検査が無ければ、CI に足せることを伝える

commit・PR は、頼まれたときだけ行ってください。
