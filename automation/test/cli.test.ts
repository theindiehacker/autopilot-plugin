import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../src/cli";
import type { Deps } from "../src/commands/context";

const realConsoleError = console.error;

const CONFIG = `
review: { reviewer: claude }
limits: { max_fix_rounds: 3 }
`;

interface PullData {
  number: number;
  title?: string;
  draft?: boolean;
  ref?: string;
  repo?: string;
  labels?: string[];
  mergeable_state?: string;
  updated_at?: string;
  created_at?: string;
}

interface IssueData {
  number: number;
  created_at?: string;
  labels?: string[];
  events?: { event: string; created_at: string; label: { name: string } }[];
  comments?: { body: string; login: string }[];
  updated_at?: string;
}

interface World {
  pulls: PullData[];
  issues: IssueData[];
  dispatches: { workflow: string; inputs: unknown }[];
  urls: string[];
  removed: string[];
  /** ref ごとの設定 ("*" はどの ref でも) */
  configs: Record<string, string>;
  /** この PR の取得で例外を投げる */
  throwOnPull?: string;
}

function newWorld(): World {
  return {
    pulls: [],
    issues: [],
    dispatches: [],
    urls: [],
    removed: [],
    configs: {},
  };
}

function commentsOf(w: World, n: number) {
  const issue = w.issues.find((i) => i.number === n);
  if (!issue) throw new Error(`no issue ${n}`);
  issue.comments = issue.comments ?? [];
  return issue.comments;
}

function pullJson(p: PullData) {
  return {
    number: p.number,
    node_id: `node${p.number}`,
    title: p.title ?? `PR ${p.number}`,
    html_url: `https://github.com/o/r/pull/${p.number}`,
    state: "open",
    body: null,
    created_at: p.created_at ?? "2026-11-12T00:00:00Z",
    draft: p.draft ?? false,
    merged: false,
    merge_commit_sha: null,
    mergeable_state: p.mergeable_state ?? "clean",
    updated_at: p.updated_at ?? "2026-11-12T00:00:00Z",
    user: { login: "author" },
    labels: (p.labels ?? []).map((name) => ({ name })),
    auto_merge: null,
    head: {
      sha: `sha${p.number}`,
      ref: p.ref ?? `autopilot/${p.number}-x`,
      repo: { full_name: p.repo ?? "o/r" },
    },
  };
}

function fakeFetch(w: World): typeof fetch {
  return (async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    const method = init?.method ?? "GET";
    const path = url.pathname.replace("/repos/o/r", "");
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    w.urls.push(`${method} ${url.pathname}${url.search}`);
    const id = (re: RegExp): number | undefined => {
      const v = path.match(re)?.[1];
      return v === undefined ? undefined : Number(v);
    };
    const pullNo = id(/^\/pulls\/(\d+)/);
    if (pullNo !== undefined && w.throwOnPull) throw new Error(w.throwOnPull);
    const issueNo = id(/^\/issues\/(\d+)/);

    if (path === "")
      return Response.json({ default_branch: "main", full_name: "o/r" });
    if (path.startsWith("/contents/"))
      return new Response(
        w.configs[url.searchParams.get("ref") ?? ""] ??
          w.configs["*"] ??
          CONFIG,
      );
    if (pullNo !== undefined)
      return Response.json(
        pullJson(w.pulls.find((p) => p.number === pullNo) as PullData),
      );
    if (path === "/pulls") return Response.json(w.pulls.map(pullJson));
    if (path === "/issues" && method === "GET")
      return Response.json(
        w.issues
          .filter((i) => {
            const label = url.searchParams.get("labels");
            return label === null || i.labels?.includes(label);
          })
          .map((i) => ({
            number: i.number,
            title: `Issue ${i.number}`,
            body: null,
            created_at: i.created_at ?? "2026-11-01T00:00:00Z",
            html_url: `https://github.com/o/r/issues/${i.number}`,
            updated_at: i.updated_at ?? "2026-11-12T00:00:00Z",
            labels: (i.labels ?? []).map((name) => ({ name })),
          })),
      );
    if (issueNo !== undefined && path.endsWith("/events"))
      return Response.json(
        w.issues.find((i) => i.number === issueNo)?.events ?? [],
      );
    if (
      issueNo !== undefined &&
      path.endsWith("/comments") &&
      method === "POST"
    ) {
      if (!w.issues.some((i) => i.number === issueNo))
        w.issues.push({ number: issueNo });
      commentsOf(w, issueNo).push({ body: body.body, login: "app[bot]" });
      return Response.json({});
    }
    if (
      issueNo !== undefined &&
      path.endsWith("/labels") &&
      method === "POST"
    ) {
      let issue = w.issues.find((i) => i.number === issueNo);
      if (!issue) {
        issue = { number: issueNo };
        w.issues.push(issue);
      }
      issue.labels = [...(issue.labels ?? []), ...body.labels];
      return Response.json([]);
    }
    if (issueNo !== undefined && method === "DELETE") {
      w.removed.push(path);
      return new Response("{}");
    }
    if (path.includes("/dispatches")) {
      w.dispatches.push({
        workflow: decodeURIComponent(path.split("/")[3] ?? ""),
        inputs: body.inputs,
      });
      return new Response(null, { status: 204 });
    }
    return new Response(`unexpected ${method} ${path}`, { status: 500 });
  }) as unknown as typeof fetch;
}

