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
const RETRIES = 3;
const RETRY_MS = 2_000;
// 起動した実行は、時計のずれを見込んで、起動の少し前から探す
const FIND_MARGIN_MS = 2 * 60_000;

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

// 読み取りの一時的な失敗は、間を置いてやり直す
async function withRetry<T>(ctx: Ctx, fn: () => Promise<T>): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= RETRIES) throw e;
      await ctx.sleep(RETRY_MS * 2 ** (i - 1));
    }
  }
}

async function findRun(
  ctx: Ctx,
  target: DeployTarget,
  mergeSha: string,
  startedAt: number,
  deadline: number,
  used: Set<number>,
): Promise<WorkflowRun | undefined> {
  const since = startedAt - FIND_MARGIN_MS;
  const query: Record<string, string> =
    target.kind === "wait"
      ? { head_sha: mergeSha }
      : { event: "workflow_dispatch", created: `>=${isoSeconds(since)}` };
  for (;;) {
    const runs = (
      await withRetry(ctx, () =>
        ctx.gh.listWorkflowRuns(target.workflow, query),
      )
    )
      .filter(
        (r) =>
          !used.has(r.id) &&
          (target.kind === "wait"
            ? r.head_sha === mergeSha
            : Date.parse(r.created_at) >= Math.floor(since / 1000) * 1000),
      )
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    if (runs[0]) return runs[0];
    if (ctx.now().getTime() > deadline) return undefined;
    await ctx.sleep(FIND_MS);
  }
}

// cancelled の実行より新しい実行があれば、後のマージのデプロイに置き換わった
async function superseded(
  ctx: Ctx,
  target: DeployTarget,
  run: WorkflowRun,
): Promise<boolean> {
  const query: Record<string, string> =
    target.kind === "wait"
      ? { branch: ctx.defaultBranch }
      : { event: "workflow_dispatch" };
  const runs = await withRetry(ctx, () =>
    ctx.gh.listWorkflowRuns(target.workflow, query),
  );
  return runs.some((r) => r.id !== run.id && r.created_at > run.created_at);
}

async function pollRun(
  ctx: Ctx,
  target: DeployTarget,
  found: WorkflowRun,
  deadline: number,
): Promise<Step> {
  for (;;) {
    const run = await withRetry(ctx, () => ctx.gh.getWorkflowRun(found.id));
    if (run.status === "completed") {
      if (run.conclusion === "success") return { kind: "ok" };
      if (run.conclusion === "skipped")
        return {
          kind: "silent",
          reason: `${target.workflow} の実行が skipped になりました: ${run.html_url}`,
        };
      if (run.conclusion === "cancelled") {
        return (await superseded(ctx, target, found))
          ? {
              kind: "silent",
              reason: `${target.workflow} の実行は、新しい実行に置き換わりました: ${run.html_url}`,
            }
          : {
              kind: "unknown",
              what: `${target.workflow} の実行が cancelled になり、置き換える実行も見つかりません。デプロイの結果が分かりません`,
            };
      }
      return failed(
        `${target.workflow} の実行が ${run.conclusion} で終わりました`,
      );
    }
    if (ctx.now().getTime() > deadline) {
      return {
        kind: "unknown",
        what: `${target.workflow} が ${ctx.config.deploy.timeoutMinutes} 分たっても終わりません。デプロイの結果が分かりません`,
      };
    }
    await ctx.sleep(POLL_MS);
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
    const found = await findRun(
      ctx,
      target,
      mergeSha,
      startedAt,
      deadline,
      used,
    );
    if (!found)
      return {
        kind: "unknown",
        what: `${target.workflow} の実行が見つかりませんでした。デプロイの結果が分かりません`,
      };
    used.add(found.id);
    return await pollRun(ctx, target, found, deadline);
  } catch (e) {
    return {
      kind: "unknown",
      what: `${target.workflow} の確認中に GitHub の呼び出しに失敗しました。デプロイの結果が分かりません: ${messageOf(e)}`,
    };
  }
}

