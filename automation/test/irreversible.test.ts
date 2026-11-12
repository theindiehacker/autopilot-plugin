import { expect, test } from "bun:test";
import {
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