async function run(
  w: World,
  command: string,
  eventName: string,
  event: unknown,
  extra: Record<string, string> = {},
  deps: Partial<Deps> = {},
) {
  const dir = mkdtempSync(join(tmpdir(), "autopilot-"));
  const eventPath = join(dir, "event.json");
  const outPath = join(dir, "output");
  writeFileSync(eventPath, JSON.stringify(event));
  writeFileSync(outPath, "");
  let clock = Date.parse("2026-11-12T12:00:00Z");
  const origLog = console.log;
  const origErr = console.error;
  console.log = () => {};
  if (console.error === realConsoleError) console.error = () => {};
  const code = await main(
    [command],
    {
      GITHUB_TOKEN: "tok-secret",
      GITHUB_REPOSITORY: "o/r",
      GITHUB_EVENT_NAME: eventName,
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_OUTPUT: outPath,
      GITHUB_RUN_ID: "7",
      AUTOPILOT_APP_SLUG: "app",
      ...extra,
    },
    {
      fetchImpl: fakeFetch(w),
      now: () => new Date(clock),
      sleep: async (ms) => {
        clock += ms;
      },
      ...deps,
    },
  );
  console.log = origLog;
  console.error = origErr;
  return { code, output: readFileSync(outPath, "utf8") };
}

test("設定はデフォルトブランチから読む", async () => {
  const w = newWorld();
  await run(w, "sweep", "schedule", {});
  expect(w.urls).toContain(
    "GET /repos/o/r/contents/.github/autopilot.yml?ref=main",
  );
});

test("消した項目が設定に残っていても、sweep は動く", async () => {
  const w = newWorld();
  w.configs["*"] =
    `${CONFIG}routine_github_user: x\nnotify: {slack_channel: "#dev"}\ndeploy: {mode: on_merge}\n`;
  expect((await run(w, "sweep", "schedule", {})).code).toBe(0);
});

test("消したコマンドは不明なコマンドとして 2 を返す", async () => {
  const orig = console.error;
  console.error = () => {};
  try {
    for (const c of ["automerge", "label", "fix-round", "ready", "deploy"])
      expect(await main([c], {})).toBe(2);
  } finally {
    console.error = orig;
  }
});

test("sweep の readyRetries は autopilot:ready の labeled の数 − 1", async () => {
  const w = newWorld();
  const ev = (t: string) => ({
    event: "labeled",
    created_at: t,
    label: { name: "autopilot:ready" },
  });
  // 2 回付いた → readyRetries=1 → 時間切れで needs-human
  w.issues.push({
    number: 10,
    labels: ["autopilot:ready"],
    events: [ev("2026-11-12T08:00:00Z"), ev("2026-11-12T09:00:00Z")],
  });
  // 1 回だけ → readyRetries=0 → 付け直し
  w.issues.push({
    number: 11,
    labels: ["autopilot:ready"],
    events: [ev("2026-11-12T09:00:00Z")],
  });
  const { code } = await run(w, "sweep", "schedule", {});
  expect(code).toBe(0);
  expect(w.issues.find((i) => i.number === 10)?.labels).toContain(
    "needs-human",
  );
  expect(w.removed).toEqual(["/issues/11/labels/autopilot%3Aready"]);
  expect(
    w.issues
      .find((i) => i.number === 11)
      ?.labels?.filter((l) => l === "autopilot:ready"),
  ).toHaveLength(2);
});

