import { expect, test } from "bun:test";
import { evaluateGate, type GateInput } from "../src/gate";
import type { AutopilotConfig } from "../src/types";

const config: AutopilotConfig = {
  review: { reviewer: "claude[bot]", trigger: "none" },
  requiredChecks: [{ name: "task test" }],
  irreversible: { paths: [] },
  approvers: ["boss"],
  notify: { slackChannel: "#dev", approverMentions: [] },
  limits: { maxFixRounds: 3, staleHours: 24, readyRetryMinutes: 10 },
  deploy: {
    mode: "none",
    inputs: {},
    environments: [],
    timeoutMinutes: 30,
    rollbackAfterIrreversible: false,
  },
};

type Overrides = Omit<Partial<GateInput>, "pr"> & {
  pr?: Partial<GateInput["pr"]>;
};

function makeGateInput(overrides: Overrides = {}): GateInput {
  const { pr, ...rest } = overrides;
  return {
    pr: {
      number: 1,
      title: "t",
      url: "https://example.com/pull/1",
      headSha: "sha1",
      author: "dev",
      labels: [],
      isAutopilot: true,
      mergeable: "clean",
      autoMergeEnabled: false,
      ...pr,
    },
    changedFiles: ["src/a.ts"],
    checks: { "task test": "success", "autopilot/qa": "success" },
    reviews: [
      {
        user: "claude[bot]",
        state: "APPROVED",
        commitId: "sha1",
        submittedAt: "2026-01-01T00:00:00Z",
      },
    ],
    approverLogins: ["boss"],
    irreversible: [],
    fixRounds: 0,
    notified: [],
    ...rest,
  };
}

const approve = (user: string, commitId: string) => ({
  user,
  state: "APPROVED" as const,
  commitId,
  submittedAt: "2026-01-02T00:00:00Z",
});

test("autopilot の PR がすべてそろうと success で自動マージ", () => {
  const d = evaluateGate(makeGateInput(), config);
  expect(d.state).toBe("success");
  expect(d.actions).toEqual([{ type: "enableAutoMerge" }]);
});

test("自動マージが有効なら、もう一度は有効にしない", () => {
  const d = evaluateGate(
    makeGateInput({ pr: { autoMergeEnabled: true } }),
    config,
  );
  expect(d.state).toBe("success");
  expect(d.actions).toEqual([]);
});

test("必須のチェックが動いていなければ pending", () => {
  const d = evaluateGate(
    makeGateInput({
      checks: { "task test": "missing", "autopilot/qa": "success" },
    }),
    config,
  );
  expect(d.state).toBe("pending");
  expect(d.actions).toEqual([]);
});

test("paths に合わないチェックは待たない", () => {
  const c = {
    ...config,
    requiredChecks: [{ name: "e2e", paths: ["frontend/**"] }],
  };
  const d = evaluateGate(
    makeGateInput({
      changedFiles: ["backend/a.py"],
      checks: { "autopilot/qa": "success" },
    }),
    c,
  );
  expect(d.state).toBe("success");
});

test("paths が空配列ならいつも必須", () => {
  const c = { ...config, requiredChecks: [{ name: "e2e", paths: [] }] };
  const d = evaluateGate(
    makeGateInput({ checks: { "autopilot/qa": "success" } }),
    c,
  );
  expect(d.state).toBe("pending");
});

test("チェックの失敗で autopilot:fix を付け、失敗をコメントする", () => {
  const d = evaluateGate(
    makeGateInput({
      checks: { "task test": "failure", "autopilot/qa": "success" },
    }),
    config,
  );
  expect(d.state).toBe("failure");
  expect(d.actions).toContainEqual({
    type: "addLabel",
    label: "autopilot:fix",
  });
  const comment = d.actions.find((a) => a.type === "comment");
  expect(comment && "body" in comment && comment.body).toContain("task test");
  // 理由のコメントはラベルより先
  expect(d.actions[0]?.type).toBe("comment");
});

test("上限に達したら needs-human", () => {
  const d = evaluateGate(
    makeGateInput({
      fixRounds: 3,
      checks: { "task test": "failure", "autopilot/qa": "success" },
    }),
    config,
  );
  expect(d.actions).toContainEqual({ type: "addLabel", label: "needs-human" });
  expect(d.actions).not.toContainEqual({
    type: "addLabel",
    label: "autopilot:fix",
  });
  expect(d.actions[0]?.type).toBe("comment");
  expect(d.state).toBe("failure");
  const comment = d.actions.find((a) => a.type === "comment");
  expect(comment && "body" in comment && comment.body).toContain("task test");
});

