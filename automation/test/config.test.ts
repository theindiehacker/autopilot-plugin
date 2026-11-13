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

test("review.reviewer が無ければ claude[bot] にする", () => {
  expect(parseConfig("limits: {}").review.reviewer).toBe("claude[bot]");
});

test("見回りの使わない qa・review・required_checks の不備では落ちない", () => {
  const c = parseConfig(`
qa: "x"
review: {reviewer: 1, trigger: sometimes, command: 2}
required_checks: [{paths: 1}, 3, "", {name: ok}]
limits: {max_fix_rounds: 2}
`);
  expect(c.limits.maxFixRounds).toBe(2);
  expect(c.qa).toEqual({});
  expect(c.review).toEqual({ reviewer: "claude[bot]", trigger: "none" });
  expect(c.requiredChecks).toEqual([{ name: "ok" }]);
  expect(parseConfig(`${base}required_checks: "x"`).requiredChecks).toEqual([]);
});

test("limits の不備では落ちる", () => {
  expect(issuesOf("limits: {stale_hours: 0}").join("\n")).toContain(
    "limits.stale_hours",
  );
  expect(issuesOf("limits: 1").join("\n")).toContain("limits");
});
