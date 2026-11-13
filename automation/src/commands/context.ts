import { parseConfig } from "../config";
import type { GitHubClient, Pull } from "../github";
import { type AutopilotConfig, LABELS, MARKERS } from "../types";

export interface Deps {
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

export interface Ctx {
  gh: GitHubClient;
  config: AutopilotConfig;
  repo: string;
  defaultBranch: string;
  botLogin: string;
  now(): Date;
}

export const sameLogin = (a: string, b: string) =>
  a.toLowerCase() === b.toLowerCase();

export function isAutopilotPull(pull: Pull, repo: string): boolean {
  return (
    pull.head.repo !== null &&
    sameLogin(pull.head.repo.full_name, repo) &&
    pull.head.ref.startsWith("autopilot/")
  );
}

export async function needsHuman(
  ctx: Ctx,
  n: number,
  reason: string,
): Promise<void> {
  // ラベルを先に、印のコメントを後に (R53)。GitHub の Slack アプリが、ラベルの付いた
  // Issue・PR へのコメントとして知らせ、コメントで起きたセッションもラベルを読めるため
  await ctx.gh.addLabels(n, [LABELS.needsHuman]);
  await ctx.gh.createComment(n, `${MARKERS.needsHuman}\n${reason}`);
}

const CONFIG_PATH = ".github/autopilot.yml";

export async function createCtx(
  gh: GitHubClient,
  env: Record<string, string | undefined>,
  deps: Deps,
): Promise<Ctx> {
  // 設定は PR のブランチではなく、デフォルトブランチから読む
  const defaultBranch = (await gh.getRepo()).default_branch;
  const config = parseConfig(await gh.getRepoFile(CONFIG_PATH, defaultBranch));
  return {
    gh,
    config,
    repo: env.GITHUB_REPOSITORY ?? "",
    defaultBranch,
    botLogin: `${env.AUTOPILOT_APP_SLUG ?? ""}[bot]`,
    now: deps.now ?? (() => new Date()),
  };
}
