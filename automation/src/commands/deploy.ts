import {
  type DeployTarget,
  decideAfterVerify,
  failureFingerprint,
  planDeployTargets,
} from "../deploy";
import type { WorkflowRun } from "../github";
import { LABELS } from "../types";
import { type Ctx, isAutopilotPull } from "./context";
import { irreversibleReasons } from "./irreversible";

const POLL_MS = 30_000;
const FIND_TRIES = 12;
const FIND_MS = 5_000;
const MAX_OUTPUT = 3000;

async function findRun(
  ctx: Ctx,
  target: DeployTarget,
  mergeSha: string,
  since: string,
): Promise<WorkflowRun | undefined> {
  const query: Record<string, string> =
    target.kind === "wait"
      ? { head_sha: mergeSha }
      : { event: "workflow_dispatch", created: `>=${since}` };
  for (let i = 0; i < FIND_TRIES; i++) {
    const runs = await ctx.gh.listWorkflowRuns(target.workflow, query);
    const run = [...runs].sort((a, b) =>
      a.created_at.localeCompare(b.created_at),
    )[0];
    if (run) return run;
    await ctx.sleep(FIND_MS);
  }
  return undefined;
}

// 成功なら undefined、失敗なら理由を返す
async function runTarget(
  ctx: Ctx,
  target: DeployTarget,
  mergeSha: string,
): Promise<string | undefined> {
  const since = ctx.now().toISOString();
  if (target.kind === "dispatch") {
    await ctx.gh.dispatchWorkflow(
      target.workflow,
      ctx.defaultBranch,
      target.inputs,
    );
  }
  const found = await findRun(ctx, target, mergeSha, since);
  if (!found) return `${target.workflow} の実行が見つかりませんでした`;
  const deadline =
    ctx.now().getTime() + ctx.config.deploy.timeoutMinutes * 60_000;
  for (;;) {
    const run = await ctx.gh.getWorkflowRun(found.id);
    if (run.status === "completed") {
      return run.conclusion === "success"
        ? undefined
        : `${target.workflow} の実行が ${run.conclusion} で終わりました: ${run.html_url}`;
    }
    if (ctx.now().getTime() > deadline) {
      return `${target.workflow} が ${ctx.config.deploy.timeoutMinutes} 分たっても終わりませんでした: ${run.html_url}`;
    }
    await ctx.sleep(POLL_MS);
  }
}

async function runAndVerify(
  ctx: Ctx,
  targets: DeployTarget[],
  mergeSha: string,
): Promise<{ ok: boolean; output: string }> {
  for (const target of targets) {
    const failure = await runTarget(ctx, target, mergeSha);
    if (failure) return { ok: false, output: failure };
  }
  const { verify } = ctx.config.deploy;
  if (!verify) return { ok: true, output: "" };
  const result = await ctx.runShell(verify);
  return { ok: result.code === 0, output: result.output };
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
  const numbers = new Set<number>();
  for (const label of [LABELS.ready, LABELS.needsHuman]) {
    for (const issue of await ctx.gh.listOpenIssuesByLabel(label)) {
      if (issue.body?.includes(marker)) numbers.add(issue.number);
    }
  }
  return numbers.size;
}

export async function deploy(ctx: Ctx): Promise<void> {
  if (ctx.eventName !== "pull_request_target" || ctx.event.action !== "closed")
    return;
  const pull = await ctx.gh.getPull(ctx.event.pull_request.number);
  if (!pull.merged || !isAutopilotPull(pull, ctx.repo)) return;

  const base = { title: pull.title, url: pull.html_url };
  const links = [{ label: "実行のログ", url: ctx.runUrl }];
  const targets = planDeployTargets(ctx.config);
  const mergeSha = pull.merge_commit_sha ?? "";
  const result =
    targets.length === 0
      ? { ok: true, output: "" }
      : await runAndVerify(ctx, targets, mergeSha);

  const found = await irreversibleReasons(ctx, pull);
  const irreversible = !found.waiting && found.reasons.length > 0;
  const marker = `<!-- autopilot:deploy-failure:${failureFingerprint(result.output)} -->`;
  const outcome = decideAfterVerify(
    {
      ok: result.ok,
      irreversible,
      sameCauseCount: result.ok ? 0 : await sameCauseCount(ctx, marker),
    },
    ctx.config,
  );
  if (outcome.kind === "done") {
    await ctx.notify({ ...base, kind: "done", details: [], links });
    return;
  }
  const note = outcome.kind === "rollback" ? await rollback(ctx) : "";
  const log = result.output.slice(-MAX_OUTPUT).replaceAll("```", "'''");
  const labels =
    outcome.kind === "rollback" ? [outcome.issueLabel] : [LABELS.needsHuman];
  await ctx.gh.createIssue({
    title: `デプロイ後の確認に失敗しました: ${pull.title} (#${pull.number})`,
    body: [
      `PR #${pull.number} のマージ後のデプロイの確認に失敗しました。`,
      note,
      `\`\`\`\n${log}\n\`\`\``,
      `[実行のログ](${ctx.runUrl})`,
      marker,
    ]
      .filter((s) => s !== "")
      .join("\n\n"),
    labels,
  });
  await ctx.notify({
    ...base,
    kind: outcome.kind === "rollback" ? "deploy_rolled_back" : "deploy_hold",
    details: [note, ...(log ? [log.split("\n")[0] ?? ""] : [])].filter(
      (s) => s !== "",
    ),
    links,
  });
}
