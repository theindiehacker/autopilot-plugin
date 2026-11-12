import { parseConfig } from "../config";
import {
  type DeployTarget,
  decideAfterVerify,
  failureFingerprint,
  findIrreversiblePaths,
  planDeployTargets,
} from "../deploy";
import type { GitHubClient, Pull, WorkflowRun } from "../github";
import { type AutopilotConfig, LABELS } from "../types";
import {
  buildCtx,
  CONFIG_PATH,
  type Ctx,
  DEPLOY_FAILURE_MARKER,
  type Deps,
  type EventPayload,
  isAutopilotPull,
  readEvent,
  runUrlOf,
  sameLogin,
  slackSender,
  sleepOf,
} from "./context";

const POLL_MS = 30_000;
const FIND_MS = 5_000;
const RETRY_MS = 2_000;
// GitHub の読み取りは、3 回まで試す
const READ_TRIES = 3;
// Slack は、最初の 1 回のあとに 3 回までやり直す
const SLACK_TRIES = 4;
// 起動した実行は、起動の 10 秒前より後に作られたものだけを選ぶ (R24)
const DISPATCH_MARGIN_MS = 10_000;

// 止めた理由。Issue の題と、Issue と Slack の「止めた理由」に書く
const HOLD_REASONS = {
  unknown: "デプロイの結果が分かりません",
  rollbackFailed: "ロールバックに失敗しました",
  rollbackUnknown: "ロールバックの結果が分かりません",
  rollbackDispatchUnknown: "ロールバックを起動できたか分かりません",
  noRollback: "ロールバックの設定がありません",
  irreversible: "取り消せない変更を含みます",
  checkFailed: "取り消せない変更かどうかを調べられません",
  config: "設定を読めません",
  pull: "PR を読めません",
} as const;
type HoldReason = keyof typeof HOLD_REASONS;

type Step =
  | { kind: "ok" }
  // 後のマージのデプロイが本番を持つ、または実行されなかった。何もしない
  | { kind: "silent"; reason: string }
  // デプロイの結果が分からない。ロールバックせず、人に知らせる (R23)
  | { kind: "unknown"; what: string }
  // 失敗が確かめられた
  | { kind: "failed"; what: string; exitCode?: number; output: string };

const failed = (what: string, exitCode?: number, output = what): Step => ({
  kind: "failed",
  what,
  ...(exitCode === undefined ? {} : { exitCode }),
  output,
});

// created の検索は、秒までの形にする
const isoSeconds = (ms: number) =>
  `${new Date(ms).toISOString().slice(0, 19)}Z`;

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

interface Sleeper {
  sleep(ms: number): Promise<void>;
}

// 失敗したら、間を置いてやり直す
async function withRetry<T>(
  s: Sleeper,
  fn: () => Promise<T>,
  tries = READ_TRIES,
): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= tries) throw e;
      await s.sleep(RETRY_MS * 2 ** (i - 1));
    }
  }
}

/** 実行の探し方: マージの commit の実行か、起動した後の workflow_dispatch の実行か */
type RunQuery =
  | { kind: "commit"; sha: string }
  | { kind: "dispatched"; since: number };

// 起動の 10 秒前を秒に切り上げ、それより前に作られた実行は選ばない
const dispatchedSince = (dispatchedAt: number): RunQuery => ({
  kind: "dispatched",
  since: Math.ceil((dispatchedAt - DISPATCH_MARGIN_MS) / 1000) * 1000,
});

// 自分が起動した実行: デフォルトブランチで、App が起こしたもの
const dispatchedByUs = (ctx: Ctx, r: WorkflowRun) =>
  r.head_branch === ctx.defaultBranch &&
  sameLogin(r.triggering_actor?.login ?? "", ctx.botLogin);

