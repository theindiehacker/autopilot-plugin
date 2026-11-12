import { automerge } from "./commands/automerge";
import { type Ctx, createCtx, type Deps } from "./commands/context";
import { deploy } from "./commands/deploy";
import { fixRound } from "./commands/fixRound";
import { irreversible } from "./commands/irreversible";
import { label } from "./commands/label";
import { ready } from "./commands/ready";
import { sweep } from "./commands/sweep";
import { createGitHubClient } from "./github";

const COMMANDS: Record<string, (ctx: Ctx) => Promise<void>> = {
  irreversible,
  automerge,
  label,
  "fix-round": fixRound,
  ready,
  sweep,
  deploy,
};

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
  try {
    const gh = createGitHubClient({
      token: env.GITHUB_TOKEN ?? "",
      repo: env.GITHUB_REPOSITORY ?? "",
      ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
      ...(env.GITHUB_API_URL ? { apiUrl: env.GITHUB_API_URL } : {}),
    });
    await command(await createCtx(gh, env, deps));
    return 0;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(
      redact(message, [env.GITHUB_TOKEN, env.AUTOPILOT_SLACK_WEBHOOK_URL]),
    );
    return 1;
  }
}

if (import.meta.main) process.exit(await main(Bun.argv.slice(2), process.env));
