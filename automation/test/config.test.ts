import { expect, test } from "bun:test";
import { ConfigError, parseConfig } from "../src/config";

const base = `routine_github_user: autopilot-bot
review: {reviewer: claude[bot], trigger: ready_for_review}
notify: {slack_channel: '#dev'}
`;

function issuesOf(yaml: string): string[] {
  try {
    parseConfig(yaml);
  } catch (e) {
    if (e instanceof ConfigError) return e.issues;
    throw e;
  }
  throw new Error("ConfigError が出なかった");
}

test("既定値を入れる", () => {
  const c = parseConfig(
    "routine_github_user: autopilot-bot\nreview: {reviewer: claude[bot], trigger: ready_for_review}\nrequired_checks: [task test]\nnotify: {slack_channel: '#dev'}\ndeploy: {mode: none}",
  );
  expect(c.limits).toEqual({
    maxFixRounds: 3,
    staleHours: 3,
    readyRetryMinutes: 30,
  });
  expect(c.deploy.rollbackAfterIrreversible).toBe(false);
  expect(c.deploy.irreversiblePaths).toEqual([]);
  expect(c.deploy.timeoutMinutes).toBe(60);
  expect(c.requiredChecks).toEqual([{ name: "task test" }]);
});

test("paths 付きの必須チェックを読む", () => {
  const c = parseConfig(
    `${base}required_checks: [{name: e2e, paths: ["frontend/**"]}]\ndeploy: {mode: none}`,
  );
  expect(c.requiredChecks).toEqual([{ name: "e2e", paths: ["frontend/**"] }]);
});

test("不正な deploy.mode は ConfigError", () => {
  expect(issuesOf(`${base}deploy: {mode: auto}`).join("\n")).toContain(
    "deploy.mode",
  );
});

test("dispatch なのに workflow が無いと ConfigError", () => {
  expect(issuesOf(`${base}deploy: {mode: dispatch}`).join("\n")).toContain(
    "deploy.workflow",
  );
});

test("deploy.irreversible_paths を読む", () => {
  const c = parseConfig(
    `${base}deploy: {mode: none, irreversible_paths: ["db/migrations/**", "infra/**"]}`,
  );
  expect(c.deploy.irreversiblePaths).toEqual(["db/migrations/**", "infra/**"]);
});

test("deploy.irreversible_paths が文字列の配列でなければ ConfigError", () => {
  expect(
    issuesOf(`${base}deploy: {mode: none, irreversible_paths: "db/**"}`).join(
      "\n",
    ),
  ).toContain("deploy.irreversible_paths");
});

test("前の版の irreversible・approvers・notify.approver_mentions は読み飛ばす", () => {
  const c = parseConfig(
    "routine_github_user: autopilot-bot\nreview: {reviewer: x, trigger: none}\napprovers: []\nnotify: {slack_channel: '#dev', approver_mentions: ['<@U1>']}\nirreversible: {paths: [infra/**], terraform_plan_artifact: plan}\ndeploy: {mode: none}",
  );
  expect(c).not.toHaveProperty("irreversible");
  expect(c).not.toHaveProperty("approvers");
  expect(c.notify).toEqual({ slackChannel: "#dev" });
  expect(c.deploy.irreversiblePaths).toEqual([]);
});

test("問題をまとめて返す", () => {
  expect(
    issuesOf(`${base}deploy: {mode: auto}\nlimits: {max_fix_rounds: 0}`).length,
  ).toBe(2);
});

test("on_merge なのに workflow が無いと ConfigError", () => {
  expect(issuesOf(`${base}deploy: {mode: on_merge}`).join("\n")).toContain(
    "deploy.workflow",
  );
});

test("dispatch なのに environments が空か無いと ConfigError", () => {
  const wf = "deploy: {mode: dispatch, workflow: d.yml";
  expect(issuesOf(`${base}${wf}}`).join("\n")).toContain("deploy.environments");
  expect(issuesOf(`${base}${wf}, environments: []}`).join("\n")).toContain(
    "deploy.environments",
  );
});

test("mode none は workflow も environments も要らない", () => {
  expect(parseConfig(`${base}deploy: {mode: none}`).deploy.mode).toBe("none");
});

test("routine_github_user が無いと ConfigError", () => {
  const yaml = base.replace("routine_github_user: autopilot-bot\n", "");
  expect(issuesOf(`${yaml}deploy: {mode: none}`).join("\n")).toContain(
    "routine_github_user",
  );
});

test("routine_github_user と qa を読む", () => {
  const c = parseConfig(
    `${base}qa: {start: "task dev", url: "http://localhost:3000"}`,
  );
  expect(c.routineGithubUser).toBe("autopilot-bot");
  expect(c.qa).toEqual({ start: "task dev", url: "http://localhost:3000" });
  expect(parseConfig(base).qa).toEqual({});
});

test("routine_github_user が空文字だと ConfigError", () => {
  const yaml = base.replace("autopilot-bot", '""');
  expect(issuesOf(`${yaml}deploy: {mode: none}`).join("\n")).toContain(
    "routine_github_user",
  );
});