// 合う実行のうち、まだ使っていない一番古いものを選び、使ったことにする
async function findRun(
  ctx: Ctx,
  workflow: string,
  q: RunQuery,
  deadline: number,
  used: Set<number>,
): Promise<WorkflowRun | undefined> {
  const query: Record<string, string> =
    q.kind === "commit"
      ? { head_sha: q.sha }
      : { event: "workflow_dispatch", created: `>=${isoSeconds(q.since)}` };
  for (;;) {
    const run = (
      await withRetry(ctx, () => ctx.gh.listWorkflowRuns(workflow, query))
    )
      .filter(
        (r) =>
          !used.has(r.id) &&
          (q.kind === "commit"
            ? r.head_sha === q.sha
            : Date.parse(r.created_at) >= q.since && dispatchedByUs(ctx, r)),
      )
      .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))[0];
    if (run) {
      used.add(run.id);
      return run;
    }
    if (ctx.now().getTime() > deadline) return undefined;
    await ctx.sleep(FIND_MS);
  }
}

type Watched =
  | { kind: "completed"; run: WorkflowRun }
  | { kind: "unknown"; what: string };

// 実行を探し、終わるまで待つ。API の失敗が続いたら投げる
async function watchRun(
  ctx: Ctx,
  workflow: string,
  q: RunQuery,
  deadline: number,
  used: Set<number>,
): Promise<Watched> {
  const found = await findRun(ctx, workflow, q, deadline, used);
  if (!found)
    return {
      kind: "unknown",
      what: `${workflow} の実行が見つかりませんでした`,
    };
  for (;;) {
    const run = await withRetry(ctx, () => ctx.gh.getWorkflowRun(found.id));
    if (run.status === "completed") return { kind: "completed", run };
    if (ctx.now().getTime() > deadline)
      return {
        kind: "unknown",
        what: `${workflow} が ${ctx.config.deploy.timeoutMinutes} 分たっても終わりません`,
      };
    await ctx.sleep(POLL_MS);
  }
}

// on_merge で cancelled になった実行が、デフォルトブランチの新しい commit の実行に置き換わったか
async function superseded(
  ctx: Ctx,
  workflow: string,
  run: WorkflowRun,
  mergeSha: string,
): Promise<boolean> {
  const runs = await withRetry(ctx, () =>
    ctx.gh.listWorkflowRuns(workflow, { branch: ctx.defaultBranch }),
  );
  return runs.some(
    (r) =>
      r.id !== run.id &&
      r.head_sha !== mergeSha &&
      Date.parse(r.created_at) > Date.parse(run.created_at),
  );
}

// 失敗とみなすのは failure だけ。success・on_merge の skipped・置き換わった cancelled のほかは、
// 結果が分からないとして、ロールバックしない (R23, R24, R25)
async function judgeRun(
  ctx: Ctx,
  target: DeployTarget,
  run: WorkflowRun,
  mergeSha: string,
): Promise<Step> {
  const ended = `${target.workflow} の実行が ${run.conclusion} で終わりました`;
  switch (run.conclusion) {
    case "success":
      return { kind: "ok" };
    case "failure":
      return failed(ended);
    case "skipped":
      // dispatch で skipped なら、何もデプロイされていない
      if (target.kind === "dispatch") return { kind: "unknown", what: ended };
      return { kind: "silent", reason: `${ended}: ${run.html_url}` };
    case "cancelled":
      // dispatch の実行は、置き換わったとはみなさない
      if (target.kind === "dispatch") return { kind: "unknown", what: ended };
      return (await superseded(ctx, target.workflow, run, mergeSha))
        ? {
            kind: "silent",
            reason: `${target.workflow} の実行は、新しい commit の実行に置き換わりました: ${run.html_url}`,
          }
        : {
            kind: "unknown",
            what: `${ended}。新しい commit の実行もありません`,
          };
    default:
      return { kind: "unknown", what: ended };
  }
}

