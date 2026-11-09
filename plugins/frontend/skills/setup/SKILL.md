---
name: setup
description: フロントエンドのリポジトリを、統一の技術スタック (bun・Biome・Playwright・shadcn/ui・Tailwind CSS) に移行する。npm・yarn・pnpm・ESLint・Prettier からの置き換えと、足りないものの導入を、ユーザーに確かめながら行う。使い方 → /frontend:setup [フォルダ]
argument-hint: "[フォルダ]"
---

# 移行手順
対象は引数のフォルダです。無ければ `package.json` のあるフォルダです。複数あれば、どれを移行するかユーザーに聞いてください。

## 1. 調べて聞く
次の表で、今の状態を調べてください。

| 項目 | 揃っている | 置き換え・導入が要る |
|---|---|---|
| bun | `bun.lock` がある | `package-lock.json`・`yarn.lock`・`pnpm-lock.yaml` がある |
| Biome | `biome.json(c)` がある | ESLint・Prettier の設定や依存がある、または lint が無い |
| Tailwind CSS | `tailwindcss` が依存にある | 無い、または CSS Modules・styled-components などで書いている |
| shadcn/ui | `components.json` がある | 無い |
| Playwright | `@playwright/test` が依存にある | 無い |
| 型チェック | `package.json` の `scripts` に `typecheck` がある | 無い |
| 依存のルール | `biome.json` の `overrides` と `biome/feature.grit` がある | 無い |

揃っていない項目を一覧にして、項目ごとに行うかをユーザーに聞いてください。行わないと答えた項目は飛ばします。

## 2. 移行する
聞いた順に、1 項目ずつ行ってください。各項目の後で、build が通ることを確かめてください。

### bun
1. `bun install` で `bun.lock` を作る。bun は古い lock ファイルの版を引き継ぐため、`bun.lock` ができてから古い lock ファイルを消す
2. `package.json` の `packageManager` に `bun@<bun --version の版>` を書く (setup.sh がこの版の bun を入れます)
3. `scripts`・CI・Dockerfile・README の `npm`・`npx`・`yarn`・`pnpm` を `bun`・`bunx` に置き換える。CI には `oven-sh/setup-bun`、Dockerfile には `oven/bun` のイメージなどで bun を入れる手順を足す

### Biome
1. `bun add -d -E @biomejs/biome` で入れ、`bunx biome init` で `biome.json` を作る
2. ESLint・Prettier の設定があれば `bunx biome migrate eslint --write`・`bunx biome migrate prettier --write` で移す。移せないとき (Next.js の `FlatCompat` を使った設定など) は、ESLint の設定を読んで `linter.domains` (`next`・`react` など) と `linter.rules` に手で書く
3. Tailwind CSS を使うなら、`css.parser.tailwindDirectives` を `true` にする (`@theme` などを読めるようにするため)。後で Tailwind CSS を入れるときも同じ
4. ESLint・Prettier の依存・設定ファイル・`scripts` を消し、`lint` を `biome check`、`format` を `biome format --write` にする
5. `bunx biome check --write .` で全体を整え、残った問題を直す

### Tailwind CSS
フレームワークの公式手順 (https://tailwindcss.com/docs/installation) で入れてください。既存のスタイルは、頼まれたときだけ Tailwind CSS に書き換えます。Biome があれば、`biome.json` の `css.parser.tailwindDirectives` を `true` にしてください。

### shadcn/ui
1. フレームワークの公式手順 (https://ui.shadcn.com/docs/installation) で、import alias (`@/*` など) を用意する。無いと `init` が止まります (Vite など)
2. `bunx shadcn@latest init` で入れる。Tailwind CSS が要ります
3. 生成されたファイルは Biome の書式に合わないため、`bunx biome check --write .` で整える

### Playwright
1. `bun add -d @playwright/test` で入れ、`bunx playwright install chromium` でブラウザを入れる
2. `playwright.config.ts` を作る。`webServer` で開発サーバーを起動し、テストは `e2e/` に置く
3. トップページが表示されることを確かめるテストを 1 つ書く
4. `scripts` に `"test:e2e": "playwright test"` を足し、`.gitignore` に `/test-results/`・`/playwright-report/` を足す

### 型チェック
`package.json` の `scripts` に `"typecheck": "tsc --noEmit"` を足してください (commit の前に precommit.sh がこれを動かします)。Next.js では `next typegen && tsc --noEmit` (`next-env.d.ts` などの型を先に作るため)、`tsconfig.json` が `references` で分かれている (Vite など) なら `tsc -b` にします。`typescript` が依存に無ければ `bun add -d typescript` で入れてください。

### 依存のルール
Next.js のときだけ行います。architecture:standard スキルの標準 (feature ベース) の import の向きを、Biome で検査できるようにします。
1. architecture:standard スキルを読み、ディレクトリの構成 (`src/app`・`src/features/<モジュール>`・`src/components`・`src/lib`) と `tsconfig.json` の `@/*` → `./src/*` が標準と同じかを調べる。違えば、どう合わせるかを先にユーザーに聞く
2. そのスキルの `templates/nextjs/biome.overrides.json` の `overrides` を `biome.json` に足し、`templates/nextjs/biome/` を `biome/` に写す
3. `bunx biome check .` と `bash biome/features.test.sh` で確かめる。違反は一覧にして伝え、直すのは頼まれたときだけにする

## 3. 確かめる
次がすべて通ることを確かめ、結果をユーザーに伝えてください。

```bash
bun install --frozen-lockfile
```

```bash
bun run build
```

```bash
bunx biome check .
```

```bash
bun run typecheck
```

```bash
bun run test:e2e
```

依存のルールを入れたときは、次も確かめてください。

```bash
bash biome/features.test.sh
```

動かせなかった検査があれば、理由と一緒に伝えてください。commit・PR は、頼まれたときだけ行ってください。
