# ☁️ cloud

Claude Code on the Web のセッションを準備するプラグインです。PC には入れません。

## ⚙️ 自動で動くもの

| タイミング | 処理 | 動く条件 |
|---|---|---|
| 起動時 | `dockerd --registry-mirror=https://mirror.gcr.io` | 常に |
| 起動時 | `mise install` | Web で、`mise.toml` がある |
| 起動時 | `docker compose up --build -d --wait` (プロキシの CA をビルドと起動後のコンテナに渡す) | Web で、compose ファイルがある |

## 🚀 Docker で動くようにする

`/cloud:setup` を実行すると、リポジトリを調べ、足りない項目ごとに確認しながら、クラウドで Docker を起動できるように直します。ローカルの Docker でも今までどおり動く形にします。

| 項目 | 内容 |
|---|---|
| compose ファイル | ルートに無ければ、サブフォルダのものを読み込むか、DB などの依存サービスだけで作る |
| プロキシの CA | Dockerfile の通信する `RUN` で、プロキシの CA を読む |
| `.env` | 無くても起動できるようにする |
| Mac 専用の設定 | `platform: linux/arm64` や、リポジトリの外のパスの mount を直す |
| 終了するサービス | migration などで起動の確認が止まらないようにする |
| 遮断されたドメイン | 一覧にして、環境の「許可されたドメイン」への追加を頼む |

最後に、起動時と同じ `docker compose up --build -d --wait` が通り、サービスに繋がることを確かめます。commit と PR は、頼まれたときだけ行います。