async function runTarget(
  ctx: Ctx,
  target: DeployTarget,
  mergeSha: string,
  used: Set<number>,
): Promise<Step> {
  const startedAt = ctx.now().getTime();
  const deadline = startedAt + ctx.config.deploy.timeoutMinutes * 60_000;
  try {
    // 起動は、やり直すと二重に起動するので、やり直さない
    if (target.kind === "dispatch") {
      await ctx.gh.dispatchWorkflow(
        target.workflow,
        ctx.defaultBranch,
        target.inputs,
      );
    }
    const watched = await watchRun(
      ctx,
      target.workflow,
      target.kind === "wait"
        ? { kind: "commit", sha: mergeSha }
        : dispatchedSince(startedAt),
      deadline,
      used,
    );
    if (watched.kind === "unknown") return watched;
    return await judgeRun(ctx, target, watched.run, mergeSha);
  } catch (e) {
    return {
      kind: "unknown",
      what: `${target.workflow} の確認中に GitHub の呼び出しに失敗しました: ${messageOf(e)}`,
    };
  }
}

async function runAndVerify(
  ctx: Ctx,
  targets: DeployTarget[],
  mergeSha: string,
  used: Set<number>,
): Promise<Step> {
  for (const target of targets) {
    const step = await runTarget(ctx, target, mergeSha, used);
    if (step.kind !== "ok") return step;
  }
  const { verify } = ctx.config.deploy;
  if (!verify) return { kind: "ok" };
  const result = await ctx.runShell(verify);
  return result.code === 0
    ? { kind: "ok" }
    : failed("deploy.verify が失敗しました", result.code, result.output);
}

type RollbackResult =
  | { ok: true; note: string }
  | { ok: false; reason: HoldReason; note: string };

// ロールバックのワークフローも、デプロイと同じ決まりで実行を探して待つ。success のときだけ ok
async function rollbackByWorkflow(
  ctx: Ctx,
  workflow: string,
  used: Set<number>,
): Promise<RollbackResult> {
  const name = `ロールバックのワークフロー ${workflow}`;
  const startedAt = ctx.now().getTime();
  const deadline = startedAt + ctx.config.deploy.timeoutMinutes * 60_000;
  try {
    await ctx.gh.dispatchWorkflow(workflow, ctx.defaultBranch, {});
  } catch (e) {
    // 起動の呼び出しが失敗しても、起動したかもしれない
    return {
      ok: false,
      reason: "rollbackDispatchUnknown",
      note: `${name} の起動で GitHub の呼び出しに失敗しました: ${messageOf(e)}`,
    };
  }
  try {
    const watched = await watchRun(
      ctx,
      workflow,
      dispatchedSince(startedAt),
      deadline,
      used,
    );
    if (watched.kind === "unknown")
      return {
        ok: false,
        reason: "rollbackUnknown",
        note: `ロールバック: ${watched.what}。`,
      };
    return watched.run.conclusion === "success"
      ? { ok: true, note: `${name} が成功しました。` }
      : {
          ok: false,
          reason: "rollbackFailed",
          note: `${name} の実行が ${watched.run.conclusion} で終わりました。`,
        };
  } catch (e) {
    return {
      ok: false,
      reason: "rollbackUnknown",
      note: `${name} の確認中に GitHub の呼び出しに失敗しました: ${messageOf(e)}`,
    };
  }
}

async function rollback(ctx: Ctx, used: Set<number>): Promise<RollbackResult> {
  const command = ctx.config.deploy.rollback;
  if (!command)
    return {
      ok: false,
      reason: "noRollback",
      note: "ロールバックの設定が無いため、ロールバックしていません。",
    };
  if (command.endsWith(".yml")) return rollbackByWorkflow(ctx, command, used);
  const result = await ctx.runShell(command);
  return result.code === 0
    ? { ok: true, note: "ロールバックのコマンドを実行しました。" }
    : {
        ok: false,
        reason: "rollbackFailed",
        note: `ロールバックのコマンドが失敗しました (終了コード ${result.code})。`,
      };
}

async function sameCauseCount(ctx: Ctx, marker: string): Promise<number> {
  return (await ctx.gh.listOpenIssues()).filter((i) => i.body?.includes(marker))
    .length;
}

interface Irreversibility {
  /** 空なら、取り消せる変更 */
  reasons: HoldReason[];
  /** hold にしたときに添える文 */
  lines: string[];
}

