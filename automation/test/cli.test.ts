import { expect, test } from "bun:test";
import { main } from "../src/cli";

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
  requested_reviewers?: string[];
  requested_teams?: string[];
}

interface IssueData {
  number: number;
  created_at?: string;
  labels?: string[];
  events?: { event: string; created_at: string; label: { name: string } }[];
  comments?: { body: string; login: string; created_at?: string }[];
  updated_at?: string;
}

interface World {
  pulls: PullData[];
  issues: IssueData[];
  dispatches: unknown[];
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
    requested_reviewers: (p.requested_reviewers ?? []).map((login) => ({
      login,
    })),
    requested_teams: (p.requested_teams ?? []).map((slug) => ({ slug })),
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
    if (issueNo !== undefined && path.endsWith("/comments") && method === "GET")
      return Response.json(
        (w.issues.find((i) => i.number === issueNo)?.comments ?? []).map(
          (c) => ({
            body: c.body,
            created_at: c.created_at ?? "2026-11-12T00:00:00Z",
            user: { login: c.login },
          }),
        ),
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
      w.dispatches.push(body);
      return new Response(null, { status: 204 });
    }
    return new Response(`unexpected ${method} ${path}`, { status: 500 });
  }) as unknown as typeof fetch;
}

async function run(w: World) {
  const origLog = console.log;
  const origErr = console.error;
  console.log = () => {};
  if (console.error === realConsoleError) console.error = () => {};
  const code = await main(
    ["sweep"],
    {
      GITHUB_TOKEN: "tok-secret",
      GITHUB_REPOSITORY: "o/r",
      AUTOPILOT_APP_SLUG: "app",
    },
    {
      fetchImpl: fakeFetch(w),
      now: () => new Date("2026-11-12T12:00:00Z"),
    },
  );
  console.log = origLog;
  console.error = origErr;
  return { code };
}

const ev = (event: string, name: string, created_at: string) => ({
  event,
  created_at,
  label: { name },
});

test("設定はデフォルトブランチから読む", async () => {
  const w = newWorld();
  await run(w);
  expect(w.urls).toContain(
    "GET /repos/o/r/contents/.github/autopilot.yml?ref=main",
  );
});

test("消した項目が設定に残っていても、sweep は動く", async () => {
  const w = newWorld();
  w.configs["*"] =
    `${CONFIG}routine_github_user: x\nnotify: {slack_channel: "#dev"}\ndeploy: {mode: on_merge}\n`;
  expect((await run(w)).code).toBe(0);
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
  const ready = (t: string) => ev("labeled", "autopilot:ready", t);
  // 2 回付いた → readyRetries=1 → 時間切れで needs-human
  w.issues.push({
    number: 10,
    labels: ["autopilot:ready"],
    events: [ready("2026-11-12T08:00:00Z"), ready("2026-11-12T09:00:00Z")],
  });
  // 1 回だけ → readyRetries=0 → 付け直し
  w.issues.push({
    number: 11,
    labels: ["autopilot:ready"],
    events: [ready("2026-11-12T09:00:00Z")],
  });
  const { code } = await run(w);
  expect(code).toBe(0);
  expect(w.issues.find((i) => i.number === 10)?.labels).toContain(
    "needs-human",
  );
  // 何をすればよいかも書く (I4)
  expect(commentsOf(w, 10).at(-1)?.body).toBe(
    "<!-- autopilot:needs-human -->\nautopilot:ready を付け直しましたが、30 分たっても起動しませんでした。\n直してから、needs-human を外してください。続けて、autopilot:ready を一度外してから、付け直してください。",
  );
  expect(w.removed).toEqual(["/issues/11/labels/autopilot%3Aready"]);
  expect(
    w.issues
      .find((i) => i.number === 11)
      ?.labels?.filter((l) => l === "autopilot:ready"),
  ).toHaveLength(2);
});

test("sweep は、衝突した autopilot の PR に印のコメントを書いて起こす。workflow_dispatch は呼ばない", async () => {
  const w = newWorld();
  w.pulls.push(
    { number: 8, mergeable_state: "dirty" },
    { number: 9, ref: "feature/y", mergeable_state: "dirty" },
  );
  await run(w);
  expect(commentsOf(w, 8)).toEqual([
    {
      login: "app[bot]",
      body: "<!-- autopilot:wake -->\n<!-- autopilot:head sha8 -->\nautopilot の見回り: コンフリクトがあります (デフォルトブランチを取り込んでください)。開発のセッションは、この PR を見直して、直すことがあれば直してください。",
    },
  ]);
  expect(w.issues.some((i) => i.number === 9)).toBe(false);
  expect(w.dispatches).toEqual([]);
  expect(w.urls.some((u) => u.includes("/dispatches"))).toBe(false);
});

