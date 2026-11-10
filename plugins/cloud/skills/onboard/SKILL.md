---
name: onboard
description: Claude Code on the Web のクラウド環境で Docker (docker compose) を起動して開発・動作確認できるよう、リポジトリの compose ファイルと Dockerfile を直す。プロキシの CA・遮断されたドメイン・.env・Mac 専用の設定などを、ユーザーに確かめながら直す。使い方 → /cloud:onboard
---

# 手順
対象はリポジトリのルートです (起動時の setup.sh は、ルートの compose ファイルだけを起動します)。ローカルの Docker でも今までどおり動く形を保ってください。

## このクラウド環境の前提
- 外向きの通信は、プロキシの CA で TLS を張り直されます。コンテナがこの CA を信頼しないと、`self-signed certificate in certificate chain` などで失敗します
- 起動時の setup.sh は、ビルドに CA を secret `ca-certificates` で渡します。起動後のコンテナには、CA と `SSL_CERT_FILE`・`NODE_EXTRA_CA_CERTS`・`REQUESTS_CA_BUNDLE` を渡します。ビルドの `RUN` だけは、Dockerfile 側で secret を読む必要があります
- 許可されていないドメインは、名前を解決できません (`Could not resolve 'deb.debian.org'` など)。許可は環境の設定で、リポジトリでは変えられません
- マシンは x86_64 です

## 1. 調べて聞く
まず、起動時と同じ処理を動かしてください。出た警告・エラー (依存を入れられない、ツールが無いなど) は、下の表の項目と一緒に「直す」項目に加えます。原因が許可されていないドメインなら、環境の設定の「許可されたドメイン」に足すよう、ユーザーに頼んでください。

```bash
CLAUDE_PROJECT_DIR="$PWD" bash "${CLAUDE_PLUGIN_ROOT}/scripts/setup.sh"
```

次の表で、今の状態を調べてください。

| 項目 | 揃っている | 直す |
|---|---|---|
| compose ファイル | ルートに `compose.yaml` などがある | 無い |
| ビルドの CA | HTTPS で取得する `RUN` が secret を読んでいる | 読んでいない |
| `.env` | `.env` が無くても `docker compose config` が通り、値が空にならない | `env_file` が必須、または変数に既定値が無い |
| Mac 専用の設定 | 無い | `platform: linux/arm64`、リポジトリの外のパス (`~/`・`/Users/` など) の mount |
| 終了するサービス | 無い、または待つ側が `service_completed_successfully` で待っている | migration などが終了する |
| ドメイン | ビルドと起動で使うドメインが許可されている | 名前を解決できない |

ドメインは、`image:`・`FROM` のレジストリ、Dockerfile の `apt-get`・`apk`・`curl` などの取得先と、`docker compose build` のエラーから調べます。

揃っていない項目を一覧にして、項目ごとに行うかをユーザーに聞いてください。行わないと答えた項目は飛ばします。

## 2. 直す
聞いた順に、1 項目ずつ行ってください。

### compose ファイル
- サブフォルダにあれば、ルートに `include:` でそれを読む `compose.yaml` を作る
- 無ければ、依存 (`pyproject.toml`・`package.json` など) と README から DB・Redis などを読み取り、それだけの `compose.yaml` を作る。アプリは入れません (クラウドの node・python で直接動かすため)
  - イメージは Docker Hub の公式イメージ (`postgres:17` など) にする。版はコードや README から決め、分からなければユーザーに聞く
  - `ports` でホストに公開し、`healthcheck` を付け、データは名前付き volume に置く
  - ユーザー名・パスワード・DB 名は、アプリの接続先の既定値 (`postgresql://app:app@localhost:5432/app` など) に合わせる

### ビルドの CA
HTTPS で取得する `RUN` (`npm ci`・`pip install`・`apk add`・`curl https://` など) に、secret の mount を付けてください。`apt-get` は http なので要りません。ローカルでは secret が無く mount されないため、今までどおり動きます。

```dockerfile
RUN --mount=type=secret,id=ca-certificates,target=/etc/ssl/certs/ca-certificates.crt \
    NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt npm ci
```