// デプロイの前に決める。PR が deploy.irreversible_paths に合うファイルを変えていれば、取り消せない変更。
// 調べられなければ、取り消せないものとして扱う
async function checkIrreversible(
  ctx: Ctx,
  pull: Pull,
): Promise<Irreversibility> {
  const patterns = ctx.config.deploy.irreversiblePaths;
  // パスが無ければ、どのファイルも合わないので、変更したファイルを読まない
  if (patterns.length === 0) return { reasons: [], lines: [] };
  try {
    const found = findIrreversiblePaths(
      await ctx.gh.listPullFiles(pull.number),
      patterns,
    );
    if (found.length === 0) return { reasons: [], lines: [] };
    return {
      reasons: ["irreversible"],
      lines: [`取り消せない変更: ${found.join("、")}`],
    };
  } catch (e) {
    return {
      reasons: ["checkFailed"],
      lines: [
        `取り消せない変更かどうかを調べられませんでした: ${messageOf(e)}`,
      ],
    };
  }
}

// 出力の文字は印に残さず、指紋のハッシュだけを置く
const markerOf = (source: string) =>
  `${DEPLOY_FAILURE_MARKER}${new Bun.CryptoHasher("sha256")
    .update(failureFingerprint(source))
    .digest("hex")
    .slice(0, 16)} -->`;

/** Issue と Slack で名前を出す PR */
type Subject = Pick<Pull, "number" | "title" | "html_url">;

/** PR を読めないときは、event の中身で名前を出す */
function subjectOf(
  event: EventPayload,
  serverUrl: string,
  repo: string,
): Subject {
  const p = event.pull_request ?? {};
  return {
    number: p.number,
    title: p.title ?? `PR #${p.number}`,
    html_url: p.html_url ?? `${serverUrl}/${repo}/pull/${p.number}`,
  };
}

/** 知らせるのに要るもの (設定が読めないときは、Ctx が無い) */
type Reporter = Pick<Ctx, "gh" | "runUrl" | "notify" | "sleep">;

type Report = {
  /** Issue と Slack に書く、何があったかの行 */
  lines: string[];
  /** 指紋にする文 (ハッシュにして印に入れる) */
  fingerprintSource: string;
  errors: string[];
} & (
  | { kind: "hold"; reasons: HoldReason[]; title?: string }
  | { kind: "rolled_back"; label: string }
);

// Issue を作り、Slack に送る。Slack は最後に必ず試し、失敗があれば最後に落とす
async function report(
  ctx: Reporter,
  subject: Subject,
  r: Report,
): Promise<void> {
  const marker = markerOf(r.fingerprintSource);
  const errors = [...r.errors];
  const pr = `${subject.title} (#${subject.number})`;
  const why =
    r.kind === "hold" ? r.reasons.map((x) => HOLD_REASONS[x]).join("、") : "";
  const issue =
    r.kind === "hold"
      ? {
          title: r.title ?? `デプロイの後の対応を止めました (${why}): ${pr}`,
          lead: [
            `PR #${subject.number} のマージの後のデプロイで、自動の対応を止めました。`,
            `止めた理由: ${why}`,
          ],
          label: LABELS.needsHuman,
        }
      : {
          title: `デプロイ後の確認に失敗したため、ロールバックしました: ${pr}`,
          lead: [
            `PR #${subject.number} のマージの後のデプロイが失敗したため、ロールバックしました。`,
          ],
          label: r.label,
        };
  try {
    await ctx.gh.createIssue({
      title: issue.title,
      body: [
        ...issue.lead,
        r.lines.join("\n"),
        `[実行のログ](${ctx.runUrl})`,
        marker,
      ].join("\n\n"),
      labels: [issue.label],
    });
  } catch (e) {
    errors.push(`Issue の作成に失敗しました: ${messageOf(e)}`);
  }
  try {
    await withRetry(
      ctx,
      () =>
        ctx.notify({
          kind: r.kind === "hold" ? "deploy_hold" : "deploy_rolled_back",
          title: subject.title,
          url: subject.html_url,
          details: [
            ...(r.kind === "hold" ? [`止めた理由: ${why}`] : []),
            ...r.lines,
            ...errors,
          ],
          links: [{ label: "実行のログ", url: ctx.runUrl }],
        }),
      SLACK_TRIES,
    );
  } catch (e) {
    errors.push(messageOf(e));
  }
  if (errors.length > 0) throw new Error(errors.join("; "));
}