test("autopilot:fix が付いていれば何もしない", () => {
  const d = evaluateGate(
    makeGateInput({
      pr: { labels: ["autopilot:fix"] },
      checks: { "task test": "failure", "autopilot/qa": "success" },
    }),
    config,
  );
  expect(d.state).toBe("failure");
  expect(d.actions).toEqual([]);
});

test("最新のレビューが Request changes なら対応に回す", () => {
  const d = evaluateGate(
    makeGateInput({
      reviews: [
        {
          user: "claude[bot]",
          state: "APPROVED",
          commitId: "sha0",
          submittedAt: "2026-01-01T00:00:00Z",
        },
        {
          user: "claude[bot]",
          state: "CHANGES_REQUESTED",
          commitId: "sha1",
          submittedAt: "2026-01-02T00:00:00Z",
        },
        {
          user: "claude[bot]",
          state: "COMMENTED",
          commitId: "sha1",
          submittedAt: "2026-01-03T00:00:00Z",
        },
      ],
    }),
    config,
  );
  expect(d.state).toBe("failure");
  expect(d.actions).toContainEqual({
    type: "addLabel",
    label: "autopilot:fix",
  });
});

test("コンフリクトも対応に回す", () => {
  const d = evaluateGate(
    makeGateInput({ pr: { mergeable: "conflicting" } }),
    config,
  );
  expect(d.state).toBe("failure");
  const comment = d.actions.find((a) => a.type === "comment");
  expect(comment && "body" in comment && comment.body).toContain(
    "コンフリクト",
  );
});

test("取り消せない変更は承認者の Approve を待ち、一度だけ知らせる", () => {
  const input = makeGateInput({ irreversible: ["パス: x"] });
  const d = evaluateGate(input, config);
  expect(d.state).toBe("pending");
  expect(d.actions).toEqual([
    {
      type: "notify",
      kind: "approval_request",
      key: "approval:sha1",
      reasons: ["パス: x"],
    },
  ]);
  const again = evaluateGate({ ...input, notified: ["approval:sha1"] }, config);
  expect(again.state).toBe("pending");
  expect(again.actions).toEqual([]);
});

test("作者や承認者でない人、古いコミットへの Approve は数えない", () => {
  const base = makeGateInput({ irreversible: ["パス: x"] });
  const claudeApproval = base.reviews;
  const cases: Partial<GateInput>[] = [
    {
      approverLogins: ["boss", "dev"],
      reviews: [...claudeApproval, approve("dev", "sha1")],
    },
    { reviews: [...claudeApproval, approve("stranger", "sha1")] },
    { reviews: [...claudeApproval, approve("boss", "old")] },
  ];
  for (const c of cases) {
    expect(evaluateGate({ ...base, ...c }, config).state).toBe("pending");
  }
});

test("承認者が最新のコミットを Approve すれば success", () => {
  const base = makeGateInput({ irreversible: ["パス: x"] });
  const d = evaluateGate(
    { ...base, reviews: [...base.reviews, approve("boss", "sha1")] },
    config,
  );
  expect(d.state).toBe("success");
  expect(d.actions).toEqual([{ type: "enableAutoMerge" }]);
});

test("autopilot 以外の PR はラベルも自動マージもしない", () => {
  const ok = evaluateGate(
    makeGateInput({
      pr: { isAutopilot: false },
      checks: { "task test": "success" },
      reviews: [],
    }),
    config,
  );
  expect(ok.state).toBe("success");
  expect(ok.actions).toEqual([]);
  const ng = evaluateGate(
    makeGateInput({
      pr: { isAutopilot: false },
      checks: { "task test": "failure" },
      reviews: [],
    }),
    config,
  );
  expect(ng.state).toBe("failure");
  expect(ng.actions).toEqual([]);
});

test("needs-human が付いていれば何もしない", () => {
  const d = evaluateGate(
    makeGateInput({ pr: { labels: ["needs-human"] } }),
    config,
  );
  expect(d.state).toBe("failure");
  expect(d.actions).toEqual([]);
});

test("description は 140 文字以内", () => {
  const names = Array.from({ length: 30 }, (_, i) => `check-number-${i}`);
  const c = { ...config, requiredChecks: names.map((name) => ({ name })) };
  const d = evaluateGate(makeGateInput({ checks: {} }), c);
  expect([...d.description].length).toBeLessThanOrEqual(140);
});

const rev = (
  user: string,
  state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED",
  commitId: string,
  submittedAt: string,
) => ({ user, state, commitId, submittedAt });

const claude = "claude[bot]";

