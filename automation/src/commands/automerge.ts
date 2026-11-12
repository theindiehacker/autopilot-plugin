import { type Ctx, isAutopilotPull } from "./context";

const ACTIONS = ["opened", "reopened", "ready_for_review"];

export async function automerge(ctx: Ctx): Promise<void> {
  if (
    ctx.eventName !== "pull_request_target" ||
    !ACTIONS.includes(ctx.event.action)
  )
    return;
  const pull = await ctx.gh.getPull(ctx.event.pull_request.number);
  if (!isAutopilotPull(pull, ctx.repo) || pull.state !== "open") return;
  // Draft は、ready_for_review のときに改めて処理する
  if (pull.draft || pull.auto_merge) return;
  try {
    await ctx.gh.enableAutoMerge(pull.node_id);
  } catch (e) {
    // 検査がすべて終わっていると、自動マージは有効にできない。直接マージする
    if (!/clean status/i.test((e as Error).message)) throw e;
    await ctx.gh.mergePull(pull.number, pull.head.sha);
  }
}
