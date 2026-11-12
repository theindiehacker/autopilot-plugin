import { expect, test } from "bun:test";
import { createGitHubClient, readFirstZipEntry } from "../src/github";

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

test("レビューを gate の形にする", async () => {
  const { fetchImpl } = fake(() =>
    Response.json([
      {
        user: { login: "a" },
        state: "APPROVED",
        commit_id: "abc",
        submitted_at: "2026-01-01T00:00:00Z",
      },
    ]),
  );
  expect(await client(fetchImpl).listReviews(1)).toEqual([
    {
      user: "a",
      state: "APPROVED",
      commitId: "abc",
      submittedAt: "2026-01-01T00:00:00Z",
    },
  ]);
});

function u32(n: number) {
  return new Uint8Array(new Uint32Array([n]).buffer);
}
function u16(n: number) {
  return new Uint8Array(new Uint16Array([n]).buffer);
}

async function zipOf(name: string, text: string): Promise<Uint8Array> {
  const raw = new TextEncoder().encode(text);
  const deflated = new Uint8Array(
    await new Response(
      new Blob([raw])
        .stream()
        .pipeThrough(new CompressionStream("deflate-raw")),
    ).arrayBuffer(),
  );
  const n = new TextEncoder().encode(name);
  const local = [
    u32(0x04034b50),
    u16(20),
    u16(0),
    u16(8),
    u16(0),
    u16(0),
    u32(0),
    u32(deflated.length),
    u32(raw.length),
    u16(n.length),
    u16(0),
    n,
    deflated,
  ];
  const localLen = local.reduce((s, p) => s + p.length, 0);
  const central = [
    u32(0x02014b50),
    u16(20),
    u16(20),
    u16(0),
    u16(8),
    u16(0),
    u16(0),
    u32(0),
    u32(deflated.length),
    u32(raw.length),
    u16(n.length),
    u16(0),
    u16(0),
    u16(0),
    u16(0),
    u32(0),
    u32(0),
    n,
  ];
  const centralLen = central.reduce((s, p) => s + p.length, 0);
  const end = [
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(1),
    u16(1),
    u32(centralLen),
    u32(localLen),
    u16(0),
  ];
  return new Uint8Array([...local, ...central, ...end].flatMap((p) => [...p]));
}

test("artifact の zip から JSON を読む", async () => {
  const zip = await zipOf("plan.json", '{"format_version":"1.2"}');
  expect(JSON.parse(await readFirstZipEntry(zip))).toEqual({
    format_version: "1.2",
  });
});