OS の証明書を読まないツールには、同じ `RUN` で環境変数を付けます。

| ツール | 付けるもの |
|---|---|
| npm・yarn・pnpm・bun・node | `NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt` |
| uv | `SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt` |
| pip (24.2 以降)・curl・apk・git | 要らない (mount だけで読む) |

- 多段ビルドでは、HTTPS で取得する `RUN` のある段すべてに付ける
- 環境変数は `ENV` にせず、その `RUN` だけに付ける。ローカルのイメージには、このパスが無いことがあるため (`NODE_EXTRA_CA_CERTS` は、ファイルが無くても警告が出るだけで動きます)
- `ca-certificates` を入れる `RUN` (`apt-get`・`apk` など) には付けない。mount したファイルを書き換えられず、パッケージの導入が失敗します。同じ `RUN` で他の取得もしていれば、`RUN` を分ける
- TLS の検証を切る (`strict-ssl false`・`--trusted-host`・`curl -k` など)、`network: host`、プロキシの設定は使わない

### `.env`
- `env_file` を `- path: .env` と `required: false` の形にする
- 必須の変数には、`.env.example` などの値で既定値を付ける (`${POSTGRES_PASSWORD:-postgres}`)。ローカルでは今までどおり `.env` の値が使われます
- アプリが `env_file` からしか受け取らない必須の値 (`DATABASE_URL` など) は、`environment:` に既定値付きで書く (`DATABASE_URL: ${DATABASE_URL:-postgres://...}`)。compose は `.env` を変数の展開にも使うため、ローカルでは今までどおり `.env` の値になります
- `.env.example` を `env_file` に足さない (ローカルの値が変わるため)。`.env` は読まない

### Mac 専用の設定
- `platform: linux/arm64` を消す。イメージが arm64 を含めば、Apple Silicon でも同じように動きます
- リポジトリの外のパスの mount は、名前付き volume にする。ローカルのデータを引き継ぐ必要があるかは、ユーザーに確かめる

### 終了するサービス
`docker compose up --wait` は、サービスが 1 つでも終了すると失敗します。migration など終了するサービスは、それを使うサービス (アプリなど) の `depends_on` に `condition: service_completed_successfully` で足してください。ローカルでも今までどおり、`up` で動きます。どのサービスが使うか分からなければ、ユーザーに聞いてください。`profiles` に入れると、ローカルの `up` で動かなくなるため使いません。

### ドメイン
名前を解決できないドメインを一覧にし、環境の設定の「許可されたドメイン」に足すよう、ユーザーに頼んでください (例: Debian の `apt-get` → `deb.debian.org`)。Dockerfile の手順を消したり、別の経路で回避したりしないでください。足すまでは、そのビルドを確かめられないと伝えます。

## 3. 確かめる
リポジトリのルートで、起動時と同じ処理を動かしてください。CA を渡す compose ファイルを作り直し、`docker compose up --build -d --wait` を行います。

```bash
CLAUDE_PROJECT_DIR="$PWD" bash "${CLAUDE_PLUGIN_ROOT}/scripts/setup.sh"
```

続けて次を確かめ、結果をユーザーに伝えてください。このセッションで `docker compose` を動かすときは、`COMPOSE_FILE` に `.claude/session/compose.proxy-ca.yaml` を含めます (例: `COMPOSE_FILE=compose.yaml:.claude/session/compose.proxy-ca.yaml`)。次のセッションからは、setup.sh が設定します。

- `docker compose ps` で、すべてのサービスが動いている
- 公開したポートに繋がる (アプリが外部の HTTPS に繋ぐなら、それも)

遮断されたドメインでビルドが止まるときは、ビルドの無いサービスだけを `docker compose up -d --wait <サービス>` で確かめてください。setup.sh が作る `.claude/session/` は、中の `.gitignore` で git から外れるため、リポジトリの `.gitignore` に足す必要はありません。

動かせなかった確認があれば、理由と一緒に伝えてください。

## 4. PR を作る
PR を作るかユーザーに聞き、作ると答えたら、変更を commit して PR を作ってください。本文には、直した項目と、ユーザーがすること (許可されたドメインの追加など) を書きます。
