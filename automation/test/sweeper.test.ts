import { expect, test } from "bun:test";
import { parseConfig } from "../src/config";
import { planSweep, type SweepItem } from "../src/sweeper";
import { LABELS } from "../src/types";

const config = parseConfig(`routine_github_user: autopilot-bot
review: {reviewer: claude[bot], trigger: ready_for_review}
approvers: [alice]
notify: {slack_channel: '#dev'}
`);
const now = new Date("2026-11-12T12:00:00Z");
const ago = (minutes: number) =>
  new Date(now.getTime() - minutes * 60_000).toISOString();

function issue(over: Partial<SweepItem> = {}): SweepItem {
  return {
    kind: "issue",
    number: 7,
    title: "t",
    url: "https://example.com/7",
    labels: [LABELS.ready],
    readyLabeledAt: ago(0),
    readyRetries: 0,
    hasPr: false,
    updatedAt: ago(0),
    conflicting: false,
    ...over,
  };
}

const pr = (over: Partial<SweepItem> = {}): SweepItem =>
  issue({ kind: "pr", number: 9, labels: [], hasPr: true, ...over });

test("ready のまま 30 分を超えて起動しなければ付け直す", () => {
  expect(planSweep([issue({ readyLabeledAt: ago(31) })], now, config)).toEqual([
    { type: "relabelReady", number: 7 },
  ]);
});

test("付け直しても起動しなければ needs-human", () => {
  const actions = planSweep(
    [issue({ readyLabeledAt: ago(31), readyRetries: 1 })],
    now,
    config,
  );
  expect(actions).toHaveLength(1);
  const a = actions[0];
  expect(a?.type).toBe("needsHuman");
  expect(a?.number).toBe(7);
  expect(a?.type === "needsHuman" && a.reason).toContain("起動しませんでした");
});

test("30 分以内なら何もしない", () => {
  expect(planSweep([issue({ readyLabeledAt: ago(29) })], now, config)).toEqual(
    [],
  );
});

test("起動済み (startedAt あり) なら付け直さない", () => {
  expect(
    planSweep(
      [issue({ readyLabeledAt: ago(60), startedAt: ago(5) })],
      now,
      config,
    ),
  ).toEqual([]);
});

test("開始から 3 時間たっても PR が無ければ needs-human", () => {
  const stale = planSweep(
    [issue({ startedAt: ago(240), readyLabeledAt: ago(300) })],
    now,
    config,
  );
  expect(stale).toHaveLength(1);
  expect(stale[0]?.type).toBe("needsHuman");
  expect(planSweep([issue({ startedAt: ago(120) })], now, config)).toEqual([]);
});

test("PR があれば Issue は needs-human にしない", () => {
  expect(
    planSweep([issue({ startedAt: ago(240), hasPr: true })], now, config),
  ).toEqual([]);
});

test("コンフリクトした PR は dispatchFix", () => {
  expect(planSweep([pr({ conflicting: true })], now, config)).toEqual([
    { type: "dispatchFix", number: 9 },
  ]);
});

test("PR は 3 時間動きが無ければ needs-human", () => {
  const stale = planSweep([pr({ updatedAt: ago(240) })], now, config);
  expect(stale).toHaveLength(1);
  expect(stale[0]?.type).toBe("needsHuman");
  expect(planSweep([pr({ updatedAt: ago(120) })], now, config)).toEqual([]);
});

test("needs-human が付いていれば何もしない", () => {
  const items = [
    issue({
      labels: [LABELS.ready, LABELS.needsHuman],
      readyLabeledAt: ago(60),
    }),
    pr({ labels: [LABELS.needsHuman], conflicting: true, updatedAt: ago(600) }),
  ];
  expect(planSweep(items, now, config)).toEqual([]);
});

test("設定の limits に従う", () => {
  const c = {
    ...config,
    limits: { ...config.limits, readyRetryMinutes: 10, staleHours: 1 },
  };
  expect(planSweep([issue({ readyLabeledAt: ago(11) })], now, c)).toHaveLength(
    1,
  );
  expect(planSweep([pr({ updatedAt: ago(61) })], now, c)).toHaveLength(1);
});
