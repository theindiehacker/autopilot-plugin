import { expect, test } from "bun:test";
import { parseConfig } from "../src/config";
import { planSweep, type SweepItem } from "../src/sweeper";
import { LABELS } from "../src/types";

const config = parseConfig(`routine_github_user: autopilot-bot
review: {reviewer: "claude[bot]", trigger: ready_for_review}
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
    wakes: [],
    updatedAt: ago(0),
    conflicting: false,
    ...over,
  };
}

const pr = (over: Partial<SweepItem> = {}): SweepItem =>
  issue({
    kind: "pr",
    number: 9,
    labels: [],
    headSha: "h1",
    issueNumber: 7,
    wakes: [],
    ...over,
  });

test("ready のまま 30 分を超えて起動しなければ付け直す", () => {
  expect(planSweep([issue({ readyLabeledAt: ago(31) })], now, config)).toEqual([
    { type: "relabelReady", number: 7 },
  ]);
});

test("付け直しても起動しなければ needs-human。何をすればよいかも書く", () => {
  expect(
    planSweep(
      [issue({ readyLabeledAt: ago(31), readyRetries: 1 })],
      now,
      config,
    ),
  ).toEqual([
    {
      type: "needsHuman",
      number: 7,
      reason:
        "autopilot:ready を付け直しましたが、30 分たっても起動しませんでした。\n直してから、needs-human を外してください。続けて、autopilot:ready を一度外してから、付け直してください。",
    },
  ]);
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

test("開始した Issue は、時間がたっても needs-human にしない", () => {
  expect(
    planSweep(
      [
        issue({
          startedAt: ago(240),
          readyLabeledAt: ago(300),
          readyRetries: 1,
          updatedAt: ago(240),
        }),
      ],
      now,
      config,
    ),
  ).toEqual([]);
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

test("ready ラベルが無い Issue は何もしない", () => {
  expect(
    planSweep([issue({ labels: [], readyLabeledAt: ago(60) })], now, config),
  ).toEqual([]);
});

test("ちょうど readyRetryMinutes なら何もしない", () => {
  expect(planSweep([issue({ readyLabeledAt: ago(30) })], now, config)).toEqual(
    [],
  );
});

test("コンフリクトの PR は、今の head への印が無ければ起こす", () => {
  expect(planSweep([pr({ conflicting: true })], now, config)).toEqual([
    {
      type: "wake",
      number: 9,
      headSha: "h1",
      reason: "コンフリクトがあります (デフォルトブランチを取り込んでください)",
    },
  ]);
});

test("動きの無い PR は、今の head への印が無ければ起こす", () => {
  expect(planSweep([pr({ updatedAt: ago(240) })], now, config)).toEqual([
    {
      type: "wake",
      number: 9,
      headSha: "h1",
      reason: "3 時間動きがありません",
    },
  ]);
});

test("起こしてから stale_hours たっても直らなければ needs-human", () => {
  expect(
    planSweep(
      [
        pr({
          conflicting: true,
          updatedAt: ago(100),
          wakes: [{ at: ago(181), headSha: "h1" }],
        }),
      ],
      now,
      config,
    ),
  ).toEqual([
    {
      type: "needsHuman",
      number: 9,
      reason:
        "起こしても、3 時間直りませんでした (コンフリクト)\n続けるときは、Issue #7 の autopilot:ready を一度外してから、付け直してください。PR の needs-human は、再開した開発のルーティンが外します。",
    },
  ]);
  expect(
    planSweep(
      [
        pr({
          updatedAt: ago(240),
          wakes: [{ at: ago(181), headSha: "h1" }],
        }),
      ],
      now,
      config,
    ),
  ).toEqual([
    {
      type: "needsHuman",
      number: 9,
      reason:
        "起こしても、3 時間直りませんでした (動きがありません)\n続けるときは、Issue #7 の autopilot:ready を一度外してから、付け直してください。PR の needs-human は、再開した開発のルーティンが外します。",
    },
  ]);
});

test("起こしてから stale_hours たっていなければ何もしない", () => {
  expect(
    planSweep(
      [
        pr({
          conflicting: true,
          wakes: [{ at: ago(60), headSha: "h1" }],
        }),
      ],
      now,
      config,
    ),
  ).toEqual([]);
});

test("新しい head では、前の head の印を数えない", () => {
  const a = planSweep(
    [pr({ conflicting: true, wakes: [{ at: ago(600), headSha: "h0" }] })],
    now,
    config,
  );
  expect(a).toHaveLength(1);
  expect(a[0]?.type).toBe("wake");
});

test("いちばん新しい印から数える", () => {
  expect(
    planSweep(
      [
        pr({
          conflicting: true,
          wakes: [
            { at: ago(600), headSha: "h1" },
            { at: ago(60), headSha: "h1" },
          ],
        }),
      ],
      now,
      config,
    ),
  ).toEqual([]);
});

test("困りごとの無い PR は、印があっても何もしない", () => {
  expect(
    planSweep(
      [pr({ updatedAt: ago(10), wakes: [{ at: ago(600), headSha: "h1" }] })],
      now,
      config,
    ),
  ).toEqual([]);
});

test("ブランチ名から Issue の番号が読めない PR は、番号を書かずに知らせる", () => {
  const a = planSweep(
    [
      pr({
        issueNumber: undefined,
        conflicting: true,
        wakes: [{ at: ago(181), headSha: "h1" }],
      }),
    ],
    now,
    config,
  );
  expect(a[0]?.type === "needsHuman" && a[0].reason).toBe(
    "起こしても、3 時間直りませんでした (コンフリクト)\n続けるときは、Issue の autopilot:ready を一度外してから、付け直してください。PR の needs-human は、再開した開発のルーティンが外します。",
  );
});

test("人のレビューを待っている PR は、動きが無くても起こさない (I2)", () => {
  expect(
    planSweep(
      [pr({ updatedAt: ago(240), reviewRequested: true })],
      now,
      config,
    ),
  ).toEqual([]);
});

test("人のレビューを待っている PR は、起こした後に動きが無くても needs-human にしない (I2)", () => {
  expect(
    planSweep(
      [
        pr({
          updatedAt: ago(240),
          reviewRequested: true,
          wakes: [{ at: ago(181), headSha: "h1" }],
        }),
      ],
      now,
      config,
    ),
  ).toEqual([]);
});

test("人のレビューを待っていても、コンフリクトなら起こす (I2)", () => {
  expect(
    planSweep([pr({ conflicting: true, reviewRequested: true })], now, config),
  ).toEqual([
    {
      type: "wake",
      number: 9,
      headSha: "h1",
      reason: "コンフリクトがあります (デフォルトブランチを取り込んでください)",
    },
  ]);
});
