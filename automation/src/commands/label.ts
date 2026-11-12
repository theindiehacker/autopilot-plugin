import { LABELS, MARKERS } from "../types";
import { type Ctx, DEPLOY_FAILURE_MARKER, isTrustedAuthor } from "./context";

function firstParagraph(body: string): string | undefined {
  return body
    .replace(/<!--[\s\S]*?-->/g, "")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .find((p) => p !== "");
}

async function labelFromComment(ctx: Ctx): Promise<void> {
  const { action, comment, issue } = ctx.event;
  if (action !== "created" || !comment?.body.includes(MARKERS.needsHuman))
    return;
  if (!isTrustedAuthor(ctx, comment.user?.login)) return;
  await ctx.gh.addLabels(issue.number, [LABELS.needsHuman]);
}

async function notifyNeedsHuman(ctx: Ctx): Promise<void> {
  const { event } = ctx;
  if (event.action !== "labeled" || event.label?.name !== LABELS.needsHuman)
    return;
  const item = event.issue ?? event.pull_request;
  // デプロイの失敗の Issue は、デプロイの処理が Slack に送っている
  if (item.body?.includes(DEPLOY_FAILURE_MARKER)) return;
  const comments = await ctx.gh.listComments(item.number);
  const marked = comments.filter(
    (c) =>
      c.body.includes(MARKERS.needsHuman) &&
      isTrustedAuthor(ctx, c.user?.login),
  );
  const source = marked.at(-1) ?? comments.at(-1);
  const detail = source ? firstParagraph(source.body) : undefined;
  await ctx.notify({
    kind: "needs_human",
    title: item.title,
    url: item.html_url,
    details: detail ? [detail] : [],
  });
}

export async function label(ctx: Ctx): Promise<void> {
  if (ctx.eventName === "issue_comment") return labelFromComment(ctx);
  if (ctx.eventName === "issues" || ctx.eventName === "pull_request_target")
    return notifyNeedsHuman(ctx);
}
