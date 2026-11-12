import { parseConfig } from "../config";
import {
  type DeployTarget,
  decideAfterVerify,
  failureFingerprint,
  planDeployTargets,
} from "../deploy";
import type { Pull, WorkflowRun } from "../github";
import { LABELS } from "../types";
import { type Ctx, DEPLOY_FAILURE_MARKER, isAutopilotPull } from "./context";
import { irreversibleReasons } from "./irreversible";

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
  noRollback: "ロールバックの設定がありません",
  irreversible: "取り消せない変更を含みます",
  planMissing: "Terraform の plan がありません",
  planUnreadable: "Terraform の plan を読めません",
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

// 失敗したら、間を置いてやり直す
async function withRetry<T>(
  ctx: Ctx,
  fn: () => Promise<T>,
  tries = READ_TRIES,
): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= tries) throw e;
      await ctx.sleep(RETRY_MS * 2 ** (i - 1));
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
            : Date.parse(r.created_at) >= q.since),
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

// 失敗とみなすのは failure だけ。success・skipped・置き換わった cancelled のほかは、
// 結果が分からないとして、ロールバックしない (R23, R24)
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
    return {
      ok: false,
      reason: "rollbackFailed",
      note: `${name} を起動できませんでした: ${messageOf(e)}`,
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

// detectIrreversible が、plan を読めないときに出す理由
const PLAN_UNREADABLE = "Terraform: plan を読めませんでした";

// デプロイの前に決める。調べられなければ、取り消せないものとして扱う
async function checkIrreversible(
  ctx: Ctx,
  pull: Pull,
): Promise<Irreversibility> {
  try {
    const found = await irreversibleReasons(ctx, pull);
    const out: Irreversibility = { reasons: [], lines: [] };
    // plan が無いときの「読めない」は、plan が無いこととして扱う
    const changes = found.reasons.filter((r) => r !== PLAN_UNREADABLE);
    if (changes.length > 0) {
      out.reasons.push("irreversible");
      out.lines.push(`取り消せない変更: ${changes.join("、")}`);
    }
    if (found.waiting) {
      out.reasons.push("planMissing");
      out.lines.push(
        "Terraform の plan が無いため、取り消せない変更かどうか決められません",
      );
    } else if (found.reasons.includes(PLAN_UNREADABLE)) {
      out.reasons.push("planUnreadable");
      out.lines.push(
        "Terraform の plan を読めないため、取り消せない変更かどうか決められません",
      );
    }
    return out;
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

type Report = {
  /** Issue と Slack に書く、何があったかの行 */
  lines: string[];
  /** 指紋にする文 (ハッシュにして印に入れる) */
  fingerprintSource: string;
  errors: string[];
} & (
  | { kind: "hold"; reasons: HoldReason[] }
  | { kind: "rolled_back"; label: string }
);

// Issue を作り、Slack に送る。Slack は最後に必ず試し、失敗があれば最後に落とす
async function report(ctx: Ctx, subject: Subject, r: Report): Promise<void> {
  const marker = markerOf(r.fingerprintSource);
  const errors = [...r.errors];
  const pr = `${subject.title} (#${subject.number})`;
  const why =
    r.kind === "hold" ? r.reasons.map((x) => HOLD_REASONS[x]).join("、") : "";
  const issue =
    r.kind === "hold"
      ? {
          title: `デプロイの後の対応を止めました (${why}): ${pr}`,
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
    return report(ctx, pull, {
      kind: "hold",
      reasons: [result.reason],
      lines: [...what, result.note],
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

// マージされた PR が設定を書き換えていても効かないよう、マージの前の親から読む
async function loadConfig(base: Ctx, mergeSha: string): Promise<Ctx> {
  const parent = (await base.gh.getCommitParents(mergeSha))[0];
  if (!parent) throw new Error("マージの前の commit が分かりません");
  const config = parseConfig(
    await base.gh.getRepoFile(".github/autopilot.yml", parent),
  );
  return { ...base, config, notify: (n) => base.notify(n, config) };
}

export async function deploy(base: Ctx): Promise<void> {
  if (
    base.eventName !== "pull_request_target" ||
    base.event.action !== "closed"
  )
    return;
  const event = base.event.pull_request;
  const n: number = event.number;
  let pull: Pull;
  try {
    pull = await withRetry(base, () => base.gh.getPull(n));
  } catch (e) {
    await holdBefore(
      base,
      {
        number: n,
        title: event.title ?? `PR #${n}`,
        html_url: event.html_url ?? `${base.serverUrl}/${base.repo}/pull/${n}`,
      },
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
