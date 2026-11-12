import { expect, test } from "bun:test";
import {
  formatSlackMessage,
  type NotificationKind,
  sendSlack,
} from "../src/slack";
import type { AutopilotConfig } from "../src/types";

const config = {
  notify: { slackChannel: "#dev", approverMentions: ["<@U1>", "<@U2>"] },
} as AutopilotConfig;

const firstLines: Record<NotificationKind, string> = {
  approval_request: ":raised_hand: 承認をお願いします: <https://x/1|T>",
  needs_human: ":warning: 人の判断が必要です: <https://x/1|T>",
  deploy_hold:
    ":rotating_light: デプロイの後の対応を止めました (自動でロールバックしていません): <https://x/1|T>",
  deploy_rolled_back:
    ":rewind: デプロイ後の確認に失敗したため、ロールバックしました: <https://x/1|T>",
  done: ":white_check_mark: 対応が終わりました: <https://x/1|T>",
};

test.each(Object.keys(firstLines) as NotificationKind[])(
  "%s の 1 行目",
  (kind) => {
    const { text } = formatSlackMessage(
      { kind, title: "T", url: "https://x/1", details: [] },
      config,
    );
    expect(text.split("\n")[0]).toBe(firstLines[kind]);
  },
);

test("details と links を 2 行目以降に並べ、メンションは最後の行", () => {
  const { text } = formatSlackMessage(
    {
      kind: "approval_request",
      title: "T",
      url: "https://x/1",
      details: ["a", "b"],
      links: [{ label: "L", url: "https://x/2" }],
    },
    config,
  );
  expect(text.split("\n").slice(1)).toEqual([
    "a",
    "b",
    "<https://x/2|L>",
    "<@U1> <@U2>",
  ]);
});

test("承認の依頼とデプロイの保留だけ、承認者にメンションする", () => {
  const text = (kind: NotificationKind) =>
    formatSlackMessage(
      { kind, title: "T", url: "https://x/1", details: [] },
      config,
    ).text;
  expect(text("approval_request")).toContain("<@U1>");
  expect(text("deploy_hold")).toContain("<@U1>");
  expect(text("needs_human")).not.toContain("<@U1>");
  expect(text("deploy_rolled_back")).not.toContain("<@U1>");
  expect(text("done")).not.toContain("<@U1>");
});

test("title・details・label の & < > をエスケープし、一斉メンションを防ぐ", () => {
  const { text } = formatSlackMessage(
    {
      kind: "done",
      title: "<!channel> a&b",
      url: "https://x/1",
      details: ["<!here>"],
      links: [{ label: "<!everyone>", url: "https://x/2" }],
    },
    config,
  );
  expect(text).not.toContain("<!");
  expect(text).toContain("<https://x/1|&lt;!channel&gt; a&amp;b>");
  expect(text).toContain("&lt;!here&gt;");
  expect(text).toContain("<https://x/2|&lt;!everyone&gt;>");
});

test("sendSlack は JSON を POST し、500 で失敗する", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const ok = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response("ok", { status: 200 });
  }) as unknown as typeof fetch;
  await sendSlack("https://hooks.example/secret", { text: "hi" }, ok);
  expect(calls[0]?.url).toBe("https://hooks.example/secret");
  expect(calls[0]?.init?.method).toBe("POST");
  expect(new Headers(calls[0]?.init?.headers).get("Content-Type")).toBe(
    "application/json",
  );
  expect(calls[0]?.init?.body).toBe(JSON.stringify({ text: "hi" }));

  const ng = (async () =>
    new Response("no", { status: 500 })) as unknown as typeof fetch;
  const err = await sendSlack(
    "https://hooks.example/secret",
    { text: "hi" },
    ng,
  ).then(
    () => undefined,
    (e: Error) => e,
  );
  expect(err?.message).toContain("500");
  expect(err?.message).not.toContain("hooks.example");
});