// デプロイを始める前に止める
const holdBefore = (
  ctx: Ctx,
  subject: Subject,
  reason: HoldReason,
  what: string,
) =>
  report(ctx, subject, {
    kind: "hold",
    reasons: [reason],
    lines: [what],
    fingerprintSource: what,
    errors: [],
  });

async function sameCause(
  ctx: Ctx,
  marker: string,
  errors: string[],
): Promise<number> {
  try {
    return await sameCauseCount(ctx, marker);
  } catch (e) {
    errors.push(`同じ原因の Issue の確認に失敗しました: ${messageOf(e)}`);
    return 1; // 分からなければ、同じ原因が続いているものとして、人に回す
  }
}

async function handleFailure(
  ctx: Ctx,
  pull: Pull,
  step: Exclude<Step, { kind: "ok" | "silent" }>,
  irr: Irreversibility,
  used: Set<number>,
): Promise<void> {
  const errors: string[] = [];
  if (step.kind === "unknown") {
    return report(ctx, pull, {
      kind: "hold",
      reasons: ["unknown"],
      lines: [step.what],
      fingerprintSource: step.what,
      errors,
    });
  }
  const what = [
    `失敗したこと: ${step.what}`,
    ...(step.exitCode === undefined ? [] : [`終了コード: ${step.exitCode}`]),
  ];
  const fingerprintSource = step.output;
  const count = await sameCause(ctx, markerOf(fingerprintSource), errors);
  const outcome = decideAfterVerify(
    {
      ok: false,
      irreversible: irr.reasons.length > 0,
      sameCauseCount: count,
    },
    ctx.config,
  );
  if (outcome.kind === "done") return;
  if (outcome.kind === "hold") {
    return report(ctx, pull, {
      kind: "hold",
      reasons: irr.reasons,
      lines: [...what, ...irr.lines],
      fingerprintSource,
      errors,
    });
  }
  let result: RollbackResult;
  try {
    result = await rollback(ctx, used);
  } catch (e) {
    result = {
      ok: false,
      reason: "rollbackFailed",
      note: `ロールバックに失敗しました: ${messageOf(e)}`,
    };
  }
  if (!result.ok) {
    // rollbackAfterIrreversible で戻そうとしたときは、取り消せない理由も残す
    return report(ctx, pull, {
      kind: "hold",
      reasons: [result.reason],
      lines: [...what, ...irr.lines, result.note],
      fingerprintSource,
      errors,
    });
  }
  return report(ctx, pull, {
    kind: "rolled_back",
    label: outcome.issueLabel,
    lines: [...what, result.note],
    fingerprintSource,
    errors,
  });
}

// マージの前の親 commit の設定を読む
async function readParentConfig(
  gh: GitHubClient,
  s: Sleeper,
  mergeSha: string,
): Promise<AutopilotConfig> {
  const parent = (await withRetry(s, () => gh.getCommitParents(mergeSha)))[0];
  if (!parent) throw new Error("マージの前の commit が分かりません");
  return parseConfig(
    await withRetry(s, () => gh.getRepoFile(CONFIG_PATH, parent)),
  );
}

// マージされた PR が設定を書き換えていても効かないよう、マージの前の親から読む
async function loadConfig(base: Ctx, mergeSha: string): Promise<Ctx> {
  const config = await readParentConfig(base.gh, base, mergeSha);
  return { ...base, config };
}

