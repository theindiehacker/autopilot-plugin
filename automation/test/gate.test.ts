import { expect, test } from "bun:test";
import {
  evaluateIrreversible,
  type IrreversibleDecision,
  type IrreversibleInput,
  type Review,
} from "../src/gate";

function makeInput(
  overrides: Omit<Partial<IrreversibleInput>, "pr"> & {
    pr?: Partial<IrreversibleInput["pr"]>;
  } = {},
): IrreversibleInput {
  const { pr, ...rest } = overrides;
  return {
    pr: {
      number: 1,
      title: "t",
      url: "https://example.com/pull/1",
      headSha: "sha1",
      author: "dev",
      ...pr,
    },
    reviews: [],
    approverLogins: ["boss"],
    irreversible: ["パス: x"],
    notified: [],
    ...rest,
  };
}

const rev = (
  user: string,
  state: Review["state"],
  commitId: string,
  submittedAt: string,
): Review => ({ user, state, commitId, submittedAt });

const approve = (user: string, commitId: string) =>
  rev(user, "APPROVED", commitId, "2026-01-02T00:00:00Z");

const notifyAction: IrreversibleDecision["actions"][number] = {
  type: "notify",
  kind: "approval_request",
  key: "approval:sha1",
  reasons: ["パス: x"],
};

test("取り消せない変更が無ければ success", () => {
  const d = evaluateIrreversible(makeInput({ irreversible: [] }));
  expect(d).toEqual({
    state: "success",
    description: "取り消せない変更はありません",
    actions: [],
  });
});

test("承認が無ければ pending で、一度だけ知らせる", () => {
  const input = makeInput();
  const d = evaluateIrreversible(input);
  expect(d.state).toBe("pending");
  expect(d.description).toBe("承認待ち: パス: x");
  expect(d.actions).toEqual([notifyAction]);
  const again = evaluateIrreversible({ ...input, notified: ["approval:sha1"] });
  expect(again.state).toBe("pending");
  expect(again.actions).toEqual([]);
});

test("作者や承認者でない人、古いコミットへの Approve は数えない", () => {
  const cases: Partial<IrreversibleInput>[] = [
    { approverLogins: ["boss", "dev"], reviews: [approve("dev", "sha1")] },
    { reviews: [approve("stranger", "sha1")] },
    { reviews: [approve("boss", "old")] },
  ];
  for (const c of cases) {
    expect(evaluateIrreversible(makeInput(c)).state).toBe("pending");
  }
});

test("承認者が最新のコミットを Approve すれば success", () => {
  const d = evaluateIrreversible(
    makeInput({ reviews: [approve("boss", "sha1")] }),
  );
  expect(d.state).toBe("success");
  expect(d.description).toBe("承認されました: boss");
  expect(d.actions).toEqual([]);
});

test("承認者が Approve のあとに Request changes したら数えない", () => {
  const d = evaluateIrreversible(
    makeInput({
      reviews: [
        rev("boss", "APPROVED", "sha1", "2026-01-02T00:00:00Z"),
        rev("boss", "CHANGES_REQUESTED", "sha1", "2026-01-03T00:00:00Z"),
      ],
    }),
  );
  expect(d.state).toBe("pending");
  expect(d.actions).toContainEqual(notifyAction);
});

test("承認者が Approve のあとに DISMISSED なら数えない", () => {
  const d = evaluateIrreversible(
    makeInput({
      reviews: [
        rev("boss", "APPROVED", "sha1", "2026-01-02T00:00:00Z"),
        rev("boss", "DISMISSED", "sha1", "2026-01-03T00:00:00Z"),
      ],
    }),
  );
  expect(d.state).toBe("pending");
  expect(d.actions).toContainEqual(notifyAction);
});

test("承認者の COMMENTED は最新の判定を打ち消さない", () => {
  const d = evaluateIrreversible(
    makeInput({
      reviews: [
        rev("boss", "APPROVED", "sha1", "2026-01-02T00:00:00Z"),
        rev("boss", "COMMENTED", "sha1", "2026-01-03T00:00:00Z"),
      ],
    }),
  );
  expect(d.state).toBe("success");
});

test("同じ時刻なら、後に並んだ承認者のレビューを使う", () => {
  const t = "2026-01-02T00:00:00Z";
  const d = evaluateIrreversible(
    makeInput({
      reviews: [
        rev("boss", "APPROVED", "sha1", t),
        rev("boss", "CHANGES_REQUESTED", "sha1", t),
      ],
    }),
  );
  expect(d.state).toBe("pending");
  expect(d.actions[0]?.type).toBe("notify");
});

test("submittedAt が読めないレビューは、読めるものより古い扱い", () => {
  const d = evaluateIrreversible(
    makeInput({
      reviews: [
        rev("boss", "APPROVED", "sha1", "not-a-date"),
        rev("boss", "CHANGES_REQUESTED", "sha1", "2026-01-02T00:00:00Z"),
      ],
    }),
  );
  expect(d.state).toBe("pending");
  expect(d.actions[0]?.type).toBe("notify");
});

test("description は 140 文字以内", () => {
  const reasons = Array.from({ length: 30 }, (_, i) => `パス: file-${i}`);
  const d = evaluateIrreversible(makeInput({ irreversible: reasons }));
  expect([...d.description].length).toBeLessThanOrEqual(140);
  expect(d.description.endsWith("…")).toBe(true);
});
