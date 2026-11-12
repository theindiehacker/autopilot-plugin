import { appendFileSync } from "node:fs";
import { parseConfig } from "../config";
import type { GitHubClient, Pull } from "../github";
import { formatSlackMessage, type Notification, sendSlack } from "../slack";
import { type AutopilotConfig, LABELS, MARKERS } from "../types";

/** デプロイの失敗の Issue の本文の最後の印 (この後ろに指紋と --> が続く) */
export const DEPLOY_FAILURE_MARKER = "<!-- autopilot:deploy-failure:";

export interface RunResult {
  code: number;
  output: string;
}

export interface Deps {
  fetchImpl?: typeof fetch;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  runShell?: (command: string) => Promise<RunResult>;
}

// biome-ignore lint/suspicious/noExplicitAny: GitHub の event の中身は形を決めずに読む
export type EventPayload = any;

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
  notify(n: Notification): Promise<void>;
  setOutput(key: string, value: string): void;
  now(): Date;
  sleep(ms: number): Promise<void>;
  runShell(command: string): Promise<RunResult>;
  /** 同じ workflow のファイル名 (workflow_dispatch の宛先) */
  workflowFile: string;
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

// 印を信じてよいのは、ルーティンの持ち主と App だけ
export const isTrustedAuthor = (ctx: Ctx, login: string | undefined) =>
  login !== undefined &&
  (sameLogin(login, ctx.config.routineGithubUser) ||
    sameLogin(login, ctx.botLogin));

export const hasLabel = (labels: { name: string }[], name: string) =>
  labels.some((l) => l.name === name);

export function eventNumber(event: EventPayload): number | undefined {
  // PR ではない Issue のコメントは対象にしない
  if (event.issue && !event.issue.pull_request) return undefined;
  const n =
    event.pull_request?.number ??
    event.issue?.number ??
    event.workflow_run?.pull_requests?.[0]?.number ??
    event.inputs?.pr;
  const parsed = Number(n);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export async function needsHuman(
  ctx: Ctx,
  n: number,
  reason: string,
): Promise<void> {
  await ctx.gh.createComment(n, `${MARKERS.needsHuman}\n${reason}`);
  await ctx.gh.addLabels(n, [LABELS.needsHuman]);
}

const SHELL_TIMEOUT_MS = 10 * 60_000;

// verify・rollback のコマンドには、トークンも、それと同じ値の変数も渡さない。
// 10 分で終わらなければ失敗とする。
export async function defaultRunShell(
  command: string,
  opts: {
    env: Record<string, string | undefined>;
    secrets: string[];
    timeoutMs?: number;
  },
): Promise<RunResult> {
  const secrets = opts.secrets.filter((s) => s !== "");
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(opts.env)) {
    if (value === undefined) continue;
    if (key === "GITHUB_TOKEN" || key === "AUTOPILOT_SLACK_WEBHOOK_URL")
      continue;
    if (secrets.includes(value)) continue;
    env[key] = value;
  }
  // 自分のプロセスグループで動かし、時間切れでは、孫のプロセスまでまとめて止める
  const proc = Bun.spawn(["bash", "-c", command], {
    env,
    stdout: "pipe",
    stderr: "pipe",
    detached: true,
  });
  const collect = async () => {
    const [out, err, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { code, output: out + err };
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(
      () => resolve("timeout"),
      opts.timeoutMs ?? SHELL_TIMEOUT_MS,
    );
  });
  const result = await Promise.race([collect(), timeout]);
  clearTimeout(timer);
  if (result === "timeout") {
    try {
      process.kill(-proc.pid, "SIGKILL");
    } catch {
      proc.kill("SIGKILL");
    }
    // パイプを読み終わるのは待たない
    return { code: 124, output: "時間切れで止めました" };
  }
  let output = result.output;
  for (const s of secrets) output = output.replaceAll(s, "***");
  return { code: result.code, output };
}

export const CONFIG_PATH = ".github/autopilot.yml";

export async function readEvent(
  env: Record<string, string | undefined>,
): Promise<EventPayload> {
  const eventPath = env.GITHUB_EVENT_PATH;
  return eventPath ? await Bun.file(eventPath).json() : {};
}

export const runUrlOf = (env: Record<string, string | undefined>) =>
  `${env.GITHUB_SERVER_URL ?? "https://github.com"}/${env.GITHUB_REPOSITORY ?? ""}/actions/runs/${env.GITHUB_RUN_ID ?? ""}`;

export const sleepOf = (deps: Deps) =>
  deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

/** Slack に送る */
export function slackSender(
  env: Record<string, string | undefined>,
  deps: Deps,
): (n: Notification) => Promise<void> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  return async (n) => {
    const url = env.AUTOPILOT_SLACK_WEBHOOK_URL;
    if (!url) throw new Error("AUTOPILOT_SLACK_WEBHOOK_URL が未設定です");
    await sendSlack(url, formatSlackMessage(n), fetchImpl);
  };
}

/** 読み終えたデフォルトブランチと設定から Ctx を作る */
export function buildCtx(
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
  const secrets = [
    env.GITHUB_TOKEN ?? "",
    env.AUTOPILOT_SLACK_WEBHOOK_URL ?? "",
  ];
  const workflowRef = env.GITHUB_WORKFLOW_REF?.match(
    /\.github\/workflows\/([^@]+)@/,
  );
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
    workflowFile: workflowRef?.[1] ?? "autopilot.yml",
    notify: slackSender(env, deps),
    setOutput: (key, value) => {
      if (env.GITHUB_OUTPUT)
        appendFileSync(env.GITHUB_OUTPUT, `${key}=${value}\n`);
    },
    now: deps.now ?? (() => new Date()),
    sleep: sleepOf(deps),
    runShell: deps.runShell ?? ((c) => defaultRunShell(c, { env, secrets })),
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
