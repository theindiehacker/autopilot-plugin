import type { Issue, Pull } from "../github";
import { planSweep, type SweepItem } from "../sweeper";
import { headMarker, LABELS, MARKERS } from "../types";
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
  // ラベルの event が無ければ (古い Issue など) 作成時刻を使う
  const readyLabeledAt = ready.at(-1)?.created_at ?? issue.created_at;
  // 開発は、開発の Draft PR を作って始まる。ラベルより前の PR は、前の試みのもの
  const developing = pulls.filter(
    (p) =>
      p.head.ref.startsWith(`autopilot/${issue.number}-`) &&
      Date.parse(p.created_at) >= Date.parse(readyLabeledAt),
  );
  const startedAt = developing
    .map((p) => p.created_at)
    .sort((a, b) => Date.parse(a) - Date.parse(b))
    .at(-1);
  return {
    kind: "issue",
    number: issue.number,
    title: issue.title,
    url: issue.html_url,
    labels: issue.labels.map((l) => l.name),
    readyLabeledAt,
    readyRetries: Math.max(0, ready.length - 1),
    ...(startedAt ? { startedAt } : {}),
    hasPr: pulls.some((p) =>
      p.head.ref.startsWith(`autopilot/${issue.number}-`),
    ),
    updatedAt: issue.updated_at,
    conflicting: false,
    wakes: [],
  };
}

async function pullItem(ctx: Ctx, pull: Pull): Promise<SweepItem> {
  const full = await ctx.gh.getPull(pull.number); // 一覧には mergeable_state が無い
  const wakes = (await ctx.gh.listComments(pull.number)).flatMap((c) => {
    if (!sameLogin(c.user?.login ?? "", ctx.botLogin)) return [];
    if (!c.body.includes(MARKERS.wake)) return [];
    const headSha = c.body.match(/<!-- autopilot:head (\S+) -->/)?.[1];
    return headSha ? [{ at: c.created_at, headSha }] : [];
  });
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
    headSha: full.head.sha,
    wakes,
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
      await ctx.gh.createComment(
        a.number,
        `${MARKERS.wake}\n${headMarker(a.headSha)}\nautopilot の見回り: ${a.reason}。開発のセッションは、この PR を見直して、直すことがあれば直してください。`,
      );
    }
  }
}
