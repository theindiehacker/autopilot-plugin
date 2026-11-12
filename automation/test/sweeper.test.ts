import { expect, test } from "bun:test";
import { parseConfig } from "../src/config";
import { planSweep, type SweepItem } from "../src/sweeper";
import { LABELS } from "../src/types";

const config =
  parseConfig(`review: {reviewer: claude[bot], trigger: ready_for_review}
approvers: [alice]
notify: {slack_channel: '#dev'}
`);
const now = new Date("2026-11-12T12:00:00Z");
const ago = (minutes: number) =>
  new Date(now.getTime() - minutes * 60_000).toISOString();

function item(over: Partial<SweepItem>): SweepItem {
  return {
    kind: "issue",
    number: 7,
    title: "t",
    url: "https://example.com/7",
    labels: [LABELS.ready],
    stateLabeledAt: ago(0),
    updatedAt: ago(0),
    readyRetries: 0,
    ...over,
  };
}

test("ready のまま 30 分を超えたら付け直す", () => {
  const actions = planSweep([item({ stateLabeledAt: ago(31) })], now, config);
  expect(actions).toEqual([{ type: "relabelReady", number: 7 }]);
});

test("付け直しても起動しなければ needs-human", () => {
  const actions = planSweep(
    [item({ stateLabeledAt: ago(31), readyRetries: 1 })],
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
  expect(planSweep([item({ stateLabeledAt: ago(29) })], now, config)).toEqual(
    [],
  );
});

test("doing・qa・fix で 3 時間動きが無ければ needs-human", () => {
  for (const label of [LABELS.doing, LABELS.qa, LABELS.fix]) {
    const stale = planSweep(
      [item({ labels: [label], updatedAt: ago(240) })],
      now,
      config,
    );
    expect(stale).toHaveLength(1);
    expect(stale[0]?.type).toBe("needsHuman");
    expect(
      planSweep([item({ labels: [label], updatedAt: ago(120) })], now, config),
    ).toEqual([]);
  }
});

test("needs-human が付いていれば何もしない", () => {
  const items = [
    item({
      labels: [LABELS.ready, LABELS.needsHuman],
      stateLabeledAt: ago(60),
    }),
    item({
      number: 8,
      labels: [LABELS.doing, LABELS.needsHuman],
      updatedAt: ago(600),
    }),
  ];
  expect(planSweep(items, now, config)).toEqual([]);
});

test("autopilot のラベルが無ければ何もしない", () => {
  expect(
    planSweep([item({ labels: ["bug"], updatedAt: ago(600) })], now, config),
  ).toEqual([]);
});

test("設定の limits に従う", () => {
  const c = {
    ...config,
    limits: { ...config.limits, readyRetryMinutes: 10, staleHours: 1 },
  };
  expect(planSweep([item({ stateLabeledAt: ago(11) })], now, c)).toHaveLength(
    1,
  );
  expect(
    planSweep([item({ labels: [LABELS.qa], updatedAt: ago(61) })], now, c),
  ).toHaveLength(1);
});
