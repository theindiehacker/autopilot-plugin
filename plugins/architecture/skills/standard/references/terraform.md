# Terraform の書き方

## ディレクトリ構成
```
infrastructure/
├── .tflint.hcl                 # templates/terraform/.tflint.hcl
├── modules/
│   └── <役割>/                 # 再利用する部品 (api・storage・database など)
│       ├── main.tf
│       ├── variables.tf        # variable はここだけに書く
│       ├── outputs.tf          # output はここだけに書く
│       ├── versions.tf         # required_version・required_providers (下限 >= で書く)
│       └── README.md
└── environments/
    └── <dev|stg|prod>/         # 環境ごとのルート。modules を呼んで組み立てる
        ├── main.tf
        ├── variables.tf
        ├── outputs.tf
        ├── versions.tf         # required_version・required_providers (~> で固定する)
        ├── providers.tf        # provider ブロック。ラベル・タグの既定値もここで付ける
        ├── backend.tf          # state の置き場所
        ├── terraform.tfvars    # 秘密の値は書かない
        └── .terraform.lock.hcl # commit する
```
- 環境は workspace ではなく、ディレクトリで分ける (環境ごとの差分が読めるため)
- `modules/` に provider ブロックを書かない (呼ぶ側の環境で決めるため)

## 名前
- Terraform の名前 (resource・variable・output・module): snake_case
- クラウドのリソース名: `<project>-<env>-<role>` (小文字とハイフン)

## ラベル・タグ
すべてのリソースに `project`・`environment`・`managed_by = "terraform"` を付けます。
| クラウド | 付け方 |
|---|---|
| GCP | `provider "google"` の `default_labels` |
| AWS | `provider "aws"` の `default_tags` |
| Azure | 各リソースの `tags = local.tags` (provider に既定値が無いため) |

## state
| クラウド | backend | 置き場所 |
|---|---|---|
| GCP | `gcs` | バケット `<project>-tfstate`、`prefix = "<env>"` |
| AWS | `s3` | バケット `<project>-tfstate`、`key = "<env>/terraform.tfstate"`、`use_lockfile = true` |
| Azure | `azurerm` | コンテナー `tfstate`、`key = "<env>.tfstate"` |

state の置き場所は最初に 1 度だけ手で作り、バージョニングを有効にします。

## 検査
| 何を | 道具 | 設定 |
|---|---|---|
| 書式 | `terraform fmt` | 無し |
| 名前・ファイルの分け方・クラウドごとの誤り | tflint | `infrastructure/.tflint.hcl` |
| セキュリティの設定の誤り | Trivy | 無し (security プラグインが push の前に動かす) |

- 入れ方: `templates/terraform/.tflint.hcl` を `infrastructure/` に写し、使うクラウドの `plugin` のブロックだけを残す
- CI: `terraform fmt -check -recursive infrastructure` と、`infrastructure/` で `tflint --init --config "$PWD/.tflint.hcl" && tflint --recursive --config "$PWD/.tflint.hcl"` (GitHub Actions は `terraform-linters/setup-tflint`)
- terraform プラグインは、編集したファイルを `terraform fmt` で整え、commit の前に `terraform fmt -check` と tflint を動かす

## 移行中の違反
直していない違反は、その行の上に `# tflint-ignore: <ルール名>` と理由を書いて止め、直したら消します。
