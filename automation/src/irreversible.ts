import type { AutopilotConfig } from "./types";

// 設定に書かなくても、いつも取り消せない変更として扱うパス
// (自動化の設定・ワークフロー・検査の仕組みを、人の承認なしに書き換えさせない)
export const BUILTIN_IRREVERSIBLE_PATHS: string[] = [
  ".github/autopilot.yml",
  ".github/workflows/**",
  ".claude/settings.json",
  "lefthook.yml",
  "lefthook.yaml",
  ".lefthook.yml",
  ".pre-commit-config.yaml",
];

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

function isValidPlan(plan: unknown): boolean {
  if (typeof plan !== "object" || plan === null) return false;
  const p = plan as { format_version?: unknown; resource_changes?: unknown };
  return (
    typeof p.format_version === "string" &&
    (p.resource_changes === undefined || Array.isArray(p.resource_changes))
  );
}

export function detectIrreversible(input: {
  changedFiles: string[];
  config: AutopilotConfig;
  terraformPlan?: unknown;
}): string[] {
  const paths = findIrreversiblePaths(input.changedFiles, [
    ...input.config.irreversible.paths,
    ...BUILTIN_IRREVERSIBLE_PATHS,
  ]);
  const planUnreadable =
    input.config.irreversible.terraformPlanArtifact !== undefined &&
    !isValidPlan(input.terraformPlan);
  return [
    ...paths.map((f) => `パス: ${f}`),
    ...(planUnreadable ? ["Terraform: plan を読めませんでした"] : []),
    ...findTerraformDestroys(input.terraformPlan).map(
      (a) => `Terraform: ${a} を削除または作り直し`,
    ),
  ];
}
