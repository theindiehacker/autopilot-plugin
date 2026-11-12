import { expect, test } from "bun:test";
import { createGitHubClient } from "../src/github";

type Call = { method: string; url: string; body?: string };

function fake(respond: (call: Call) => Response): {
  fetchImpl: typeof fetch;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const call = {
      method: init?.method ?? "GET",
      url,
      ...(init?.body ? { body: String(init.body) } : {}),
    };
    calls.push(call);
    return respond(call);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const client = (fetchImpl: typeof fetch) =>
  createGitHubClient({ token: "tok-secret", repo: "o/r", fetchImpl });

test("設定はデフォルトブランチから読む", async () => {
  const { fetchImpl, calls } = fake(() => new Response("a: 1"));
  expect(
    await client(fetchImpl).getRepoFile(".github/autopilot.yml", "main"),
  ).toBe("a: 1");
  expect(calls[0]?.url).toBe(
    "https://api.github.com/repos/o/r/contents/.github/autopilot.yml?ref=main",
  );
});

test("変更したファイルを 2 ページ目まで読む", async () => {
  const file = (i: number) => ({ filename: `f${i}` });
  const { fetchImpl, calls } = fake((c) =>
    c.url.includes("page=2")
      ? Response.json(Array.from({ length: 50 }, (_, i) => file(100 + i)))
      : Response.json(
          Array.from({ length: 100 }, (_, i) => file(i)),
          {
            headers: {
              link: '<https://api.github.com/repos/o/r/pulls/1/files?per_page=100&page=2>; rel="next"',
            },
          },
        ),
  );
  const files = await client(fetchImpl).listPullFiles(1);
  expect(files).toHaveLength(150);
  expect(calls).toHaveLength(2);
});

test("removeLabel は 404 でも失敗しない", async () => {
  const { fetchImpl } = fake(() => new Response("{}", { status: 404 }));
  await client(fetchImpl).removeLabel(1, "x");
});

test("removeLabel は 404 以外では失敗する", async () => {
  const { fetchImpl } = fake(() => new Response("{}", { status: 500 }));
  expect(client(fetchImpl).removeLabel(1, "x")).rejects.toThrow("HTTP 500");
});

test("エラーにトークンを含めない", async () => {
  const { fetchImpl } = fake(() => new Response("{}", { status: 403 }));
  try {
    await client(fetchImpl).getPull(1);
    throw new Error("unreachable");
  } catch (e) {
    expect((e as Error).message).not.toContain("tok-secret");
    expect((e as Error).message).toContain("HTTP 403");
  }
});

test("enableAutoMerge は squash で GraphQL を呼ぶ", async () => {
  const { fetchImpl, calls } = fake(() => Response.json({ data: {} }));
  await client(fetchImpl).enableAutoMerge("PR_node");
  expect(calls[0]?.url).toBe("https://api.github.com/graphql");
  expect(calls[0]?.body).toContain("SQUASH");
  expect(calls[0]?.body).toContain("PR_node");
});

test("GraphQL の errors は失敗にする", async () => {
  const { fetchImpl } = fake(() =>
    Response.json({ errors: [{ message: "nope" }] }),
  );
  expect(client(fetchImpl).markReadyForReview("x")).rejects.toThrow("nope");
});
