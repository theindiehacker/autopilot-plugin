import { expect, test } from "bun:test";
import {
  decideAfterVerify,
  failureFingerprint,
  findIrreversiblePaths,
  planDeployTargets,
} from "../src/deploy";
import type { AutopilotConfig } from "../src/types";

function configWith(
  deploy: Partial<AutopilotConfig["deploy"]>,
): AutopilotConfig {
  return {
    routineGithubUser: "autopilot-bot",
    qa: {},
    review: { reviewer: "claude[bot]", trigger: "ready_for_review" },
    requiredChecks: [],
    notify: { slackChannel: "#dev" },
    limits: { maxFixRounds: 3, staleHours: 24, readyRetryMinutes: 10 },
    deploy: {
      mode: "none",
      inputs: {},
      environments: [],
      timeoutMinutes: 30,
      rollbackAfterIrreversible: false,
      irreversiblePaths: [],
      ...deploy,
    },
  };
}

// biome-ignore lint/suspicious/noTemplateCurlyInString: 置き換え対象の記号そのもの
test("dispatch は環境の順に並べ、${environment} を置き換える", () => {
  const targets = planDeployTargets(
    configWith({
      mode: "dispatch",
      workflow: "deploy.yml",
      environments: ["staging", "production"],
      // biome-ignore lint/suspicious/noTemplateCurlyInString: 置き換え対象の記号そのもの
      inputs: { env: "${environment}", confirm: "deploy/${environment}" },
    }),
  );
  expect(targets).toHaveLength(2);
  expect(targets[0]).toEqual({
    kind: "dispatch",
    workflow: "deploy.yml",
    environment: "staging",
    inputs: { env: "staging", confirm: "deploy/staging" },
  });
  expect(targets[1]).toEqual({
    kind: "dispatch",
    workflow: "deploy.yml",
    environment: "production",
    inputs: { env: "production", confirm: "deploy/production" },
  });
});

test("on_merge は workflow を 1 つだけ待つ", () => {
  const targets = planDeployTargets(
    configWith({
      mode: "on_merge",
      workflow: "deploy.yml",
      environments: ["staging", "production"],
    }),
  );
  expect(targets).toEqual([{ kind: "wait", workflow: "deploy.yml" }]);
});

test("none はデプロイしない", () => {
  expect(planDeployTargets(configWith({ mode: "none" }))).toEqual([]);
});

test("確認が通れば done", () => {
  expect(
    decideAfterVerify(
      { ok: true, irreversible: true, sameCauseCount: 3 },
      configWith({}),
    ),
  ).toEqual({ kind: "done" });
});

test("取り消せない変更を含むと、ロールバックせず hold", () => {
  expect(
    decideAfterVerify(
      { ok: false, irreversible: true, sameCauseCount: 0 },
      configWith({}),
    ),
  ).toEqual({ kind: "hold" });
});

test("rollback_after_irreversible なら、取り消せない変更でもロールバック", () => {
  expect(
    decideAfterVerify(
      { ok: false, irreversible: true, sameCauseCount: 0 },
      configWith({ rollbackAfterIrreversible: true }),
    ),
  ).toEqual({ kind: "rollback", issueLabel: "autopilot:ready" });
});

test("deploy.irreversible_paths に合う変更したファイルを返す", () => {
  expect(
    findIrreversiblePaths(
      ["backend/migration/versions/0001_add.py", "README.md"],
      ["backend/migration/versions/**"],
    ),
  ).toEqual(["backend/migration/versions/0001_add.py"]);
});

test("deploy.irreversible_paths に合うものが無ければ空", () => {
  expect(
    findIrreversiblePaths(
      ["README.md", ".github/workflows/ci.yml"],
      ["backend/migration/**"],
    ),
  ).toEqual([]);
  expect(findIrreversiblePaths(["README.md"], [])).toEqual([]);
});

test("同じ原因の 2 回目は needs-human の Issue", () => {
  expect(
    decideAfterVerify(
      { ok: false, irreversible: false, sameCauseCount: 1 },
      configWith({}),
    ),
  ).toEqual({ kind: "rollback", issueLabel: "needs-human" });
});

test("時刻や数字が違っても同じ原因とみなす", () => {
  expect(failureFingerprint("\n503 at 2026-11-12T10:00:01Z req=ab12cd")).toBe(
    failureFingerprint("503 at 2026-11-13T09:59:59Z req=ff00aa"),
  );
});

test("違うメッセージは違う原因とみなす", () => {
  expect(failureFingerprint("connection refused")).not.toBe(
    failureFingerprint("502 bad gateway"),
  );
});
