# Go の書き方

## ディレクトリ構成
```
go.mod
.golangci.yml                # templates/go/.golangci.yml
cmd/
└── <入口>/main.go            # 組み立てる側 (api・subscriber・batch など)。設定を読み、モジュールを組み立てて起動する (検査しない)
internal/
├── architecture_test.go     # templates/go/architecture_test.go (依存の向きの検査)
├── shared/                  # 全モジュールが使う技術的なコード (DB の接続・ログ・設定・基底の型)。中に層は作らない
└── <モジュール>/
    ├── core.go              # package <モジュール>。DI・ルーティング・購読者の登録
    ├── application/<集約>/   # ユースケース (入力・出力の型とアプリケーションサービス)
    ├── domain/model/<集約>/  # エンティティ・値オブジェクト・リポジトリの interface・ドメインイベント
    ├── exception/           # エラーの種類
    └── port/adapter/
        ├── messaging/       # 他モジュールのドメインイベントを受ける
        ├── persistence/     # リポジトリの実装
        ├── resource/        # API (公開 IF)
        ├── service/         # domain のサービス interface の実装・腐敗防止層 (<相手>/adapter/)
        └── tool/            # MCP のツール
```
- テストは、確かめるファイルと同じディレクトリに `*_test.go` で置く
- `internal/` の直下には、`architecture_test.go` のほかにファイルを置かない
- `shared` の中に、層と同じ名前のディレクトリを作らない
- Go 1.21 以上 (`architecture_test.go` が `slices` を使うため)

## 検査
| 何を | 道具 | 設定 |
|---|---|---|
| 層の向き・domain を使える層・モジュールの独立 | `go test` | `internal/architecture_test.go` |
| lint・整形 | golangci-lint・gofmt | `.golangci.yml` |

- 入れ方: `templates/go/architecture_test.go` を `internal/`、`templates/go/.golangci.yml` を `go.mod` の隣に写す。モジュールは `internal/` から見つけるため、書き換えは要らない
- CI: `go test ./...` と `golangci-lint run ./...` (GitHub Actions は `golangci/golangci-lint-action`)
- go プラグインは、編集したファイルを gofmt で整え、commit の前に golangci-lint と `architecture_test.go` を動かす
- 見るのは直接の import だけ (import-linter と違い、間接の import はたどらない)

## モジュールを足す
1. `internal/<モジュール>/` を上の構成で作る
2. `cmd/<入口>/main.go` で組み立てる

## 移行中の違反
直していない違反は、`architecture_test.go` の `exceptions` に並べ、直したら消します。新しい違反は止まります。
```go
var exceptions = []string{
	"billing/domain/model/invoice -> billing/application/invoice",
}
```
