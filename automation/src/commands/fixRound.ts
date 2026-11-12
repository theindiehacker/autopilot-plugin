import { LABELS, MARKERS } from "../types";
import {
  type Ctx,
  eventNumber,
  hasLabel,
  isAutopilotPull,
  needsHuman,
  sameLogin,
} from "./context";

// 対応を起こせるのは、設定のレビュアー・App・書き込み権限のある人だけ
async function mayStartFix(ctx: Ctx): Promise<boolean> {
  const bot = (login: string) => sameLogin(login, ctx.botLogin);
  let login: string | undefined;
  if (ctx.eventName === "pull_request_review") {
    login = ctx.event.review?.user?.login;
    if (login && sameLogin(login, ctx.config.review.reviewer)) return true;
  } else if (ctx.eventName === "workflow_dispatch") {
    login = ctx.event.sender?.login;
  } else {
    return true;
  }
  if (!login) return false;
  if (bot(login)) return true;
  const permission = await ctx.gh.getPermission(login);
  return permission === "admin" || permission === "write";
}

export async function fixRound(ctx: Ctx): Promise<void> {
  const n = eventNumber(ctx.event);
  if (n === undefined) {
    ctx.setOutput("run", "false");
    return;
  }
  ctx.setOutput("pr", String(n));
  if (!(await mayStartFix(ctx))) {
    ctx.setOutput("run", "false");
    return;
  }
  const pull = await ctx.gh.getPull(n);
  // CI の失敗からの起動は、同じリポジトリの、PR の今の head の実行だけ
  const wr = ctx.event.workflow_run;
  if (
    ctx.eventName === "workflow_run" &&
    !(
      typeof wr?.head_repository?.full_name === "string" &&
      sameLogin(wr.head_repository.full_name, ctx.repo) &&
      typeof wr.head_sha === "string" &&
      wr.head_sha === pull.head.sha
    )
  ) {
    ctx.setOutput("run", "false");
    return;
  }
  if (
    !isAutopilotPull(pull, ctx.repo) ||
    hasLabel(pull.labels, LABELS.needsHuman)
  ) {
    ctx.setOutput("run", "false");
    return;
  }
  const rounds = (await ctx.gh.listComments(n)).filter(
    (c) =>
      c.user !== null &&
      sameLogin(c.user.login, ctx.botLogin) &&
      c.body.includes(MARKERS.fixRound),
  ).length;
  const max = ctx.config.limits.maxFixRounds;
  if (rounds >= max) {
    await needsHuman(
      ctx,
      n,
      `対応を ${max} 回行いましたが、まだ直っていません。人の判断が必要です。`,
    );
    ctx.setOutput("run", "false");
    return;
  }
  await ctx.gh.createComment(n, `${MARKERS.fixRound} 対応 ${rounds + 1} 回目`);
  ctx.setOutput("ref", pull.head.ref);
  ctx.setOutput("run", "true");
}
