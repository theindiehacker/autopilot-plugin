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

揃っていない項目を一覧にして、項目ごとに行うかをユーザーに聞いてください。行わないと答えた項目は飛ばします。

## 2. 移行する
聞いた順に、1 項目ずつ行ってください。各項目の後で、Biome があれば `bunx biome check --write .` で書式を整え (ツールが生成したファイルは Biome の書式に合わないため)、build が通ることを確かめてください。

### bun
1. `bun install` で `bun.lock` を作る。bun は古い lock ファイルの版を引き継ぐため、`bun.lock` ができてから古い lock ファイルを消す
2. `package.json` の `packageManager` に `bun@<bun --version の版>` を書く (setup.sh がこの版の bun を入れます)
3. `scripts`・CI・Dockerfile・README の `npm`・`npx`・`yarn`・`pnpm` を `bun`・`bunx` に置き換える。CI には `oven-sh/setup-bun`、Dockerfile には `oven/bun` のイメージなどで bun を入れる手順を足す

### Biome
1. `bun add -d -E @biomejs/biome` で入れ、`bunx biome init` で `biome.json` を作る。`files.includes` を `["**", "!**/public"]` にする (`public/` はソースではないため)
2. ESLint・Prettier の設定があれば、Biome に移す
   - ESLint が `eslint-config-next` だけ (create-next-app の既定) なら、`migrate` を使わず、`linter.domains` の `next`・`react` を `recommended` にする。`migrate` は 300 行ほどの設定を作るため
   - それ以外は `bunx biome migrate eslint --write` で移し、`none` になる `linter.rules.preset` を `recommended` に戻す。移せないとき (`FlatCompat` を使った設定など) は、ESLint の設定を読んで `linter.domains` と `linter.rules` に手で書く
   - Prettier は `bunx biome migrate prettier --write` で移す
3. Tailwind CSS を使うなら、`css.parser.tailwindDirectives` を `true` にする (`@theme` などを読めるようにするため)。後で Tailwind CSS を入れるときも同じ
4. ESLint・Prettier の依存・設定ファイル・`scripts` を消し、`lint` を `biome check`、`format` を `biome format --write` にする
5. `bunx biome check --write .` で全体を整え、残った問題を直す

### Tailwind CSS
1. フレームワークの公式手順 (https://tailwindcss.com/docs/installation) で入れる。既存のスタイルは、頼まれたときだけ Tailwind CSS に書き換える
2. 既存のグローバル CSS の要素セレクタのルール (`*`・`body`・`a` など) を `@layer base { }` で囲む。レイヤーの外のルールは Tailwind CSS のクラスより優先され、`* { padding: 0 }` があると `px-2` などが効かないため
3. Biome があれば、`biome.json` の `css.parser.tailwindDirectives` を `true` にする

### shadcn/ui
1. フレームワークの公式手順 (https://ui.shadcn.com/docs/installation) で、import alias (`@/*` など) を用意する。無いと `init` が止まります (Vite など)
2. `bunx shadcn@latest init -d` で入れる (端末が無くても動くように)。Tailwind CSS が要ります。exit 0 でも何も作らないことがあるので、`components.json` ができたことを確かめてください
3. Next.js では、`layout.tsx` の `next/font` の `variable` を `--font-sans` にして、`--font-geist-sans` を使っている CSS も合わせて直す。shadcn/ui の `globals.css` は `--font-sans` を読むため

### Playwright
1. `bun add -d @playwright/test` で入れ、`bunx playwright install chromium` でブラウザを入れる
2. `playwright.config.ts` を作る。`webServer` で開発サーバーを起動し、テストは `e2e/` に置く
3. トップページが表示されることを確かめるテストを 1 つ書く
4. `scripts` に `"test:e2e": "playwright test"` を足し、`.gitignore` に `/test-results/`・`/playwright-report/` を足す

### 型チェック
`package.json` の `scripts` に `"typecheck": "tsc --noEmit"` を足してください (commit の前に precommit.sh がこれを動かします)。Next.js では `next typegen && tsc --noEmit` (`next-env.d.ts` などの型を先に作るため)、`tsconfig.json` が `references` で分かれている (Vite など) なら `tsc -b` にします。`typescript` が依存に無ければ `bun add -d typescript` で入れてください。

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

動かせなかった検査があれば、理由と一緒に伝えてください。commit・PR は、頼まれたときだけ行ってください。
