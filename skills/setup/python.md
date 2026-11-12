# Python の技術スタックの移行
Python を、統一の技術スタック (uv・ruff・ty・deptry・import-linter・pytest) に移行します。pip・poetry・pipenv・flake8・black・isort・pylint・mypy・pyright からの置き換えと、足りないものの導入を行います。

対象は `pyproject.toml`・`requirements*.txt`・`setup.py` のあるフォルダです。複数あれば、どれを移行するかユーザーに聞いてください。

## 1. 調べて聞く
まず、起動時と同じ処理を動かしてください。出た警告・エラー (依存を入れられない、ツールが無いなど) は、下の表の項目と一緒に「直す」項目に加えます。原因が許可されていないドメインなら、環境の設定の「許可されたドメイン」に足すよう、ユーザーに頼んでください。

```bash
CLAUDE_PROJECT_DIR="$PWD" bash "${CLAUDE_PLUGIN_ROOT}/scripts/python/setup.sh"
```

次の表で、今の状態を調べてください。

| 項目 | 揃っている | 置き換え・導入が要る |
|---|---|---|
| uv | `uv.lock` がある | `poetry.lock`・`Pipfile`・`requirements*.txt`・`setup.py` などがある |
| ruff | `ruff` が dev 依存にある | flake8・black・isort・pylint の設定や依存がある、または無い |
| ty | `ty` が dev 依存にある | mypy・pyright の設定や依存がある、または無い |
| deptry | `deptry src` (src レイアウトでなければ `deptry .`) が通る | 問題が出る |
| import-linter | `.importlinter` か `pyproject.toml` の `[tool.importlinter]` がある | 無い |
| pytest | `pytest` が dev 依存にある | 無い |

揃っていない項目を一覧にして、項目ごとに行うかをユーザーに聞いてください。行わないと答えた項目は飛ばします。

## 2. 移行する
聞いた順に、1 項目ずつ行ってください。各項目の後で、`uv sync --locked` とテスト (あれば) が通ることを確かめてください。

### uv
1. poetry・pipenv・pip-tools・pip (`requirements.txt`) は `uvx migrate-to-uv` で移す。古い lock ファイルの版を引き継いで `uv.lock` を作り、古い lock ファイル・設定を消します
   - `pyproject.toml` に `[project]` の `name` が無いと失敗するため、先に `name` と `version` だけを書いた `[project]` を作る。`uv init --bare` は使わない (`dependencies = []` が残り、依存が移りません)
2. setup.py (setuptools) は移せないため、`install_requires` を `uv add` で入れ直す
3. `[project]` に `requires-python` が無ければ、今使っている Python の版で足す
4. スクリプト・CI・Dockerfile・README の `pip`・`poetry`・`pipenv`・`python -m` を `uv add`・`uv run`・`uvx` に置き換える。CI には `astral-sh/setup-uv`、Dockerfile には `ghcr.io/astral-sh/uv` のイメージなどで uv を入れる手順を足す

### ruff
1. `uv add --dev ruff` で入れる
2. flake8・black・isort・pylint の設定を読み、`pyproject.toml` の `[tool.ruff]` (`line-length` など) と `[tool.ruff.lint]` の `select` (isort → `I`、pylint → `PL` など) に手で書く
3. 古い依存・設定ファイル (`.flake8`・`setup.cfg` の `[flake8]`・`[tool.black]`・`[tool.isort]`・`.pylintrc` など)・pre-commit のフックを消す
4. `uv run ruff check --fix .`・`uv run ruff format .` で全体を整え、残った問題を直す

### ty
1. `uv add --dev ty` で入れる
2. mypy・pyright の設定を読み、`[tool.ty.environment]` (`python-version` など) と `[tool.ty.rules]` に手で書く。知らないキーがあると `ty check` が止まります
3. mypy・pyright の依存・設定 (`[tool.mypy]`・`mypy.ini`・`[tool.pyright]`・`pyrightconfig.json` など) を消す
4. `uv run ty check` で残った問題を直す

### deptry
`deptry src` (src レイアウトでなければ `deptry .`) で検査し、足りない依存は `uv add`、使っていない依存は `uv remove` で直してください。誤検知だけ `[tool.deptry]` で除外します (commit の前に、lefthook がこれを動かします)。

### import-linter
1. パッケージの層 (例: `presentation → application → domain`) と依存の向きを、ユーザーに確かめる
2. `pyproject.toml` の `[tool.importlinter]` に `root_package` を書き、`[[tool.importlinter.contracts]]` に `type = "layers"` の契約を書く
3. `lint-imports` で確かめる (commit の前に、lefthook がこれを動かします)

### pytest
1. `uv add --dev pytest` で入れる
2. `tests/` に、主な関数などが動くことを確かめるテストを 1 つ書く
3. `pyproject.toml` の `[tool.pytest.ini_options]` に `testpaths = ["tests"]` を足す。unittest のテストは pytest でそのまま動くため、頼まれたときだけ書き換えます

## 3. 確かめる
次がすべて通ることを確かめ、結果をユーザーに伝えてください。src レイアウトでなければ、`deptry src` は `deptry .` にします。

```bash
uv sync --locked
```

```bash
uv run ruff check .
```

```bash
uv run ruff format --check .
```

```bash
uv run ty check
```

```bash
deptry src
```

```bash
lint-imports
```

```bash
uv run pytest
```

動かせなかった検査があれば、理由と一緒に伝えてください。
