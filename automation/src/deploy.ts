import type { AutopilotConfig } from "./types";

export type DeployTarget =
  | { kind: "wait"; workflow: string }
  | {
      kind: "dispatch";
      workflow: string;
      environment: string;
      inputs: Record<string, string>;
    };

export type DeployOutcome =
  | { kind: "done" }
  | { kind: "rollback"; issueLabel: "autopilot:ready" | "needs-human" }
  | { kind: "hold" };

export function planDeployTargets(config: AutopilotConfig): DeployTarget[] {
  const { mode, workflow, inputs, environments } = config.deploy;
  if (mode === "none" || workflow === undefined) return [];
  if (mode === "on_merge") return [{ kind: "wait", workflow }];
  return environments.map((environment) => ({
    kind: "dispatch",
    workflow,
    environment,
    inputs: Object.fromEntries(
      Object.entries(inputs).map(([key, value]) => [
        key,
        // biome-ignore lint/suspicious/noTemplateCurlyInString: 置き換え対象の記号そのもの
        value.replaceAll("${environment}", environment),
      ]),
    ),
  }));
}

// マージした PR の変更したファイルのうち、deploy.irreversible_paths の glob に合うもの
export function findIrreversiblePaths(
  changedFiles: string[],
  patterns: string[],
): string[] {
  const globs = patterns.map((p) => new Bun.Glob(p));
  return changedFiles.filter((f) => globs.some((g) => g.match(f)));
}

export function decideAfterVerify(
  input: { ok: boolean; irreversible: boolean; sameCauseCount: number },
  config: AutopilotConfig,
): DeployOutcome {
  if (input.ok) return { kind: "done" };
  if (input.irreversible && !config.deploy.rollbackAfterIrreversible) {
    return { kind: "hold" };
  }
  return {
    kind: "rollback",
    issueLabel: input.sameCauseCount >= 1 ? "needs-human" : "autopilot:ready",
  };
}

export function failureFingerprint(output: string): string {
  const line = output.split("\n").find((l) => l.trim() !== "") ?? "";
  return line
    .replace(
      /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g,
      "#",
    )
    .replace(/\b[0-9a-f]{6,}\b/gi, "#")
    .replace(/\d+/g, "#")
    .trim();
}
