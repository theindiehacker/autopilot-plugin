import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../src/cli";

const CONFIG = `
routine_github_user: routine-user
review: { reviewer: claude }
approvers: [alice]
irreversible: { paths: ["db/migrations/**"] }
notify: { slack_channel: "#dev", approver_mentions: ["<@U1>"] }
limits: { max_fix_rounds: 3 }
`;

interface PullData {
  number: number;
  title?: string;
  draft?: boolean;
  merged?: boolean;
  ref?: string;
  repo?: string;
  labels?: string[];
  autoMerge?: boolean;
  files?: string[];
  reviews?: unknown[];
  mergeable_state?: string;
  updated_at?: string;
}

interface IssueData {
  number: number;
  labels?: string[];
  events?: { event: string; created_at: string; label: { name: string } }[];
  comments?: { body: string; login: string; created_at?: string }[];
  updated_at?: string;
}

interface World {
  pulls: PullData[];
  issues: IssueData[];
  statuses: {
    sha: string;
    context: string;
    state: string;
    description: string;
  }[];
  dispatches: { workflow: string; inputs: unknown }[];
  graphql: string[];
  urls: string[];
  slack: string[];
  removed: string[];
  createdIssues: { title: string; body: string; labels: string[] }[];
}

function newWorld(): World {
  return {
    pulls: [],
    issues: [],
    statuses: [],
    dispatches: [],
    graphql: [],
    urls: [],
    slack: [],
    removed: [],
    createdIssues: [],
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
    draft: p.draft ?? false,
    merged: p.merged ?? false,
    merge_commit_sha: "merge123",
    mergeable_state: p.mergeable_state ?? "clean",
    updated_at: p.updated_at ?? "2026-11-12T00:00:00Z",
    user: { login: "author" },
    labels: (p.labels ?? []).map((name) => ({ name })),
    auto_merge: p.autoMerge ? {} : null,
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
    // パスの正規表現に合えば、番号を返す
    const id = (re: RegExp): number | undefined => {
      const v = path.match(re)?.[1];
      return v === undefined ? undefined : Number(v);
    };
    const pull = (n: number) => w.pulls.find((p) => p.number === n);
    const pullNo = id(/^\/pulls\/(\d+)/);
    const issueNo = id(/^\/issues\/(\d+)/);

    if (url.host === "slack.test") {
      w.slack.push(body.text);
      return new Response("ok");
    }
    if (url.pathname === "/graphql") {
      w.graphql.push(body.query);
      return Response.json({ data: {} });
    }
    if (path === "")
      return Response.json({ default_branch: "main", full_name: "o/r" });
    if (path.startsWith("/contents/")) return new Response(CONFIG);
    if (pullNo !== undefined && path.endsWith("/files"))
      return Response.json(
        (pull(pullNo)?.files ?? []).map((filename) => ({ filename })),
      );
    if (pullNo !== undefined && path.endsWith("/reviews"))
      return Response.json(pull(pullNo)?.reviews ?? []);
    if (pullNo !== undefined)
      return Response.json(pullJson(pull(pullNo) as PullData));
    if (path === "/pulls") return Response.json(w.pulls.map(pullJson));
    if (path === "/issues" && method === "GET")
      return Response.json(
        w.issues
          .filter((i) =>
            i.labels?.includes(url.searchParams.get("labels") ?? ""),
          )
          .map((i) => ({
            number: i.number,
            title: `Issue ${i.number}`,
            body: null,
            html_url: `https://github.com/o/r/issues/${i.number}`,
            updated_at: i.updated_at ?? "2026-11-12T00:00:00Z",
            labels: (i.labels ?? []).map((name) => ({ name })),
          })),
      );
    if (path === "/issues") {
      w.createdIssues.push(body);
      return Response.json({ number: 99 });
    }
    if (issueNo !== undefined && path.endsWith("/events"))
      return Response.json(
        w.issues.find((i) => i.number === issueNo)?.events ?? [],
      );
    if (issueNo !== undefined && path.endsWith("/comments")) {
      if (method === "POST") {
        if (!w.issues.some((i) => i.number === issueNo))
          w.issues.push({ number: issueNo });
        commentsOf(w, issueNo).push({ body: body.body, login: "app[bot]" });
        return Response.json({});
      }
      return Response.json(
        (w.issues.find((i) => i.number === issueNo)?.comments ?? []).map(
          (c, i) => ({
            id: i,
            body: c.body,
            created_at: c.created_at ?? "2026-11-12T00:00:00Z",
            user: { login: c.login },
          }),
        ),
      );
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
    if (path.startsWith("/statuses/")) {
      w.statuses.push({
        sha: path.split("/")[2] ?? "",
        context: body.context,
        state: body.state,
        description: body.description,
      });
      return Response.json({});
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

// issues を POST するとき path は "/issues" (一覧は GET) なので上で分けている
async function run(
  w: World,
  command: string,
  eventName: string,
  event: unknown,
  extra: Record<string, string> = {},
) {
  const dir = mkdtempSync(join(tmpdir(), "autopilot-"));
  const eventPath = join(dir, "event.json");
  const outPath = join(dir, "output");
  writeFileSync(eventPath, JSON.stringify(event));
  writeFileSync(outPath, "");
  const code = await main(
    [command],
    {
      GITHUB_TOKEN: "tok-secret",
      GITHUB_REPOSITORY: "o/r",
      GITHUB_EVENT_NAME: eventName,
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_OUTPUT: outPath,
      GITHUB_RUN_ID: "7",
      AUTOPILOT_SLACK_WEBHOOK_URL: "https://slack.test/hook-secret",
      AUTOPILOT_APP_SLUG: "app",
      ...extra,
    },
    {
      fetchImpl: fakeFetch(w),
      now: () => new Date("2026-11-12T12:00:00Z"),
      sleep: async () => {},
    },
  );
  return { code, output: readFileSync(outPath, "utf8") };
}

const prEvent = (n: number, action: string) => ({
  action,
  pull_request: { number: n },
});

test("設定はデフォルトブランチから読む", async () => {
  const w = newWorld();
  w.pulls.push({ number: 1 });
  await run(w, "automerge", "pull_request_target", prEvent(1, "opened"));
  expect(w.urls).toContain(
    "GET /repos/o/r/contents/.github/autopilot.yml?ref=main",
  );
});

test("automerge は autopilot の PR で自動マージを有効にする", async () => {
  const w = newWorld();
  w.pulls.push({ number: 1 });
  const { code } = await run(
    w,
    "automerge",
    "pull_request_target",
    prEvent(1, "opened"),
  );
  expect(code).toBe(0);
  expect(w.graphql).toHaveLength(1);
});

test("フォークの PR は autopilot の PR とみなさない", async () => {
  const w = newWorld();
  w.pulls.push({ number: 1, repo: "fork/r" });
  await run(w, "automerge", "pull_request_target", prEvent(1, "opened"));
  expect(w.graphql).toHaveLength(0);
});

test("irreversible は判定をステータスに付け、2 回動かしても Slack は 1 回だけ", async () => {
  const w = newWorld();
  w.pulls.push({ number: 5, files: ["db/migrations/001.sql"] });
  w.issues.push({ number: 5 });
  await run(w, "irreversible", "pull_request_target", prEvent(5, "opened"));
  await run(
    w,
    "irreversible",
    "pull_request_target",
    prEvent(5, "synchronize"),
  );
  expect(w.statuses.map((s) => [s.sha, s.context, s.state])).toEqual([
    ["sha5", "autopilot/irreversible", "pending"],
    ["sha5", "autopilot/irreversible", "pending"],
  ]);
  expect(w.slack).toHaveLength(1);
  expect(commentsOf(w, 5)[0]?.body).toContain(
    "<!-- autopilot:notified:approval:sha5 -->",
  );
});

test("irreversible は承認されていれば success を付ける", async () => {
  const w = newWorld();
  w.pulls.push({
    number: 5,
    files: ["db/migrations/001.sql"],
    reviews: [
      {
        user: { login: "alice" },
        state: "APPROVED",
        commit_id: "sha5",
        submitted_at: "2026-11-12T01:00:00Z",
      },
    ],
  });
  w.issues.push({ number: 5 });
  await run(w, "irreversible", "pull_request_review", {
    action: "submitted",
    pull_request: { number: 5 },
  });
  expect(w.statuses[0]?.state).toBe("success");
  expect(w.slack).toHaveLength(0);
});

test("label は、ルーティンの持ち主と App 以外が書いた印を無視する", async () => {
  const w = newWorld();
  w.issues.push({ number: 3 });
  const comment = (login: string) => ({
    action: "created",
    issue: { number: 3 },
    comment: {
      body: "<!-- autopilot:needs-human -->\n困った",
      user: { login },
    },
  });
  await run(w, "label", "issue_comment", comment("mallory"));
  expect(w.issues[0]?.labels ?? []).toEqual([]);
  await run(w, "label", "issue_comment", comment("routine-user"));
  expect(w.issues[0]?.labels).toEqual(["needs-human"]);
  await run(w, "label", "issue_comment", comment("app[bot]"));
  expect(w.issues[0]?.labels).toEqual(["needs-human", "needs-human"]);
});

test("label は needs-human が付いたら Slack に印のあるコメントの 1 段落目を送る", async () => {
  const w = newWorld();
  w.issues.push({
    number: 3,
    comments: [
      {
        body: "<!-- autopilot:needs-human -->\n判断が必要です\n\n詳しくは…",
        login: "routine-user",
      },
      { body: "ただの雑談", login: "someone" },
    ],
  });
  await run(w, "label", "issues", {
    action: "labeled",
    label: { name: "needs-human" },
    issue: {
      number: 3,
      title: "T",
      html_url: "https://github.com/o/r/issues/3",
    },
  });
  expect(w.slack).toHaveLength(1);
  expect(w.slack[0]).toContain("判断が必要です");
  expect(w.slack[0]).not.toContain("雑談");
  expect(w.slack[0]).not.toContain("詳しくは");
});

test("fix-round は上限で needs-human を付け、run=false を書く", async () => {
  const w = newWorld();
  w.pulls.push({ number: 4 });
  const marker = {
    body: "<!-- autopilot:fix-round --> 対応",
    login: "app[bot]",
  };
  w.issues.push({ number: 4, comments: [marker, marker, marker] });
  const { output } = await run(w, "fix-round", "workflow_dispatch", {
    inputs: { pr: "4" },
  });
  expect(output).toContain("run=false");
  expect(output).toContain("pr=4");
  expect(w.issues[0]?.labels).toEqual(["needs-human"]);
});

test("fix-round は上限未満なら印をコメントして run=true を書く", async () => {
  const w = newWorld();
  w.pulls.push({ number: 4 });
  w.issues.push({
    number: 4,
    comments: [
      { body: "<!-- autopilot:fix-round --> 対応 1 回目", login: "app[bot]" },
    ],
  });
  const { output } = await run(w, "fix-round", "workflow_dispatch", {
    inputs: { pr: "4" },
  });
  expect(output).toContain("run=true");
  expect(commentsOf(w, 4).at(-1)?.body).toBe(
    "<!-- autopilot:fix-round --> 対応 2 回目",
  );
});

test("fix-round は App 以外の印を数えず、autopilot の PR でなければ run=false", async () => {
  const w = newWorld();
  w.pulls.push({ number: 4 }, { number: 6, ref: "feature/x" });
  const marker = { body: "<!-- autopilot:fix-round -->", login: "mallory" };
  w.issues.push({ number: 4, comments: [marker, marker, marker] });
  expect(
    (await run(w, "fix-round", "workflow_dispatch", { inputs: { pr: "4" } }))
      .output,
  ).toContain("run=true");
  expect(
    (await run(w, "fix-round", "workflow_dispatch", { inputs: { pr: "6" } }))
      .output,
  ).toContain("run=false");
});

test("ready は Draft のときだけ ready にする", async () => {
  const w = newWorld();
  w.pulls.push({ number: 2, draft: true }, { number: 3 });
  await run(w, "ready", "workflow_dispatch", { inputs: { pr: "3" } });
  expect(w.graphql).toHaveLength(0);
  await run(w, "ready", "workflow_dispatch", { inputs: { pr: "2" } });
  expect(w.graphql).toHaveLength(1);
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

test("deploy は autopilot 以外の PR では何もしない", async () => {
  const w = newWorld();
  w.pulls.push({ number: 1, ref: "feature/x", merged: true });
  const { code } = await run(w, "deploy", "pull_request_target", {
    action: "closed",
    pull_request: { number: 1 },
  });
  expect(code).toBe(0);
  expect(w.slack).toHaveLength(0);
  expect(w.createdIssues).toHaveLength(0);
});

test("deploy は deploy.mode が none でもマージしたら done を送る", async () => {
  const w = newWorld();
  w.pulls.push({ number: 1, merged: true });
  await run(w, "deploy", "pull_request_target", {
    action: "closed",
    pull_request: { number: 1 },
  });
  expect(w.slack).toHaveLength(1);
  expect(w.slack[0]).toContain("対応が終わりました");
});

test("エラーに秘密を出さない", async () => {
  const w = newWorld();
  const errors: string[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => errors.push(a.join(" "));
  try {
    const { code } = await run(
      w,
      "automerge",
      "pull_request_target",
      prEvent(77, "opened"),
    );
    expect(code).toBe(1);
  } finally {
    console.error = orig;
  }
  expect(errors.join("\n")).not.toContain("tok-secret");
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
