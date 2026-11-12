import { LABELS, MARKERS } from "../types";
import {
  type Ctx,
  eventNumber,
  hasLabel,
  isAutopilotPull,
  needsHuman,
  sameLogin,
} from "./context";

export async function fixRound(ctx: Ctx): Promise<void> {
  const n = eventNumber(ctx.event);
  if (n === undefined) {
    ctx.setOutput("run", "false");
    return;
  }
  ctx.setOutput("pr", String(n));
  const pull = await ctx.gh.getPull(n);
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
  ctx.setOutput("run", "true");
}