// deploy の Ctx を作る。デフォルトブランチの設定を読めなければ、マージの前の設定で続ける。
// どちらも読めなければ、人に知らせてから失敗する (R25)
export async function createDeployCtx(
  gh: GitHubClient,
  env: Record<string, string | undefined>,
  deps: Deps,
): Promise<Ctx> {
  const event = await readEvent(env);
  const s: Sleeper = { sleep: sleepOf(deps) };
  const problems: string[] = [];
  let defaultBranch: string | undefined;
  try {
    defaultBranch = (await withRetry(s, () => gh.getRepo())).default_branch;
  } catch (e) {
    problems.push(`リポジトリの情報を読めません: ${messageOf(e)}`);
  }
  if (defaultBranch !== undefined) {
    const branch = defaultBranch;
    try {
      const config = parseConfig(
        await withRetry(s, () => gh.getRepoFile(CONFIG_PATH, branch)),
      );
      return buildCtx(gh, env, deps, { event, defaultBranch: branch, config });
    } catch (e) {
      problems.push(`デフォルトブランチの設定を読めません: ${messageOf(e)}`);
    }
  }
  const fail = () => new Error(problems.join("; "));
  // デプロイしない event や PR では、知らせずに失敗する
  if (
    env.GITHUB_EVENT_NAME !== "pull_request_target" ||
    event.action !== "closed"
  )
    throw fail();
  const repo = env.GITHUB_REPOSITORY ?? "";
  let pull: Pull | undefined;
  try {
    pull = await withRetry(s, () => gh.getPull(event.pull_request?.number));
  } catch (e) {
    problems.push(`PR を読めません: ${messageOf(e)}`);
  }
  if (pull && (!pull.merged || !isAutopilotPull(pull, repo))) throw fail();
  if (pull && defaultBranch !== undefined) {
    try {
      if (!pull.merge_commit_sha)
        throw new Error("マージの commit が分かりません");
      const config = await readParentConfig(gh, s, pull.merge_commit_sha);
      console.error(problems.join("; "));
      return buildCtx(gh, env, deps, { event, defaultBranch, config });
    } catch (e) {
      problems.push(`マージの前の設定も読めません: ${messageOf(e)}`);
    }
  }
  await report(
    {
      gh,
      runUrl: runUrlOf(env),
      sleep: s.sleep,
      notify: slackSender(env, deps),
    },
    pull ??
      subjectOf(event, env.GITHUB_SERVER_URL ?? "https://github.com", repo),
    {
      kind: "hold",
      reasons: ["config"],
      title: `デプロイの後の対応を止めました: ${HOLD_REASONS.config}`,
      lines: problems,
      fingerprintSource: problems.join("\n"),
      errors: [],
    },
  );
  throw fail();
}

export async function deploy(base: Ctx): Promise<void> {
  if (
    base.eventName !== "pull_request_target" ||
    base.event.action !== "closed"
  )
    return;
  const n: number = base.event.pull_request.number;
  let pull: Pull;
  try {
    pull = await withRetry(base, () => base.gh.getPull(n));
  } catch (e) {
    await holdBefore(
      base,
      subjectOf(base.event, base.serverUrl, base.repo),
      "pull",
      `PR を読めないため、デプロイを始められませんでした: ${messageOf(e)}`,
    );
    throw e;
  }
  if (!pull.merged || !isAutopilotPull(pull, base.repo)) return;
  const mergeSha = pull.merge_commit_sha;
  if (!mergeSha) throw new Error("マージの commit が分かりません");

  let ctx: Ctx;
  try {
    ctx = await loadConfig(base, mergeSha);
  } catch (e) {
    await holdBefore(
      base,
      pull,
      "config",
      `設定を読めないため、デプロイを始められませんでした: ${messageOf(e)}`,
    );
    throw e;
  }

  const targets = planDeployTargets(ctx.config);
  const done = () =>
    withRetry(
      ctx,
      () =>
        ctx.notify({
          kind: "done",
          title: pull.title,
          url: pull.html_url,
          details: [],
          links: [{ label: "実行のログ", url: ctx.runUrl }],
        }),
      SLACK_TRIES,
    );
  if (targets.length === 0) return done();

  const irr = await checkIrreversible(ctx, pull);
  // 使った実行は、ほかの環境やロールバックで選ばない
  const used = new Set<number>();
  const step = await runAndVerify(ctx, targets, mergeSha, used);
  if (step.kind === "ok") return done();
  if (step.kind === "silent") {
    console.log(step.reason);
    return;
  }
  await handleFailure(ctx, pull, step, irr, used);
}
