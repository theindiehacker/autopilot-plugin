import { type Ctx, eventNumber } from "./context";

export async function ready(ctx: Ctx): Promise<void> {
  const n = eventNumber(ctx.event);
  if (n === undefined) return;
  const pull = await ctx.gh.getPull(n);
  if (pull.draft) await ctx.gh.markReadyForReview(pull.node_id);
}
