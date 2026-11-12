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
  if (pull.auto_merge) return;
  await ctx.gh.enableAutoMerge(pull.node_id);
}
