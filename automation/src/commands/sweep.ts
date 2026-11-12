import type { Issue, Pull } from "../github";
import { planSweep, type SweepItem } from "../sweeper";
import { LABELS, MARKERS } from "../types";
import { type Ctx, isAutopilotPull, needsHuman, sameLogin } from "./context";

async function issueItem(
  ctx: Ctx,
  issue: Issue,
  pulls: Pull[],
): Promise<SweepItem> {
  const events = await ctx.gh.listIssueEvents(issue.number);
  const ready = events.filter(
    (e) => e.event === "labeled" && e.label?.name === LABELS.ready,
  );
  const comments = await ctx.gh.listComments(issue.number);
  const started = comments.filter(
    (c) =>
      c.user !== null &&
      sameLogin(c.user.login, ctx.config.routineGithubUser) &&
      c.body.includes(MARKERS.started),
  );
  const readyLabeledAt = ready.at(-1)?.created_at;
  const startedAt = started.at(-1)?.created_at;
  return {
    kind: "issue",
    number: issue.number,
    title: issue.title,
    url: issue.html_url,
    labels: issue.labels.map((l) => l.name),
    ...(readyLabeledAt ? { readyLabeledAt } : {}),
    readyRetries: Math.max(0, ready.length - 1),
    ...(startedAt ? { startedAt } : {}),
    hasPr: pulls.some((p) =>
      p.head.ref.startsWith(`autopilot/${issue.number}-`),
    ),
    updatedAt: issue.updated_at,
    conflicting: false,
  };
}

async function pullItem(ctx: Ctx, pull: Pull): Promise<SweepItem> {
  const full = await ctx.gh.getPull(pull.number); // 一覧には mergeable_state が無い
  return {
    kind: "pr",
    number: pull.number,
    title: pull.title,
    url: pull.html_url,
    labels: pull.labels.map((l) => l.name),
    readyRetries: 0,
    hasPr: true,
    updatedAt: pull.updated_at,
    conflicting: full.mergeable_state === "dirty",
  };
}

export async function sweep(ctx: Ctx): Promise<void> {
  const issues = await ctx.gh.listOpenIssuesByLabel(LABELS.ready);
  const pulls = (await ctx.gh.listOpenPulls()).filter((p) =>
    isAutopilotPull(p, ctx.repo),
  );
  const items: SweepItem[] = [];
  for (const i of issues) items.push(await issueItem(ctx, i, pulls));
  for (const p of pulls) items.push(await pullItem(ctx, p));

  for (const a of planSweep(items, ctx.now(), ctx.config)) {
    if (a.type === "relabelReady") {
      await ctx.gh.removeLabel(a.number, LABELS.ready);
      await ctx.gh.addLabels(a.number, [LABELS.ready]);
    } else if (a.type === "needsHuman") {
      await needsHuman(ctx, a.number, a.reason);
    } else {
      await ctx.gh.dispatchWorkflow(ctx.workflowFile, ctx.defaultBranch, {
        pr: String(a.number),
      });
    }
  }
}