test("sweep は、App のボット以外の印を数えない", async () => {
  const w = newWorld();
  w.pulls.push({ number: 8, mergeable_state: "dirty" });
  w.issues.push({
    number: 8,
    comments: [
      {
        login: "someone",
        body: "<!-- autopilot:wake -->\n<!-- autopilot:head sha8 -->\nx",
        created_at: "2026-11-01T00:00:00Z",
      },
    ],
  });
  await run(w);
  const c = commentsOf(w, 8);
  expect(c).toHaveLength(2);
  expect(c[1]?.login).toBe("app[bot]");
  expect(w.issues[0]?.labels).toBeUndefined();
});

test("sweep は、起こして stale_hours たっても直らない PR を needs-human にする。ブランチ名の Issue の番号で、何をすればよいかも書く", async () => {
  const w = newWorld();
  w.pulls.push({ number: 8, ref: "autopilot/14-x", mergeable_state: "dirty" });
  w.issues.push({
    number: 8,
    comments: [
      {
        login: "app[bot]",
        body: "<!-- autopilot:wake -->\n<!-- autopilot:head sha8 -->\nx",
        created_at: "2026-11-12T08:00:00Z",
      },
    ],
  });
  await run(w);
  expect(w.issues[0]?.labels).toEqual(["needs-human"]);
  expect(commentsOf(w, 8).at(-1)?.body).toBe(
    "<!-- autopilot:needs-human -->\n起こしても、3 時間直りませんでした (コンフリクト)\n続けるときは、Issue #14 の autopilot:ready を一度外してから、付け直してください。PR の needs-human は、再開した開発のルーティンが外します。",
  );
});

test("sweep の needs-human は、ラベルを先に付け、印のコメントを後に書く (R53)", async () => {
  const w = newWorld();
  w.pulls.push({ number: 8, mergeable_state: "dirty" });
  w.issues.push({
    number: 8,
    comments: [
      {
        login: "app[bot]",
        body: "<!-- autopilot:wake -->\n<!-- autopilot:head sha8 -->\nx",
        created_at: "2026-11-12T08:00:00Z",
      },
    ],
  });
  await run(w);
  const label = w.urls.indexOf("POST /repos/o/r/issues/8/labels");
  const comment = w.urls.indexOf("POST /repos/o/r/issues/8/comments");
  expect(label).toBeGreaterThanOrEqual(0);
  expect(comment).toBeGreaterThanOrEqual(0);
  expect(label).toBeLessThan(comment);
});

test("sweep は、開始の印のコメントだけがある Issue を、開始とみなさない (付け直す)", async () => {
  const w = newWorld();
  w.issues.push({
    number: 16,
    labels: ["autopilot:ready"],
    events: READY_EVENTS,
    comments: [{ login: "app[bot]", body: "<!-- autopilot:started -->" }],
  });
  await run(w);
  expect(w.removed).toEqual(["/issues/16/labels/autopilot%3Aready"]);
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
  await run(w);
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
    const { code } = await run(w);
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
  // 付け直しも、needs-human もしない
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
  await run(w);
  expect(w.removed).toEqual([]);
  expect(w.issues[0]?.labels).toEqual(["autopilot:ready"]);
  expect(commentsOf(w, 14)).toHaveLength(0);
});

test("sweep は、ラベルより前に作られ、ラベルより後に更新されていない PR を、開始とみなさない", async () => {
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
    updated_at: "2026-11-12T07:30:00Z",
  });
  await run(w);
  // 始まっていないものとして、付け直す
  expect(w.removed).toEqual(["/issues/15/labels/autopilot%3Aready"]);
});

const RETRIED_EVENTS = [
  ev("labeled", "autopilot:ready", "2026-11-12T08:00:00Z"),
  ev("labeled", "autopilot:ready", "2026-11-12T09:00:00Z"),
];

test("sweep は、ラベルより前に作られ、ラベルより後に更新された PR を、開始とみなす (前の PR を使い続ける再開。C1)", async () => {
  const w = newWorld();
  // 付け直した後 (readyRetries=1) でも、再開の push で PR が更新されていれば、needs-human にしない
  w.issues.push({
    number: 15,
    labels: ["autopilot:ready"],
    events: RETRIED_EVENTS,
  });
  w.pulls.push({
    number: 21,
    ref: "autopilot/15-dev",
    created_at: "2026-11-12T07:00:00Z",
    updated_at: "2026-11-12T09:05:00Z",
  });
  await run(w);
  expect(w.removed).toEqual([]);
  expect(w.issues.find((i) => i.number === 15)?.labels).toEqual([
    "autopilot:ready",
  ]);
  expect(commentsOf(w, 15)).toHaveLength(0);
});