test("sweep は衝突した autopilot の PR の対応を起動する", async () => {
  const w = newWorld();
  w.pulls.push(
    { number: 8, mergeable_state: "dirty" },
    { number: 9, ref: "feature/y", mergeable_state: "dirty" },
  );
  await run(
    w,
    "sweep",
    "schedule",
    {},
    { GITHUB_WORKFLOW_REF: "o/r/.github/workflows/auto.yml@refs/heads/main" },
  );
  expect(w.dispatches).toEqual([{ workflow: "auto.yml", inputs: { pr: "8" } }]);
});
test("不明なコマンドは 2 を返す", async () => {
  const orig = console.error;
  console.error = () => {};
  try {
    expect(await main(["nope"], {})).toBe(2);
  } finally {
    console.error = orig;
  }
});

// ---- 修正の周回 1 ----

test("main は必須の環境変数が無ければ動かない (I3)", async () => {
  const errors: string[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => errors.push(a.join(" "));
  try {
    const env = { GITHUB_TOKEN: "t", GITHUB_REPOSITORY: "o/r" };
    expect(await main(["sweep"], env)).toBe(1);
    expect(await main(["sweep"], { ...env, AUTOPILOT_APP_SLUG: "" })).toBe(1);
  } finally {
    console.error = orig;
  }
  expect(errors[0]).toContain("AUTOPILOT_APP_SLUG");
});

test("sweep は labeled の event が無ければ Issue の作成時刻を使う (M7)", async () => {
  const w = newWorld();
  w.issues.push({
    number: 13,
    labels: ["autopilot:ready"],
    created_at: "2026-11-12T08:00:00Z",
  });
  await run(w, "sweep", "schedule", {});
  expect(w.removed).toEqual(["/issues/13/labels/autopilot%3Aready"]);
});

test("エラーに秘密を出さない。メッセージにトークンが入っていても伏せる (M5)", async () => {
  const w = newWorld();
  w.pulls.push({ number: 1, mergeable_state: "dirty" });
  w.throwOnPull = "connect failed tok-secret";
  const errors: string[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => errors.push(a.join(" "));
  try {
    const { code } = await run(w, "sweep", "schedule", {});
    expect(code).toBe(1);
  } finally {
    console.error = orig;
  }
  expect(errors.join("\n")).toContain("connect failed");
  expect(errors.join("\n")).not.toContain("tok-secret");
});

const READY_EVENTS = [
  {
    event: "labeled",
    created_at: "2026-11-12T08:00:00Z",
    label: { name: "autopilot:ready" },
  },
];

test("sweep は、ラベルより後に作られた開発の PR を、開始とみなす", async () => {
  const w = newWorld();
  // 開始から 24 時間をこえても PR がある (hasPr) ので、止めない。付け直しもしない
  w.issues.push({
    number: 14,
    labels: ["autopilot:ready"],
    events: READY_EVENTS,
  });
  w.pulls.push({
    number: 20,
    ref: "autopilot/14-dev",
    draft: true,
    created_at: "2026-11-12T08:05:00Z",
    updated_at: "2026-11-12T11:00:00Z",
  });
  await run(w, "sweep", "schedule", {});
  expect(w.removed).toEqual([]);
  expect(w.issues[0]?.labels).toEqual(["autopilot:ready"]);
  expect(commentsOf(w, 14)).toHaveLength(0);
});

test("sweep は、ラベルより前に作られた PR を、開始とみなさない", async () => {
  const w = newWorld();
  w.issues.push({
    number: 15,
    labels: ["autopilot:ready"],
    events: READY_EVENTS,
  });
  w.pulls.push({
    number: 21,
    ref: "autopilot/15-dev",
    created_at: "2026-11-12T07:00:00Z",
    updated_at: "2026-11-12T11:00:00Z",
  });
  await run(w, "sweep", "schedule", {});
  // 開始の印が無いものとして、付け直す
  expect(w.removed).toEqual(["/issues/15/labels/autopilot%3Aready"]);
});
