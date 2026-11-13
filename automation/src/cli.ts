import { type Ctx, createCtx, type Deps } from "./commands/context";
import { sweep } from "./commands/sweep";
import { createGitHubClient } from "./github";

const COMMANDS: Record<string, (ctx: Ctx) => Promise<void>> = {
  sweep,
};

// AUTOPILOT_APP_SLUG が無いと、App の印を数えられず、対応が終わらなくなる
const REQUIRED_ENV = [
  "GITHUB_TOKEN",
  "GITHUB_REPOSITORY",
  "AUTOPILOT_APP_SLUG",
];

function redact(text: string, secrets: (string | undefined)[]): string {
  let out = text;
  for (const s of secrets) if (s) out = out.replaceAll(s, "***");
  return out;
}

export async function main(
  argv: string[],
  env: Record<string, string | undefined>,
  deps: Deps = {},
): Promise<number> {
  const command = COMMANDS[argv[0] ?? ""];
  if (!command) {
    console.error(`不明なコマンドです: ${argv[0] ?? ""}`);
    return 2;
  }
  const missing = REQUIRED_ENV.filter((k) => !env[k]);
  if (missing.length > 0) {
    console.error(`必要な環境変数がありません: ${missing.join(", ")}`);
    return 1;
  }
  try {
    const gh = createGitHubClient({
      token: env.GITHUB_TOKEN ?? "",
      repo: env.GITHUB_REPOSITORY ?? "",
      ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
      ...(env.GITHUB_API_URL ? { apiUrl: env.GITHUB_API_URL } : {}),
    });
    const ctx = await createCtx(gh, env, deps);
    await command(ctx);
    return 0;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(redact(message, [env.GITHUB_TOKEN]));
    return 1;
  }
}

if (import.meta.main) process.exit(await main(Bun.argv.slice(2), process.env));