test("sweep は、再開の push で head が変わった PR を、前の head の印で needs-human にしない (I5)", async () => {
  const w = newWorld();
  w.issues.push({
    number: 15,
    labels: ["autopilot:ready"],
    events: RETRIED_EVENTS,
  });
  // コンフリクトで止まった PR。前の head への印は、stale_hours より前のもの
  w.pulls.push({
    number: 21,
    ref: "autopilot/15-dev",
    created_at: "2026-11-11T00:00:00Z",
    updated_at: "2026-11-12T09:05:00Z",
    mergeable_state: "dirty",
  });
  w.issues.push({
    number: 21,
    comments: [
      {
        login: "app[bot]",
        body: "<!-- autopilot:wake -->\n<!-- autopilot:head shaOLD -->\nx",
        created_at: "2026-11-11T12:00:00Z",
      },
    ],
  });
  await run(w);
  expect(w.issues.find((i) => i.number === 15)?.labels).toEqual([
    "autopilot:ready",
  ]);
  expect(w.issues.find((i) => i.number === 21)?.labels).toBeUndefined();
  expect(commentsOf(w, 21).at(-1)?.body).toStartWith(
    "<!-- autopilot:wake -->\n<!-- autopilot:head sha21 -->\n",
  );
});

test("sweep の readyRetries は、needs-human が最後に外された後の autopilot:ready の labeled だけを数える (M5)", async () => {
  const w = newWorld();
  // 前の試みで、見回りが付け直し、止まった。人が needs-human を外して、付け直した
  w.issues.push({
    number: 17,
    labels: ["autopilot:ready"],
    events: [
      ev("labeled", "autopilot:ready", "2026-11-12T06:00:00Z"),
      ev("labeled", "autopilot:ready", "2026-11-12T06:40:00Z"),
      ev("labeled", "needs-human", "2026-11-12T07:20:00Z"),
      ev("unlabeled", "needs-human", "2026-11-12T10:00:00Z"),
      ev("unlabeled", "autopilot:ready", "2026-11-12T10:00:00Z"),
      ev("labeled", "autopilot:ready", "2026-11-12T10:00:00Z"),
    ],
  });
  // 外した後に 2 回付いた (付け直しても起動しなかった)
  w.issues.push({
    number: 18,
    labels: ["autopilot:ready"],
    events: [
      ev("labeled", "autopilot:ready", "2026-11-12T06:00:00Z"),
      ev("labeled", "needs-human", "2026-11-12T07:00:00Z"),
      ev("unlabeled", "needs-human", "2026-11-12T09:00:00Z"),
      ev("labeled", "autopilot:ready", "2026-11-12T09:00:00Z"),
      ev("labeled", "autopilot:ready", "2026-11-12T10:00:00Z"),
    ],
  });
  await run(w);
  expect(w.removed).toEqual(["/issues/17/labels/autopilot%3Aready"]);
  expect(w.issues.find((i) => i.number === 17)?.labels).not.toContain(
    "needs-human",
  );
  expect(w.issues.find((i) => i.number === 18)?.labels).toContain(
    "needs-human",
  );
});

test("sweep は、review が無くても、qa・review・required_checks に不備があっても動く (M4)", async () => {
  for (const config of [
    "limits: { stale_hours: 3 }\n",
    "review: {trigger: x}\nqa: 1\nrequired_checks: 2\n",
  ]) {
    const w = newWorld();
    w.configs["*"] = config;
    w.pulls.push({ number: 8, mergeable_state: "dirty" });
    expect((await run(w)).code).toBe(0);
    expect(commentsOf(w, 8)).toHaveLength(1);
  }
});

test("sweep は、人にレビューを頼んでいる PR (requested_reviewers・requested_teams) を、動きが無くても起こさない (I2)", async () => {
  const w = newWorld();
  // どれも 12 時間動きが無い
  w.pulls.push(
    { number: 8, requested_reviewers: ["owner"] },
    { number: 9, requested_teams: ["owners"] },
    { number: 10 },
  );
  await run(w);
  expect(w.issues.some((i) => i.number === 8)).toBe(false);
  expect(w.issues.some((i) => i.number === 9)).toBe(false);
  expect(commentsOf(w, 10).at(-1)?.body).toStartWith(
    "<!-- autopilot:wake -->\n<!-- autopilot:head sha10 -->\n",
  );
});

test("sweep は、人にレビューを頼んでいる PR でも、コンフリクトなら起こす (I2)", async () => {
  const w = newWorld();
  w.pulls.push({
    number: 8,
    mergeable_state: "dirty",
    requested_reviewers: ["owner"],
  });
  await run(w);
  expect(commentsOf(w, 8).at(-1)?.body).toStartWith(
    "<!-- autopilot:wake -->\n<!-- autopilot:head sha8 -->\n",
  );
});
