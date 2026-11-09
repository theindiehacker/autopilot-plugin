# Python の書き方

## ディレクトリ構成
```
pyproject.toml          # [tool.importlinter] に templates/python/importlinter.toml を書く
src/
├── core.py             # 組み立てる側。モジュールを並べ、DI・ルーティングをまとめる (検査しない)
├── api.py              # 入口 (API・subscriber・batch など)。組み立てる側 (検査しない)
├── shared/             # 全モジュールが使う技術的なコード (DB の接続・ログ・設定・基底クラス)。中に層は作らない
└── <モジュール>/
    ├── core.py         # そのモジュールの DI 登録・ルーティング・購読者の宣言
    ├── application/
    │   └── <集約>/      # command.py (入力)・dpo.py (出力)・*_application_service.py
    ├── domain/
    │   └── model/<集約>/ # エンティティ・値オブジェクト・リポジトリの IF・ドメインイベント
    ├── exception/      # error_code.py (エラーの種類)
    └── port/
        └── adapter/
            ├── messaging/   # 他モジュールのドメインイベントを受ける
            ├── persistence/ # リポジトリの実装・テーブル
            ├── resource/    # API (公開 IF)
            ├── service/     # domain のサービス IF の実装・腐敗防止層 (<相手>/adapter/)
            └── tool/        # MCP のツール
test/
└── unit/<モジュール>/... # src と同じパスに test_<ファイル>.py を置く
```
- 各ディレクトリに `__init__.py` を置く
- `shared` の中に、層と同じ名前 (`domain`・`application` など) のディレクトリを作らない。層の検査がかかるため

## 検査
| 何を | 道具 | 設定 |
|---|---|---|
| 層の向き・domain を使える層・モジュールの独立 | import-linter | `pyproject.toml` の `[tool.importlinter]` |

- 入れ方: `uv add --dev import-linter` の後、`templates/python/importlinter.toml` を `pyproject.toml` に写し、`root_packages` に `src` 直下のパッケージをすべて並べる
- CI: `uv run lint-imports`
- python プラグインは、commit の前に `lint-imports` を動かし、`root_packages` の並べ忘れも検査する

## モジュールを足す
1. `src/<モジュール>/` を上の構成で作る
2. `src/core.py` に並べる
3. `[tool.importlinter]` の `root_packages` と、`[tool.deptry]` の `known_first_party` (あれば) に足す

## 移行中の違反
直していない違反は、その契約の `ignore_imports` に並べ、直したら消します。新しい違反は止まります。
```toml
ignore_imports = [
  # 移行中。直したら消す
  "billing.domain.model.invoice -> billing.application.invoice",
]
```
