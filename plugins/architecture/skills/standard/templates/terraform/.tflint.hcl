# tflint の設定 (architecture プラグインの標準)。infrastructure/ に置く。
# 動かし方: tflint --init --config "$(pwd)/.tflint.hcl" && tflint --recursive --config "$(pwd)/.tflint.hcl"
# 使うクラウドの plugin のブロックだけを残す

plugin "terraform" {
  enabled = true
  preset  = "recommended"
}

# Terraform の名前 (resource・variable・output など) は snake_case にする
rule "terraform_naming_convention" {
  enabled = true
}

# モジュールは main.tf・variables.tf・outputs.tf に分け、variable は variables.tf、output は outputs.tf に書く
rule "terraform_standard_module_structure" {
  enabled = true
}

plugin "google" {
  enabled = true
  version = "0.41.0"
  source  = "github.com/terraform-linters/tflint-ruleset-google"
}

plugin "aws" {
  enabled = true
  version = "0.50.0"
  source  = "github.com/terraform-linters/tflint-ruleset-aws"
}

plugin "azurerm" {
  enabled = true
  version = "0.33.0"
  source  = "github.com/terraform-linters/tflint-ruleset-azurerm"
}
