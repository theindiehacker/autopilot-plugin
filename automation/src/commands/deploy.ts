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
// 起動した実行は、時計のずれを見込んで、起動の少し前から探す
const FIND_MARGIN_MS = 2 * 60_000;

type Step =
  | { kind: "ok" }
  // 新しいマージのデプロイが本番を持つ。何もしない
  | { kind: "skipped"; reason: string }
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

async function findRun(
  ctx: Ctx,
  target: DeployTarget,
  mergeSha: string,
  startedAt: number,
  deadline: number,
): Promise<WorkflowRun | undefined> {
  const since = startedAt - FIND_MARGIN_MS;
  const query: Record<string, string> =
    target.kind === "wait"
      ? { head_sha: mergeSha }
      : { event: "workflow_dispatch", created: `>=${isoSeconds(since)}` };
  for (;;) {
    const runs = (await ctx.gh.listWorkflowRuns(target.workflow, query))
      .filter((r) =>
        target.kind === "wait"
          ? r.head_sha === mergeSha
          : Date.parse(r.created_at) >= Math.floor(since / 1000) * 1000,
      )
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    if (runs[0]) return runs[0];
    if (ctx.now().getTime() > deadline) return undefined;
    await ctx.sleep(FIND_MS);
  }
}

async function runTarget(
  ctx: Ctx,
  target: DeployTarget,
  mergeSha: string,
): Promise<Step> {
  const startedAt = ctx.now().getTime();
  const deadline = startedAt + ctx.config.deploy.timeoutMinutes * 60_000;
  if (target.kind === "dispatch") {
    await ctx.gh.dispatchWorkflow(
      target.workflow,
      ctx.defaultBranch,
      target.inputs,
    );
  }
  const found = await findRun(ctx, target, mergeSha, startedAt, deadline);
  if (!found) return failed(`${target.workflow} の実行が見つかりませんでした`);
  for (;;) {
    const run = await ctx.gh.getWorkflowRun(found.id);
    if (run.status === "completed") {
      if (run.conclusion === "success") return { kind: "ok" };
      if (run.conclusion === "cancelled" || run.conclusion === "skipped")
        return {
          kind: "skipped",
          reason: `${target.workflow} の実行が ${run.conclusion} になりました: ${run.html_url}`,
        };
      return failed(
        `${target.workflow} の実行が ${run.conclusion} で終わりました`,
      );
    }
    if (ctx.now().getTime() > deadline) {
      return failed(
        `${target.workflow} が ${ctx.config.deploy.timeoutMinutes} 分たっても終わりませんでした`,
      );
    }
    await ctx.sleep(POLL_MS);
  }
}

async function runAndVerify(
  ctx: Ctx,
  targets: DeployTarget[],
  mergeSha: string,
): Promise<Step> {
  for (const target of targets) {
    const step = await runTarget(ctx, target, mergeSha);
    if (step.kind !== "ok") return step;
  }
  const { verify } = ctx.config.deploy;
  if (!verify) return { kind: "ok" };
  const result = await ctx.runShell(verify);
  return result.code === 0
    ? { kind: "ok" }
    : failed("deploy.verify が失敗しました", result.code, result.output);
}

async function rollback(ctx: Ctx): Promise<string> {
  const command = ctx.config.deploy.rollback;
  if (!command)
    return "ロールバックの設定が無いため、ロールバックしていません。";
  if (command.endsWith(".yml")) {
    await ctx.gh.dispatchWorkflow(command, ctx.defaultBranch, {});
    return `ロールバックのワークフロー ${command} を起動しました。`;
  }
  const result = await ctx.runShell(command);
  return result.code === 0
    ? "ロールバックのコマンドを実行しました。"
    : `ロールバックのコマンドが失敗しました (終了コード ${result.code})。`;
}

async function sameCauseCount(ctx: Ctx, marker: string): Promise<number> {
  return (await ctx.gh.listOpenIssues()).filter((i) => i.body?.includes(marker))
    .length;
}

// デプロイの前に決める。調べられなければ、取り消せないものとして扱う
async function isIrreversible(ctx: Ctx, pull: Pull): Promise<boolean> {
  try {
    const found = await irreversibleReasons(ctx, pull);
    return found.waiting || found.reasons.length > 0;
  } catch {
    return true;
  }
}

async function handleFailure(
  ctx: Ctx,
  pull: Pull,
  step: Extract<Step, { kind: "failed" }>,
  irreversible: boolean,
): Promise<void> {
  const errors: string[] = [];
  const attempt = async <T>(what: string, fn: () => Promise<T>) => {
    try {
      return await fn();
    } catch (e) {
      errors.push(`${what}に失敗しました: ${(e as Error).message}`);
      return undefined;
    }
  };
  // 指紋は出力から作るが、出力そのものは Issue にも Slack にも出さない
  const fingerprint = failureFingerprint(step.output).replaceAll(
    "-->",
    "--&gt;",
  );
  const marker = `${DEPLOY_FAILURE_MARKER}${fingerprint} -->`;
  const sameCause =
    (await attempt("同じ原因の Issue の確認", () =>
      sameCauseCount(ctx, marker),
    )) ?? 0;
  const outcome = decideAfterVerify(
    { ok: false, irreversible, sameCauseCount: sameCause },
    ctx.config,
  );
  if (outcome.kind === "done") return;
  const note =
    outcome.kind === "rollback"
      ? ((await attempt("ロールバック", () => rollback(ctx))) ??
        "ロールバックできていません。")
      : "";
  const labels =
    outcome.kind === "rollback" ? [outcome.issueLabel] : [LABELS.needsHuman];
  const exit =
    step.exitCode === undefined ? "" : `終了コード: ${step.exitCode}`;
  await attempt("Issue の作成", () =>
    ctx.gh.createIssue({
      title: `デプロイ後の確認に失敗しました: ${pull.title} (#${pull.number})`,
      body: [
        `PR #${pull.number} のマージ後のデプロイが失敗しました。`,
        [`失敗したこと: ${step.what}`, exit].filter(Boolean).join("\n"),
        note,
        `[実行のログ](${ctx.runUrl})`,
        marker,
      ]
        .filter((s) => s !== "")
        .join("\n\n"),
      labels,
    }),
  );
  // 人に届くよう、Slack は最後に必ず試す
  await ctx.notify({
    kind: outcome.kind === "rollback" ? "deploy_rolled_back" : "deploy_hold",
    title: pull.title,
    url: pull.html_url,
    details: [step.what, exit, note, ...errors].filter((s) => s !== ""),
    links: [{ label: "実行のログ", url: ctx.runUrl }],
  });
  if (errors.length > 0) throw new Error(errors.join("; "));
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

  // マージされた PR が設定を書き換えていても効かないよう、マージの前の親から読む
  const parent = (await base.gh.getCommitParents(mergeSha))[0];
  if (!parent) throw new Error("マージの前の commit が分かりません");
  const config = parseConfig(
    await base.gh.getRepoFile(".github/autopilot.yml", parent),
  );
  const ctx: Ctx = { ...base, config };

  const targets = planDeployTargets(config);
  const done = () =>
    ctx.notify({
      kind: "done",
      title: pull.title,
      url: pull.html_url,
      details: [],
      links: [{ label: "実行のログ", url: ctx.runUrl }],
    });
  if (targets.length === 0) return done();

  const irreversible = await isIrreversible(ctx, pull);
  const step = await runAndVerify(ctx, targets, mergeSha);
  if (step.kind === "ok") return done();
  if (step.kind === "skipped") {
    console.log(step.reason);
    return;
  }
  await handleFailure(ctx, pull, step, irreversible);
}
