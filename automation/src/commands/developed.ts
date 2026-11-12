import { MARKERS } from "../types";
import { type Ctx, isAutopilotPull, sameLogin } from "./context";

// 開発のルーティンが、終わったら PR にコメントする (印 developed + 新しい本文)。
// そのコメントで、PR の本文を書き換えてから「レビュー可能」にする。
// 書き換えを先にするのは、QA が「レビュー可能」になったときに本文を読むため。
export async function developed(ctx: Ctx): Promise<void> {
  const { action, comment, issue } = ctx.event;
  if (ctx.eventName !== "issue_comment" || action !== "created") return;
  if (!issue?.pull_request) return;
  if (!comment?.body.includes(MARKERS.developed)) return;
  const login: string | undefined = comment.user?.login;
  if (!login || !sameLogin(login, ctx.config.routineGithubUser)) return;

  const pull = await ctx.gh.getPull(issue.number);
  if (
    !isAutopilotPull(pull, ctx.repo) ||
    pull.state !== "open" ||
    !pull.draft ||
    !pull.body?.includes(MARKERS.developing)
  )
    return;

  const body = comment.body
    .replaceAll(MARKERS.developed, "")
    .replaceAll(MARKERS.developing, "")
    .trim();
  if (body === "") return;
  await ctx.gh.updatePullBody(pull.number, body);
  await ctx.gh.markReadyForReview(pull.node_id);
}
