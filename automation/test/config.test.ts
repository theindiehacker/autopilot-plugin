import { expect, test } from "bun:test";
import { ConfigError, parseConfig } from "../src/config";

const base = `review: {reviewer: claude[bot], trigger: ready_for_review}
approvers: [alice]
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
    "review: {reviewer: claude[bot], trigger: ready_for_review}\nrequired_checks: [task test]\napprovers: [alice]\nnotify: {slack_channel: '#dev'}\ndeploy: {mode: none}",
  );
  expect(c.limits).toEqual({
    maxFixRounds: 3,
    staleHours: 3,
    readyRetryMinutes: 30,
  });
  expect(c.deploy.rollbackAfterIrreversible).toBe(false);
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

test("irreversible.paths があるのに approvers が空だと ConfigError", () => {
  const yaml =
    "review: {reviewer: x, trigger: none}\napprovers: []\nnotify: {slack_channel: '#dev'}\nirreversible: {paths: [infra/**]}\ndeploy: {mode: none}";
  expect(issuesOf(yaml).join("\n")).toContain("approvers");
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