async function runAndVerify(
  ctx: Ctx,
  targets: DeployTarget[],
  mergeSha: string,
): Promise<Step> {
  const used = new Set<number>();
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

// ロールバックできたときだけ ok。理由は note に入れる
async function rollback(ctx: Ctx): Promise<{ ok: boolean; note: string }> {
  const command = ctx.config.deploy.rollback;
  if (!command) return { ok: false, note: "ロールバックの設定がありません。" };
  if (command.endsWith(".yml")) {
    await ctx.gh.dispatchWorkflow(command, ctx.defaultBranch, {});
    return {
      ok: true,
      note: `ロールバックのワークフロー ${command} を起動しました。`,
    };
  }
  const result = await ctx.runShell(command);
  return result.code === 0
    ? { ok: true, note: "ロールバックのコマンドを実行しました。" }
    : {
        ok: false,
        note: `ロールバックのコマンドが失敗しました (終了コード ${result.code})。`,
      };
}

async function sameCauseCount(ctx: Ctx, marker: string): Promise<number> {
  return (await ctx.gh.listOpenIssues()).filter((i) => i.body?.includes(marker))
    .length;
}

interface Irreversibility {
  irreversible: boolean;
  /** hold にしたときに添える理由 */
  why: string;
}

// デプロイの前に決める。調べられなければ、取り消せないものとして扱う
async function checkIrreversible(
  ctx: Ctx,
  pull: Pull,
): Promise<Irreversibility> {
  try {
    const found = await irreversibleReasons(ctx, pull);
    const why: string[] = [];
    if (found.reasons.some((r) => !found.waiting || r.startsWith("パス:")))
      why.push("取り消せない変更を含みます");
    if (found.waiting)
      why.push(
        "Terraform の plan が無いため、取り消せない変更かどうか決められません",
      );
    return { irreversible: why.length > 0, why: why.join("。") };
  } catch (e) {
    return {
      irreversible: true,
      why: `取り消せない変更かどうかを調べられませんでした: ${messageOf(e)}`,
    };
  }
}

// 出力の文字は印に残さず、指紋のハッシュだけを置く
const markerOf = (source: string) =>
  `${DEPLOY_FAILURE_MARKER}${new Bun.CryptoHasher("sha256")
    .update(failureFingerprint(source))
    .digest("hex")
    .slice(0, 16)} -->`;

interface Report {
  kind: "hold" | "rolled_back";
  label: string;
  /** Issue と Slack に書く、何があったかの行 */
  lines: string[];
  /** 指紋にする文 (ハッシュにして印に入れる) */
  fingerprintSource: string;
  errors: string[];
}

// Issue を作り、Slack に送る。Slack は最後に必ず試し、失敗があれば最後に落とす
async function report(ctx: Ctx, pull: Pull, r: Report): Promise<void> {
  const marker = markerOf(r.fingerprintSource);
  const errors = [...r.errors];
  try {
    await ctx.gh.createIssue({
      title: `デプロイ後の確認に失敗しました: ${pull.title} (#${pull.number})`,
      body: [
        `PR #${pull.number} のマージ後のデプロイが失敗しました。`,
        r.lines.join("\n"),
        `[実行のログ](${ctx.runUrl})`,
        marker,
      ].join("\n\n"),
      labels: [r.label],
    });
  } catch (e) {
    errors.push(`Issue の作成に失敗しました: ${messageOf(e)}`);
  }
  await ctx.notify({
    kind: r.kind === "hold" ? "deploy_hold" : "deploy_rolled_back",
    title: pull.title,
    url: pull.html_url,
    details: [...r.lines, ...errors],
    links: [{ label: "実行のログ", url: ctx.runUrl }],
  });
  if (errors.length > 0) throw new Error(errors.join("; "));
}

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
): Promise<void> {
  const errors: string[] = [];
  if (step.kind === "unknown") {
    return report(ctx, pull, {
      kind: "hold",
      label: LABELS.needsHuman,
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
    { ok: false, irreversible: irr.irreversible, sameCauseCount: count },
    ctx.config,
  );
  if (outcome.kind === "done") return;
  if (outcome.kind === "hold") {
    return report(ctx, pull, {
      kind: "hold",
      label: LABELS.needsHuman,
      lines: [...what, irr.why],
      fingerprintSource,
      errors,
    });
  }
  let result: { ok: boolean; note: string };
  try {
    result = await rollback(ctx);
  } catch (e) {
    result = {
      ok: false,
      note: `ロールバックに失敗しました: ${messageOf(e)}`,
    };
  }
  if (!result.ok) {
    return report(ctx, pull, {
      kind: "hold",
      label: LABELS.needsHuman,
      lines: [...what, `ロールバックに失敗しました。${result.note}`],
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
  const pull = await base.gh.getPull(base.event.pull_request.number);
  if (!pull.merged || !isAutopilotPull(pull, base.repo)) return;
  const mergeSha = pull.merge_commit_sha;
  if (!mergeSha) throw new Error("マージの commit が分かりません");

  let ctx: Ctx;
  try {
    ctx = await loadConfig(base, mergeSha);
  } catch (e) {
    const what = `デプロイを始められませんでした: ${messageOf(e)}`;
    await report(base, pull, {
      kind: "hold",
      label: LABELS.needsHuman,
      lines: [what],
      fingerprintSource: what,
      errors: [],
    });
    throw e;
  }

  const targets = planDeployTargets(ctx.config);
  const done = () =>
    ctx.notify({
      kind: "done",
      title: pull.title,
      url: pull.html_url,
      details: [],
      links: [{ label: "実行のログ", url: ctx.runUrl }],
    });
  if (targets.length === 0) return done();

  const irr = await checkIrreversible(ctx, pull);
  const step = await runAndVerify(ctx, targets, mergeSha);
  if (step.kind === "ok") return done();
  if (step.kind === "silent") {
    console.log(step.reason);
    return;
  }
  await handleFailure(ctx, pull, step, irr);
}
