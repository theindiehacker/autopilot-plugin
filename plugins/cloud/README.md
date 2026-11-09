# ☁️ cloud

Claude Code on the Web のセッションを準備するプラグインです。PC には入れません。

## ⚙️ 自動で動くもの

| タイミング | 処理 | 動く条件 |
|---|---|---|
| 起動時 | `dockerd --registry-mirror=https://mirror.gcr.io` | 常に |
| 起動時 | `mise install` | Web で、`mise.toml` がある |
| 起動時 | `docker compose up --build -d --wait` (プロキシの CA をビルドに渡す) | Web で、compose ファイルがある |
