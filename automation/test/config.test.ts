import { expect, test } from "bun:test";
import { ConfigError, parseConfig } from "../src/config";

const base = "review: {reviewer: 'claude[bot]', trigger: ready_for_review}\n";

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
  const c = parseConfig(`${base}required_checks: [task test]\n`);
  expect(c.limits).toEqual({
    maxFixRounds: 3,
    staleHours: 3,
    readyRetryMinutes: 30,
  });
  expect(c.requiredChecks).toEqual([{ name: "task test" }]);
  expect(c.qa).toEqual({});
});

test("paths 付きの必須チェックを読む", () => {
  const c = parseConfig(
    `${base}required_checks: [{name: e2e, paths: ["frontend/**"]}]`,
  );
  expect(c.requiredChecks).toEqual([{ name: "e2e", paths: ["frontend/**"] }]);
});

test("qa を読む", () => {
  const c = parseConfig(
    `${base}qa: {start: "task dev", url: "http://localhost:3000"}`,
  );
  expect(c.qa).toEqual({ start: "task dev", url: "http://localhost:3000" });
});

test("消した項目が残っていても読める", () => {
  const c = parseConfig(`
review: {reviewer: x, trigger: none}
routine_github_user: someone
notify:
  slack_channel: "#x"
deploy:
  mode: on_merge
  workflow: deploy.yml
limits:
  max_fix_rounds: 2
`);
  expect(c.limits.maxFixRounds).toBe(2);
  expect("deploy" in c).toBe(false);
  expect("notify" in c).toBe(false);
  expect("routineGithubUser" in c).toBe(false);
});

test("消した項目の中身が不正でも、検査しない", () => {
  const c = parseConfig(`${base}deploy: {mode: auto}\nnotify: "x"`);
  expect(c.review.reviewer).toBe("claude[bot]");
});

test("問題をまとめて返す", () => {
  expect(
    issuesOf(`${base}limits: {max_fix_rounds: 0, stale_hours: 0}`).length,
  ).toBe(2);
});

test("review.reviewer が無いと ConfigError", () => {
  expect(issuesOf("limits: {}").join("\n")).toContain("review.reviewer");
});
