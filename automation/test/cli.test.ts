import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../src/cli";
import { type Deps, defaultRunShell } from "../src/commands/context";

const realConsoleError = console.error;

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

interface RunData {
  id: number;
  head_sha?: string;
  created_at?: string;
  // getWorkflowRun が順に返す状態 (最後のものは繰り返す)
  states: { status: string; conclusion: string | null }[];
}

interface IssueData {
  number: number;
  body?: string;
  created_at?: string;
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
  configs: Record<string, string>;
  runs: RunData[];
  runQueries: string[];
  artifacts: {
    runId: number;
    headSha: string;
    expired?: boolean;
    plan?: unknown;
  }[];
  merged: { n: number; body: unknown }[];
  graphqlError?: string;
  events: string[];
  failCreateIssue?: boolean;
  throwOnPull?: string;
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
    configs: {},
    runs: [],
    runQueries: [],
    artifacts: [],
    merged: [],
    events: [],
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
    if (pullNo !== undefined && w.throwOnPull) throw new Error(w.throwOnPull);
    const issueNo = id(/^\/issues\/(\d+)/);

    if (url.host === "slack.test") {
      w.events.push("slack");
      w.slack.push(body.text);
      return new Response("ok");
    }
    if (url.pathname === "/graphql") {
      w.graphql.push(body.query);
      if (w.graphqlError)
        return Response.json({ errors: [{ message: w.graphqlError }] });
      return Response.json({ data: {} });
    }
    if (path === "")
      return Response.json({ default_branch: "main", full_name: "o/r" });
    if (path.startsWith("/contents/"))
      return new Response(
        w.configs[url.searchParams.get("ref") ?? ""] ??
          w.configs["*"] ??
          CONFIG,
      );
    if (path.startsWith("/commits/"))
      return Response.json({ parents: [{ sha: "base123" }] });
    if (path.startsWith("/actions/workflows/") && path.endsWith("/runs")) {
      w.runQueries.push(url.search);
      return Response.json({
        workflow_runs: w.runs.map((r) => ({
          id: r.id,
          status: "queued",
          conclusion: null,
          head_sha: r.head_sha ?? "",
          html_url: `https://github.com/o/r/actions/runs/${r.id}`,
          created_at: r.created_at ?? "2026-11-12T12:00:05Z",
        })),
      });
    }
    if (path === "/actions/artifacts")
      return Response.json({
        artifacts: w.artifacts.map((a) => ({
          expired: a.expired ?? false,
          workflow_run: { id: a.runId, head_sha: a.headSha },
        })),
      });
    const runNo = id(/^\/actions\/runs\/(\d+)$/);
    if (runNo !== undefined) {
      const r = w.runs.find((x) => x.id === runNo) as RunData;
      const state = r.states.length > 1 ? r.states.shift() : r.states[0];
      return Response.json({
        id: runNo,
        ...state,
        head_sha: r.head_sha ?? "",
        html_url: `https://github.com/o/r/actions/runs/${runNo}`,
        created_at: r.created_at ?? "",
      });
    }
    if (pullNo !== undefined && method === "PUT" && path.endsWith("/merge")) {
      w.merged.push({ n: pullNo, body });
      return Response.json({ merged: true });
    }
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
          .filter((i) => {
            const label = url.searchParams.get("labels");
            return label === null || i.labels?.includes(label);
          })
          .map((i) => ({
            number: i.number,
            title: `Issue ${i.number}`,
            body: i.body ?? null,
            created_at: i.created_at ?? "2026-11-01T00:00:00Z",
            html_url: `https://github.com/o/r/issues/${i.number}`,
            updated_at: i.updated_at ?? "2026-11-12T00:00:00Z",
            labels: (i.labels ?? []).map((name) => ({ name })),
          })),
      );
    if (path === "/issues") {
      if (w.failCreateIssue) return new Response("{}", { status: 500 });
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
        w.events.push("comment");
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
      AUTOPILOT_SLACK_WEBHOOK_URL: "https://slack.test/hook-secret",
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

// ---- 修正の周回 1 ----

const withIrr = (irr: string, extra = "") =>
  `${CONFIG.replace('irreversible: { paths: ["db/migrations/**"] }', irr)}${extra}`;
const ON_MERGE = `deploy: { mode: on_merge, workflow: deploy.yml, verify: "check.sh", rollback: "rollback.sh", timeout_minutes: 5 }\n`;
const done = (conclusion: string) => ({ status: "completed", conclusion });
const closed = { action: "closed", pull_request: { number: 1 } };

function deployWorld(config: string, files = ["app/main.ts"]) {
  const w = newWorld();
  w.configs["*"] = config;
  w.pulls.push({ number: 1, merged: true, files });
  w.runs.push({ id: 50, head_sha: "merge123", states: [done("success")] });
  return w;
}

function shell(results: { code: number; output?: string }[]) {
  const commands: string[] = [];
  const runShell: Deps["runShell"] = async (c) => {
    commands.push(c);
    const r = results.shift() ?? { code: 0 };
    return { code: r.code, output: r.output ?? "" };
  };
  return { commands, runShell };
}

const runDeploy = (w: World, deps: Partial<Deps>) =>
  run(w, "deploy", "pull_request_target", closed, {}, deps);

test("deploy は plan が無いときは取り消せない変更とみなし、ロールバックしない (C1)", async () => {
  const w = deployWorld(
    withIrr(
      'irreversible: { paths: ["db/migrations/**"], terraform_plan_artifact: plan }',
      ON_MERGE,
    ),
    ["db/migrations/1.sql"],
  );
  const sh = shell([{ code: 1, output: "boom" }]);
  await runDeploy(w, { runShell: sh.runShell });
  expect(sh.commands).toEqual(["check.sh"]);
  expect(w.createdIssues[0]?.labels).toEqual(["needs-human"]);
  expect(w.slack[0]).toContain("ロールバックしていません");
});

test("deploy は plan が無いだけでもロールバックしない (C1)", async () => {
  const w = deployWorld(
    withIrr(
      "irreversible: { paths: [], terraform_plan_artifact: plan }",
      ON_MERGE,
    ),
  );
  const sh = shell([{ code: 1, output: "boom" }]);
  await runDeploy(w, { runShell: sh.runShell });
  expect(sh.commands).toEqual(["check.sh"]);
  expect(w.slack[0]).toContain("ロールバックしていません");
});

test("deploy は設定を、マージの前の親 commit から読む (I6)", async () => {
  const w = deployWorld(withIrr("irreversible: { paths: [] }", ON_MERGE));
  await runDeploy(w, { runShell: shell([]).runShell });
  expect(w.urls).toContain(
    "GET /repos/o/r/contents/.github/autopilot.yml?ref=base123",
  );
});

test("deploy (on_merge) はマージの commit の実行を探し、成功まで待って verify する (I8)", async () => {
  const w = deployWorld(withIrr("irreversible: { paths: [] }", ON_MERGE));
  const first = w.runs[0] as RunData;
  first.states = [
    { status: "in_progress", conclusion: null },
    { status: "in_progress", conclusion: null },
    done("success"),
  ];
  const sh = shell([{ code: 0 }]);
  await runDeploy(w, { runShell: sh.runShell });
  expect(decodeURIComponent(w.runQueries[0] ?? "")).toContain(
    "head_sha=merge123",
  );
  expect(sh.commands).toEqual(["check.sh"]);
  expect(w.slack[0]).toContain("対応が終わりました");
  expect(w.createdIssues).toHaveLength(0);
});

test("deploy (dispatch) は環境ごとに起動し、created を秒まで、2 分前から探す (I1)", async () => {
  const w = deployWorld(
    withIrr(
      "irreversible: { paths: [] }",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: 設定ファイルの置き換え記号そのもの
      'deploy: { mode: dispatch, workflow: deploy.yml, environments: [stg, prod], inputs: { env: "${environment}" } }\n',
    ),
  );
  await runDeploy(w, { runShell: shell([]).runShell });
  expect(w.dispatches.map((d) => d.inputs)).toEqual([
    { env: "stg" },
    { env: "prod" },
  ]);
  const q = decodeURIComponent(w.runQueries[0] ?? "");
  expect(q).toContain("event=workflow_dispatch");
  expect(q).toContain("created=>=2026-11-12T11:58:00Z");
  expect(w.slack[0]).toContain("対応が終わりました");
});

test("deploy は timeoutMinutes を過ぎたら失敗とし、コマンドでロールバックする (I8)", async () => {
  const w = deployWorld(withIrr("irreversible: { paths: [] }", ON_MERGE));
  (w.runs[0] as RunData).states = [{ status: "in_progress", conclusion: null }];
  const sh = shell([{ code: 0 }]);
  await runDeploy(w, { runShell: sh.runShell });
  expect(sh.commands).toEqual(["rollback.sh"]);
  expect(w.createdIssues[0]?.labels).toEqual(["autopilot:ready"]);
  expect(w.slack[0]).toContain("ロールバックしました");
});

test("deploy は実行を探す時間を timeoutMinutes までにする (I1)", async () => {
  const w = deployWorld(withIrr("irreversible: { paths: [] }", ON_MERGE));
  w.runs.length = 0;
  let clock = Date.parse("2026-11-12T12:00:00Z");
  const sh = shell([{ code: 0 }]);
  await runDeploy(w, {
    runShell: sh.runShell,
    now: () => new Date(clock),
    sleep: async (ms) => {
      clock += ms;
    },
  });
  expect(w.runQueries.length).toBeGreaterThan(12);
  expect(clock - Date.parse("2026-11-12T12:00:00Z")).toBeGreaterThanOrEqual(
    5 * 60_000,
  );
  expect(sh.commands).toEqual(["rollback.sh"]);
});

test("deploy は実行が失敗なら、ワークフローでロールバックし、Issue に出力を含めない (I8, I9)", async () => {
  const w = deployWorld(
    withIrr(
      "irreversible: { paths: [] }",
      'deploy: { mode: on_merge, workflow: deploy.yml, verify: "check.sh", rollback: "rollback.yml" }\n',
    ),
  );
  (w.runs[0] as RunData).states = [done("failure")];
  await runDeploy(w, { runShell: shell([]).runShell });
  expect(w.dispatches.map((d) => d.workflow)).toEqual(["rollback.yml"]);
  const issue = w.createdIssues[0];
  expect(issue?.body.trim().split("\n").at(-1)).toMatch(
    /^<!-- autopilot:deploy-failure:.* -->$/,
  );
  expect(issue?.body).toContain("https://github.com/o/r/actions/runs/7");
});

test("Issue と Slack に、コマンドの出力を入れない (I9)", async () => {
  const w = deployWorld(withIrr("irreversible: { paths: [] }", ON_MERGE));
  const sh = shell([
    { code: 3, output: "boom 5\nTOKEN=SECRET-xyz" },
    { code: 0 },
  ]);
  await runDeploy(w, { runShell: sh.runShell });
  const issue = w.createdIssues[0];
  expect(issue?.body).not.toContain("SECRET-xyz");
  expect(issue?.body).toContain("終了コード: 3");
  expect(issue?.body).toContain("<!-- autopilot:deploy-failure:boom # -->");
  expect(w.slack.join("")).not.toContain("SECRET-xyz");
});

test("同じ印のある開いた Issue があれば needs-human にする。ラベルは問わない (I8, I9)", async () => {
  const w = deployWorld(withIrr("irreversible: { paths: [] }", ON_MERGE));
  w.issues.push({
    number: 30,
    labels: ["bug"],
    body: "古い\n\n<!-- autopilot:deploy-failure:boom # -->",
  });
  const sh = shell([{ code: 1, output: "boom 42" }, { code: 0 }]);
  await runDeploy(w, { runShell: sh.runShell });
  expect(w.createdIssues[0]?.labels).toEqual(["needs-human"]);
});

test("deploy は cancelled の実行を失敗とせず、何もしないで終わる (I1)", async () => {
  const w = deployWorld(withIrr("irreversible: { paths: [] }", ON_MERGE));
  (w.runs[0] as RunData).states = [done("cancelled")];
  const sh = shell([]);
  const { code } = await runDeploy(w, { runShell: sh.runShell });
  expect(code).toBe(0);
  expect(sh.commands).toEqual([]);
  expect(w.createdIssues).toHaveLength(0);
  expect(w.slack).toHaveLength(0);
});

test("Issue を作れなくても、エラーを添えて Slack に知らせる (I2)", async () => {
  const w = deployWorld(withIrr("irreversible: { paths: [] }", ON_MERGE));
  w.failCreateIssue = true;
  const { code } = await runDeploy(w, {
    runShell: shell([{ code: 1 }, { code: 0 }]).runShell,
  });
  expect(code).toBe(1);
  expect(w.slack).toHaveLength(1);
  expect(w.slack[0]).toContain("HTTP 500");
});

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

test("人の判断が必要な理由のコメントには、印を入れる (I4)", async () => {
  const w = newWorld();
  w.pulls.push({ number: 4 });
  const marker = {
    body: "<!-- autopilot:fix-round --> 対応",
    login: "app[bot]",
  };
  w.issues.push({ number: 4, comments: [marker, marker, marker] });
  await run(w, "fix-round", "workflow_dispatch", { inputs: { pr: "4" } });
  expect(commentsOf(w, 4).at(-1)?.body).toContain(
    "<!-- autopilot:needs-human -->",
  );
});

test("automerge は Draft の PR を飛ばす (I5)", async () => {
  const w = newWorld();
  w.pulls.push({ number: 1, draft: true });
  await run(w, "automerge", "pull_request_target", prEvent(1, "opened"));
  expect(w.graphql).toHaveLength(0);
});

test("automerge は clean status で断られたら、直接 squash でマージする (I5)", async () => {
  const w = newWorld();
  w.pulls.push({ number: 1 });
  w.graphqlError = "Pull request is in clean status";
  const { code } = await run(
    w,
    "automerge",
    "pull_request_target",
    prEvent(1, "opened"),
  );
  expect(code).toBe(0);
  expect(w.merged).toEqual([
    { n: 1, body: { merge_method: "squash", sha: "sha1" } },
  ]);
});

test("automerge はそのほかの GraphQL の失敗では直接マージしない (I5)", async () => {
  const w = newWorld();
  w.pulls.push({ number: 1 });
  w.graphqlError = "Something else";
  expect(
    (await run(w, "automerge", "pull_request_target", prEvent(1, "opened")))
      .code,
  ).toBe(1);
  expect(w.merged).toEqual([]);
});

test("守りのファイルを変える PR は、設定に無くても取り消せない変更として扱う (I6)", async () => {
  const w = newWorld();
  w.pulls.push({ number: 5, files: [".github/workflows/ci.yml"] });
  w.issues.push({ number: 5 });
  await run(w, "irreversible", "pull_request_target", prEvent(5, "opened"));
  expect(w.statuses[0]?.state).toBe("pending");
  expect(w.statuses[0]?.description).toContain(".github/workflows/ci.yml");
});

test("sweep は readyLabeledAt より前の開始の印を数えない (I7)", async () => {
  const w = newWorld();
  const ev = (t: string) => ({
    event: "labeled",
    created_at: t,
    label: { name: "autopilot:ready" },
  });
  w.issues.push({
    number: 12,
    labels: ["autopilot:ready"],
    events: [ev("2026-11-12T07:00:00Z"), ev("2026-11-12T09:00:00Z")],
    comments: [
      {
        body: "<!-- autopilot:started -->",
        login: "routine-user",
        created_at: "2026-11-12T07:30:00Z",
      },
    ],
  });
  await run(w, "sweep", "schedule", {});
  // 開始の印が無いものとして扱い、2 回付いているので needs-human
  expect(w.issues[0]?.labels).toContain("needs-human");
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

test("fix-round と ready は、PR ではない Issue のコメントでは何もしない (M1)", async () => {
  const w = newWorld();
  const issueComment = { action: "created", issue: { number: 4 } };
  const a = await run(w, "fix-round", "issue_comment", issueComment);
  expect(a.output).toContain("run=false");
  expect(
    await run(w, "ready", "issue_comment", issueComment).then((r) => r.code),
  ).toBe(0);
  expect(w.graphql).toHaveLength(0);
});

test("irreversible は、理由が無ければレビューもチームも読まない (M2)", async () => {
  const w = newWorld();
  w.pulls.push({ number: 5, files: ["README.md"] });
  await run(w, "irreversible", "pull_request_target", prEvent(5, "opened"));
  expect(
    w.urls.some((u) => u.includes("/reviews") || u.includes("/orgs/")),
  ).toBe(false);
  expect(w.statuses[0]?.state).toBe("success");
});

test("エラーに秘密を出さない。メッセージにトークンが入っていても伏せる (M5)", async () => {
  const w = newWorld();
  w.pulls.push({ number: 1 });
  w.throwOnPull = "connect failed tok-secret";
  const errors: string[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => errors.push(a.join(" "));
  try {
    const { code } = await run(
      w,
      "automerge",
      "pull_request_target",
      prEvent(1, "opened"),
    );
    expect(code).toBe(1);
  } finally {
    console.error = orig;
  }
  expect(errors.join("\n")).toContain("connect failed");
  expect(errors.join("\n")).not.toContain("tok-secret");
});

test("Slack を送ってから、印のコメントを書く (M6)", async () => {
  const w = newWorld();
  w.pulls.push({ number: 5, files: ["db/migrations/001.sql"] });
  w.issues.push({ number: 5 });
  await run(w, "irreversible", "pull_request_target", prEvent(5, "opened"));
  expect(w.events).toEqual(["slack", "comment"]);
});

test("デプロイの失敗の Issue では、label は Slack を送らない (M8)", async () => {
  const w = newWorld();
  w.issues.push({ number: 3, comments: [{ body: "x", login: "app[bot]" }] });
  await run(w, "label", "issues", {
    action: "labeled",
    label: { name: "needs-human" },
    issue: {
      number: 3,
      title: "T",
      html_url: "u",
      body: "失敗\n\n<!-- autopilot:deploy-failure:boom -->",
    },
  });
  expect(w.slack).toHaveLength(0);
});

test("verify のコマンドの環境から、秘密と同じ値の変数を外し、時間切れを失敗にする (M3, M4)", async () => {
  const out = await defaultRunShell('echo "[$LEAK][$KEEP]"', {
    env: {
      PATH: process.env.PATH ?? "",
      LEAK: "tok-secret",
      KEEP: "ok",
      GITHUB_TOKEN: "tok-secret",
    },
    secrets: ["tok-secret", "hook"],
    timeoutMs: 5000,
  });
  expect(out.output.trim()).toBe("[][ok]");
  const slow = await defaultRunShell("sleep 5", {
    env: { PATH: process.env.PATH ?? "" },
    secrets: [],
    timeoutMs: 100,
  });
  expect(slow.code).not.toBe(0);
});
