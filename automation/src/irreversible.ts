import type { AutopilotConfig } from "./types";

export function findIrreversiblePaths(
  changedFiles: string[],
  patterns: string[],
): string[] {
  const globs = patterns.map((p) => new Bun.Glob(p));
  return changedFiles.filter((f) => globs.some((g) => g.match(f)));
}

export function findTerraformDestroys(plan: unknown): string[] {
  if (typeof plan !== "object" || plan === null) return [];
  const changes = (plan as { resource_changes?: unknown }).resource_changes;
  if (!Array.isArray(changes)) return [];
  const addresses: string[] = [];
  for (const rc of changes) {
    const address = rc?.address;
    const actions = rc?.change?.actions;
    if (
      typeof address === "string" &&
      Array.isArray(actions) &&
      actions.includes("delete")
    ) {
      addresses.push(address);
    }
  }
  return addresses;
}

export function detectIrreversible(input: {
  changedFiles: string[];
  config: AutopilotConfig;
  terraformPlan?: unknown;
}): string[] {
  const paths = findIrreversiblePaths(
    input.changedFiles,
    input.config.irreversible.paths,
  );
  return [
    ...paths.map((f) => `パス: ${f}`),
    ...findTerraformDestroys(input.terraformPlan).map(
      (a) => `Terraform: ${a} を削除または作り直し`,
    ),
  ];
}