test("Claude の DISMISSED だけなら pending", () => {
  const d = evaluateGate(
    makeGateInput({
      reviews: [rev(claude, "DISMISSED", "sha1", "2026-01-01T00:00:00Z")],
    }),
    config,
  );
  expect(d.state).toBe("pending");
  expect(d.actions).toEqual([]);
});

test("Claude の APPROVED が古いコミットなら pending", () => {
  const d = evaluateGate(
    makeGateInput({
      reviews: [rev(claude, "APPROVED", "old", "2026-01-01T00:00:00Z")],
    }),
    config,
  );
  expect(d.state).toBe("pending");
  expect(d.actions).toEqual([]);
});

test("Claude の APPROVED のあとに DISMISSED なら pending", () => {
  const d = evaluateGate(
    makeGateInput({
      reviews: [
        rev(claude, "APPROVED", "sha1", "2026-01-01T00:00:00Z"),
        rev(claude, "DISMISSED", "sha1", "2026-01-02T00:00:00Z"),
      ],
    }),
    config,
  );
  expect(d.state).toBe("pending");
  expect(d.actions).toEqual([]);
});

test("古いコミットへの CHANGES_REQUESTED だけでは autopilot:fix を付けない", () => {
  const d = evaluateGate(
    makeGateInput({
      reviews: [
        rev(claude, "CHANGES_REQUESTED", "old", "2026-01-01T00:00:00Z"),
      ],
    }),
    config,
  );
  expect(d.state).toBe("pending");
  expect(d.actions).toEqual([]);
});

test("承認者が Approve のあとに Request changes したら数えない", () => {
  const base = makeGateInput({ irreversible: ["パス: x"] });
  const d = evaluateGate(
    {
      ...base,
      reviews: [
        ...base.reviews,
        rev("boss", "APPROVED", "sha1", "2026-01-02T00:00:00Z"),
        rev("boss", "CHANGES_REQUESTED", "sha1", "2026-01-03T00:00:00Z"),
      ],
    },
    config,
  );
  expect(d.state).toBe("pending");
});

test("承認者が Approve のあとに DISMISSED なら数えない", () => {
  const base = makeGateInput({ irreversible: ["パス: x"] });
  const d = evaluateGate(
    {
      ...base,
      reviews: [
        ...base.reviews,
        rev("boss", "APPROVED", "sha1", "2026-01-02T00:00:00Z"),
        rev("boss", "DISMISSED", "sha1", "2026-01-03T00:00:00Z"),
      ],
    },
    config,
  );
  expect(d.state).toBe("pending");
});

test("承認者の COMMENTED は最新の判定を打ち消さない", () => {
  const base = makeGateInput({ irreversible: ["パス: x"] });
  const d = evaluateGate(
    {
      ...base,
      reviews: [
        ...base.reviews,
        rev("boss", "APPROVED", "sha1", "2026-01-02T00:00:00Z"),
        rev("boss", "COMMENTED", "sha1", "2026-01-03T00:00:00Z"),
      ],
    },
    config,
  );
  expect(d.state).toBe("success");
});

test("autopilot 以外の PR でも、取り消せない変更は承認を待つ", () => {
  const d = evaluateGate(
    makeGateInput({
      pr: { isAutopilot: false },
      irreversible: ["パス: x"],
      checks: { "task test": "success" },
      reviews: [],
    }),
    config,
  );
  expect(d.state).toBe("pending");
});

test("autopilot 以外の PR は Claude の CHANGES_REQUESTED を見ない", () => {
  const d = evaluateGate(
    makeGateInput({
      pr: { isAutopilot: false },
      checks: { "task test": "success" },
      reviews: [
        rev(claude, "CHANGES_REQUESTED", "sha1", "2026-01-01T00:00:00Z"),
      ],
    }),
    config,
  );
  expect(d.state).toBe("success");
  expect(d.actions).toEqual([]);
});

test("設定に autopilot/qa があっても二重に数えない", () => {
  const c = { ...config, requiredChecks: [{ name: "autopilot/qa" }] };
  const d = evaluateGate(
    makeGateInput({ checks: { "autopilot/qa": "failure" } }),
    c,
  );
  const comment = d.actions.find((a) => a.type === "comment");
  const body = comment && "body" in comment ? comment.body : "";
  expect(body.match(/autopilot\/qa/g)?.length).toBe(1);
});

test("設定に autopilot/gate があっても必須にしない", () => {
  const c = { ...config, requiredChecks: [{ name: "autopilot/gate" }] };
  const d = evaluateGate(
    makeGateInput({ checks: { "autopilot/qa": "success" } }),
    c,
  );
  expect(d.state).toBe("success");
});
