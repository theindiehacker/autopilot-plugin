#!/usr/bin/env bash
# biome/feature.grit が、別の feature の import を見つけられることを確かめる (architecture プラグインの標準)。CI で動かす。
# プラグインが壊れても (正規表現の誤り・Biome の更新など)、biome check は黙って通ってしまうため。
# 一時のプロジェクトに違反を集めたファイルを作り、`// NG` の行だけが指摘されることを確かめる
set -euo pipefail
cd "$(dirname "$0")/.."
frontend=$PWD

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
# clone 先のパスに src/features/ があっても、自分の feature 名を誤らないことも確かめる
root="$tmp/src/features/repo/frontend"
mkdir -p "$root/src/features/a/components"
# 本物の biome.json の overrides (どのディレクトリにプラグインを付けるか) をそのまま使う。プラグインは絶対パスにする
# shellcheck disable=SC2016 # ${...} は JavaScript のテンプレート文字列
OUT="$root/biome.json" bun -e '
  const { overrides } = await Bun.file("biome.json").json();
  for (const o of overrides) o.plugins = o.plugins?.map((p) => `${process.cwd()}/${p.replace(/^\.\//, "")}`);
  await Bun.write(process.env.OUT, JSON.stringify({ overrides }));
'
file="$root/src/features/a/components/x.ts"
cat > "$file" <<'EOF'
import { ok1 } from "@/features/a/actions"; // OK
import { ok2 } from "@/lib/backend/api"; // OK
import type { Ng1 } from "@/features/b/types"; // NG
import { ng2 } from "@/features/b/actions"; // NG
import * as ng3 from "@/features/b"; // NG
export { ng4 } from "@/features/b/actions"; // NG
const ng5 = () => import("@/features/b/actions"); // NG
export const all = [ok1, ok2, ng2, ng3, ng5];
export type All = Ng1;
EOF

# Biome の github 形式は、指摘を「::error title=plugin,file=<ファイル>,line=<行>,...」の 1 行で出す
output=$(cd "$root" && "$frontend/node_modules/.bin/biome" lint --reporter=github --max-diagnostics=none . 2>&1 || true)
expected=$(grep -n '// NG' "$file" | cut -d: -f1 | tr '\n' ' ')
actual=$(grep '^::error title=plugin,' <<<"$output" | sed -E 's/^.*,line=([0-9]+),.*$/\1/' | sort -n | tr '\n' ' ' || true)
if [ "$expected" != "$actual" ]; then
  echo "biome/feature.grit の検出が想定と違います (想定: $expected / 実際: $actual)" >&2
  exit 1
fi
echo "biome/feature.grit: 想定どおりに違反を検出しました"
