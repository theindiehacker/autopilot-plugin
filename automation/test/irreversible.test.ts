import { expect, test } from "bun:test";
import {
  BUILTIN_IRREVERSIBLE_PATHS,
  detectIrreversible,
  findIrreversiblePaths,
  findTerraformDestroys,
} from "../src/irreversible";
import type { AutopilotConfig } from "../src/types";

const plan = {
  resource_changes: [
    { address: "google_sql_database.main", change: { actions: ["delete"] } },
    {
      address: "google_cloud_run_v2_service.api",
      change: { actions: ["delete", "create"] },
    },
    { address: "google_storage_bucket.b", change: { actions: ["update"] } },
  ],
};

test("マイグレーションのパスに合う", () => {
  expect(
    findIrreversiblePaths(
      ["backend/migration/versions/0001_add.py", "README.md"],
      ["backend/migration/versions/**"],
    ),
  ).toEqual(["backend/migration/versions/0001_add.py"]);
});

test("plan の delete と replace を拾い、update は拾わない", () => {
  expect(findTerraformDestroys(plan)).toEqual([
    "google_sql_database.main",
    "google_cloud_run_v2_service.api",
  ]);
});

test("plan が空や形の違うものでも落ちない", () => {
  expect(findTerraformDestroys(null)).toEqual([]);
  expect(findTerraformDestroys({})).toEqual([]);
  expect(findTerraformDestroys({ resource_changes: "x" })).toEqual([]);
});

test("理由を日本語でまとめる", () => {
  const config = {
    irreversible: { paths: ["backend/migration/versions/**"] },
  } as AutopilotConfig;
  expect(
    detectIrreversible({
      changedFiles: ["backend/migration/versions/0001_add.py", "README.md"],
      config,
      terraformPlan: {
        resource_changes: [
          {
            address: "google_sql_database.main",
            change: { actions: ["delete"] },
          },
        ],
      },
    }),
  ).toEqual([
    "パス: backend/migration/versions/0001_add.py",
    "Terraform: google_sql_database.main を削除または作り直し",
  ]);
});

test("パターンに合うものが無ければ空", () => {
  expect(
    findIrreversiblePaths(["README.md"], ["backend/migration/**"]),
  ).toEqual([]);
});

test('["create","delete"] の replace も拾う', () => {
  expect(
    findTerraformDestroys({
      resource_changes: [
        { address: "a.b", change: { actions: ["create", "delete"] } },
      ],
    }),
  ).toEqual(["a.b"]);
});

const unreadable = "Terraform: plan を読めませんでした";
const withArtifact = {
  irreversible: { paths: [], terraformPlanArtifact: "tfplan" },
} as unknown as AutopilotConfig;
const withoutArtifact = {
  irreversible: { paths: [] },
} as unknown as AutopilotConfig;

test("plan の成果物を設定していて plan が無いと理由を返す", () => {
  expect(
    detectIrreversible({ changedFiles: [], config: withArtifact }),
  ).toContain(unreadable);
});

test("plan の成果物を設定していて plan の形が違うと理由を返す", () => {
  expect(
    detectIrreversible({
      changedFiles: [],
      config: withArtifact,
      terraformPlan: {},
    }),
  ).toContain(unreadable);
});

test("resource_changes が無い正しい plan は理由にしない", () => {
  expect(
    detectIrreversible({
      changedFiles: [],
      config: withArtifact,
      terraformPlan: { format_version: "1.2" },
    }),
  ).toEqual([]);
});

test("plan の成果物を設定していなければ plan が無くても理由にしない", () => {
  expect(
    detectIrreversible({ changedFiles: [], config: withoutArtifact }),
  ).toEqual([]);
});

test("守りのファイルは、設定に無くても取り消せない変更にする", () => {
  const config = {
    irreversible: { paths: [] },
  } as unknown as AutopilotConfig;
  const protectedFiles = [
    ".github/autopilot.yml",
    ".github/workflows/ci.yml",
    ".github/actions/x/action.yml",
    ".github/CODEOWNERS",
    ".claude/settings.json",
    ".claude/settings.local.json",
    ".claude/hooks/pre.sh",
    ".mcp.json",
    "lefthook.yml",
    "lefthook.toml",
    "lefthook-local.json",
    ".lefthook/commit-msg/x.sh",
    ".lefthook-local/pre-commit/y.sh",
    ".config/lefthook.yml",
    "sub/dir/.lefthook.yaml",
    ".github/.x",
    ".pre-commit-config.yaml",
    ".husky/pre-commit",
  ];
  expect(
    detectIrreversible({
      changedFiles: [...protectedFiles, "src/app.ts", "docs/about-hooks.md"],
      config,
    }),
  ).toEqual(protectedFiles.map((f) => `パス: ${f}`));
  expect(BUILTIN_IRREVERSIBLE_PATHS).toContain(".github/**");
  expect(BUILTIN_IRREVERSIBLE_PATHS).toContain(".claude/**");
});
