import { evaluateIrreversible } from "../gate";
import type { Pull } from "../github";
import { detectIrreversible } from "../irreversible";
import { STATUS } from "../types";
import { type Ctx, isTrustedAuthor } from "./context";

const NOTIFIED = /<!-- autopilot:notified:(.+?) -->/g;

async function pullNumber(ctx: Ctx): Promise<number | undefined> {
  const { event } = ctx;
  if (event.pull_request?.number) return event.pull_request.number;
  const run = event.workflow_run;
  if (!run) return undefined;
  if (run.pull_requests?.[0]?.number) return run.pull_requests[0].number;
  const pulls = await ctx.gh.listOpenPulls();
  return pulls.find((p) => p.head.sha === run.head_sha)?.number;
}

export async function expandApprovers(ctx: Ctx): Promise<string[]> {
  const logins: string[] = [];
  for (const entry of ctx.config.approvers) {
    const [org, team] = entry.split("/");
    if (org && team) logins.push(...(await ctx.gh.listTeamMembers(org, team)));
    else logins.push(entry);
  }
  return logins;
}

type Reasons = { waiting: true } | { waiting: false; reasons: string[] };

// 変更したファイルと、あれば Terraform の plan から、取り消せない変更の理由を出す
export async function irreversibleReasons(
  ctx: Ctx,
  pull: Pull,
): Promise<Reasons> {
  const changedFiles = await ctx.gh.listPullFiles(pull.number);
  const name = ctx.config.irreversible.terraformPlanArtifact;
  let terraformPlan: unknown;
  if (name !== undefined) {
    const found = (await ctx.gh.listArtifacts(name)).find(
      (a) => a.headSha === pull.head.sha && !a.expired,
    );
    if (!found) return { waiting: true };
    try {
      terraformPlan = await ctx.gh.downloadArtifactJson(found.runId, name);
    } catch {
      terraformPlan = undefined; // 読めないことは detectIrreversible が理由にする
    }
  }
  return {
    waiting: false,
    reasons: detectIrreversible({
      changedFiles,
      config: ctx.config,
      terraformPlan,
    }),
  };
}

async function notifiedKeys(ctx: Ctx, n: number): Promise<string[]> {
  const keys: string[] = [];
  for (const c of await ctx.gh.listComments(n)) {
    if (!isTrustedAuthor(ctx, c.user?.login)) continue;
    for (const m of c.body.matchAll(NOTIFIED)) if (m[1]) keys.push(m[1]);
  }
  return keys;
}

export async function irreversible(ctx: Ctx): Promise<void> {
  const n = await pullNumber(ctx);
  if (n === undefined) return;
  const pull = await ctx.gh.getPull(n);
  if (pull.state !== "open") return;
  const sha = pull.head.sha;
  const found = await irreversibleReasons(ctx, pull);
  if (found.waiting) {
    await ctx.gh.setStatus(
      sha,
      STATUS.irreversible,
      "pending",
      "Terraform の plan を待っています",
    );
    return;
  }
  const decision = evaluateIrreversible({
    pr: {
      number: n,
      title: pull.title,
      url: pull.html_url,
      headSha: sha,
      author: pull.user.login,
    },
    reviews: await ctx.gh.listReviews(n),
    approverLogins: await expandApprovers(ctx),
    irreversible: found.reasons,
    notified: await notifiedKeys(ctx, n),
  });
  await ctx.gh.setStatus(
    sha,
    STATUS.irreversible,
    decision.state,
    decision.description,
  );
  for (const action of decision.actions) {
    // Slack を先に送り、あとで印を書く (R3)
    await ctx.notify({
      kind: action.kind,
      title: pull.title,
      url: pull.html_url,
      details: action.reasons,
    });
    await ctx.gh.createComment(
      n,
      `取り消せない変更があるため、承認をお願いしました。\n<!-- autopilot:notified:${action.key} -->`,
    );
  }
}
