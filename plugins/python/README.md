# 🐍 python

Python・uv・Ruff・ty・import-linter・deptry の開発で使うプラグインです。

## ⚙️ 自動で動くもの

| タイミング | 処理 | 動く条件 |
|---|---|---|
| 起動時 | uv が無ければ導入し、Ruff・ty を導入 | 常に |
| 起動時 | 技術スタックの方針を Claude に伝える | `pyproject.toml`・`requirements*.txt`・`setup.py` がある |
| 起動時 | `uv sync --locked` | `uv.lock` がある |
| 編集後 | `ruff check --fix` → `ruff format` → `ruff check`・`ty check` | `.py`・`.pyi` の編集で、`pyproject.toml` がある |
| commit 前 | `deptry` | `uv.lock` がある |
| commit 前 | `lint-imports` | `uv.lock` と import-linter の設定がある |

- **失敗時:** hook が exit 2 を返し、結果を Claude に渡します。commit 前の検査では commit も止まり、Claude が修正してやり直すと再び検査します。
- **検査の範囲:** 編集後は編集したファイルだけ、commit 前は `uv.lock` のあるフォルダごとに全体を検査します。
- **LSP:** Claude が ty の LSP を使えます。

**Claude に伝える方針**

- パッケージの管理と実行は uv。pip・poetry・pipenv は使わない
- lint と整形は Ruff。flake8・black・isort・pylint は使わない
- 型の検査は ty。mypy・pyright は使わない
- 依存の過不足は deptry、import の向きは import-linter で検査する
- 機能を足す・変えるときは、pytest でテストを書く

## 🚀 技術スタックの移行

`/python:onboard [フォルダ]` を実行すると、起動時の処理を動かして失敗を集め、リポジトリを調べ、足りない項目ごとに確認しながら移行します。

| 項目 | 内容 |
|---|---|
| uv | pip・poetry・pipenv から置き換える |
| Ruff | flake8・black・isort・pylint から置き換える |
| ty | mypy・pyright から置き換える |
| deptry | 見つかった依存の過不足を直す |
| import-linter | パッケージの層と依存の向きを確認し、`layers` の契約を書く |
| pytest | 無ければ導入し、テストを 1 つ書く |

最後に `uv sync --locked`・`uv run ruff check .`・`uv run ruff format --check .`・`uv run ty check`・`deptry src`・`lint-imports`・`uv run pytest` が通ることを確かめます。PR を作るかを聞き、作ると答えたら PR を作ります。

## 🎁 一緒に入るプラグイン

<p align="center">
  <img src="../../docs/images/readme/recommended-python.svg" width="100%" alt="superpowers: 設計・実装計画・TDD・サブエージェント開発。security-guidance: 編集時の警告と diff・commit のレビュー。">
</p>
