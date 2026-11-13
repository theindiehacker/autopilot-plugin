import { appendFileSync } from "node:fs";
import { parseConfig } from "../config";
import type { GitHubClient, Pull } from "../github";
import { type AutopilotConfig, LABELS, MARKERS } from "../types";

export interface Deps {
  fetchImpl?: typeof fetch;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

// biome-ignore lint/suspicious/noExplicitAny: GitHub の event の中身は形を決めずに読む
type EventPayload = any;

export interface Ctx {
  gh: GitHubClient;
  config: AutopilotConfig;
  repo: string;
  defaultBranch: string;
  event: EventPayload;
  eventName: string;
  botLogin: string;
  serverUrl: string;
  runUrl: string;
  setOutput(key: string, value: string): void;
  now(): Date;
  sleep(ms: number): Promise<void>;
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
  await ctx.gh.createComment(n, `${MARKERS.needsHuman}\n${reason}`);
  await ctx.gh.addLabels(n, [LABELS.needsHuman]);
}

const CONFIG_PATH = ".github/autopilot.yml";

async function readEvent(
  env: Record<string, string | undefined>,
): Promise<EventPayload> {
  const eventPath = env.GITHUB_EVENT_PATH;
  return eventPath ? await Bun.file(eventPath).json() : {};
}

const runUrlOf = (env: Record<string, string | undefined>) =>
  `${env.GITHUB_SERVER_URL ?? "https://github.com"}/${env.GITHUB_REPOSITORY ?? ""}/actions/runs/${env.GITHUB_RUN_ID ?? ""}`;

const sleepOf = (deps: Deps) =>
  deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

/** 読み終えたデフォルトブランチと設定から Ctx を作る */
function buildCtx(
  gh: GitHubClient,
  env: Record<string, string | undefined>,
  deps: Deps,
  parts: {
    event: EventPayload;
    defaultBranch: string;
    config: AutopilotConfig;
  },
): Ctx {
  const { event, defaultBranch, config } = parts;
  return {
    gh,
    config,
    repo: env.GITHUB_REPOSITORY ?? "",
    defaultBranch,
    event,
    eventName: env.GITHUB_EVENT_NAME ?? "",
    botLogin: `${env.AUTOPILOT_APP_SLUG ?? ""}[bot]`,
    serverUrl: env.GITHUB_SERVER_URL ?? "https://github.com",
    runUrl: runUrlOf(env),
    setOutput: (key, value) => {
      if (env.GITHUB_OUTPUT)
        appendFileSync(env.GITHUB_OUTPUT, `${key}=${value}\n`);
    },
    now: deps.now ?? (() => new Date()),
    sleep: sleepOf(deps),
  };
}

export async function createCtx(
  gh: GitHubClient,
  env: Record<string, string | undefined>,
  deps: Deps,
): Promise<Ctx> {
  const event = await readEvent(env);
  // 設定は PR のブランチではなく、デフォルトブランチから読む
  const defaultBranch = (await gh.getRepo()).default_branch;
  const config = parseConfig(await gh.getRepoFile(CONFIG_PATH, defaultBranch));
  return buildCtx(gh, env, deps, { event, defaultBranch, config });
}
