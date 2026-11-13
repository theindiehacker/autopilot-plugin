import type { Issue, IssueEvent, Pull } from "../github";
import { planSweep, type SweepItem } from "../sweeper";
import { headMarker, LABELS, MARKERS } from "../types";
import { type Ctx, isAutopilotPull, needsHuman, sameLogin } from "./context";

async function issueItem(
  ctx: Ctx,
  issue: Issue,
  pulls: Pull[],
): Promise<SweepItem> {
  const events = await ctx.gh.listIssueEvents(issue.number);
  const isReady = (e: IssueEvent) =>
    e.event === "labeled" && e.label?.name === LABELS.ready;
  // 付け直しの回数は、needs-human が最後に外された後から数える (人が外して付け直すと、数え直す)
  const released = events.findLastIndex(
    (e) => e.event === "unlabeled" && e.label?.name === LABELS.needsHuman,
  );
  const readyAfterRelease = events.slice(released + 1).filter(isReady);
  // ラベルの event が無ければ (古い Issue など) 作成時刻を使う
  const readyLabeledAt =
    events.filter(isReady).at(-1)?.created_at ?? issue.created_at;
  const labeledMs = Date.parse(readyLabeledAt);
  // 開発は、開発の Draft PR を作るか、前の試みの PR を使い続けて push して始まる。
  // ラベルより前に作られ、その後に動きの無い PR は、前の試みのもの
  const startedAt = pulls
    .filter(
      (p) =>
        p.head.ref.startsWith(`autopilot/${issue.number}-`) &&
        (Date.parse(p.created_at) >= labeledMs ||
          Date.parse(p.updated_at) >= labeledMs),
    )
    .map((p) => p.updated_at)
    .sort((a, b) => Date.parse(a) - Date.parse(b))
    .at(-1);
  return {
    kind: "issue",
    number: issue.number,
    title: issue.title,
    url: issue.html_url,
    labels: issue.labels.map((l) => l.name),
    readyLabeledAt,
    readyRetries: Math.max(0, readyAfterRelease.length - 1),
    ...(startedAt ? { startedAt } : {}),
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
  const issueNumber = pull.head.ref.match(/^autopilot\/(\d+)-/)?.[1];
  return {
    kind: "pr",
    number: pull.number,
    title: pull.title,
    url: pull.html_url,
    labels: pull.labels.map((l) => l.name),
    readyRetries: 0,
    updatedAt: pull.updated_at,
    conflicting: full.mergeable_state === "dirty",
    headSha: full.head.sha,
    ...(issueNumber ? { issueNumber: Number(issueNumber) } : {}),
    wakes,
    reviewRequested:
      (full.requested_reviewers ?? []).length > 0 ||
      (full.requested_teams ?? []).length > 0,
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
