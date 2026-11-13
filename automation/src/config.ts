import type { AutopilotConfig, RequiredCheck } from "./types";

export class ConfigError extends Error {
  issues: string[];
  constructor(issues: string[]) {
    super(`設定ファイルが不正です:\n${issues.map((i) => `- ${i}`).join("\n")}`);
    this.name = "ConfigError";
    this.issues = issues;
  }
}

type Obj = Record<string, unknown>;

const TRIGGERS = ["ready_for_review", "comment", "none"] as const;

const isObj = (v: unknown): v is Obj =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function parseConfig(yamlText: string): AutopilotConfig {
  let raw: unknown;
  try {
    raw = Bun.YAML.parse(yamlText);
  } catch (e) {
    throw new ConfigError([`YAML を読めません: ${(e as Error).message}`]);
  }
  if (!isObj(raw)) throw new ConfigError(["設定がオブジェクトではありません"]);

  const issues: string[] = [];

  const section = (key: string): Obj => {
    const v = raw[key];
    if (v === undefined || v === null) return {};
    if (isObj(v)) return v;
    issues.push(`${key} はオブジェクトにしてください`);
    return {};
  };
  const str = (
    o: Obj,
    path: string,
    key: string,
    required = false,
  ): string | undefined => {
    const v = o[key];
    if (v === undefined || v === null) {
      if (required) issues.push(`${path} が必要です`);
      return undefined;
    }
    if (typeof v !== "string" || v === "") {
      issues.push(`${path} は文字列にしてください`);
      return undefined;
    }
    return v;
  };
  const strList = (o: Obj, path: string, key: string): string[] => {
    const v = o[key];
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) {
      issues.push(`${path} は文字列の配列にしてください`);
      return [];
    }
    return v as string[];
  };
  const num = (o: Obj, path: string, key: string, def: number): number => {
    const v = o[key];
    if (v === undefined || v === null) return def;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1) {
      issues.push(`${path} は 1 以上の整数にしてください`);
      return def;
    }
    return v;
  };
  const qa = section("qa");
  const qaStart = str(qa, "qa.start", "start");
  const qaUrl = str(qa, "qa.url", "url");

  // review
  const rv = section("review");
  const reviewer = str(rv, "review.reviewer", "reviewer", true) ?? "";
  const trigger = rv.trigger ?? "none";
  if (!TRIGGERS.includes(trigger as (typeof TRIGGERS)[number])) {
    issues.push(
      `review.trigger は ${TRIGGERS.join(" / ")} のどれかにしてください`,
    );
  }
  const command = str(rv, "review.command", "command");

  // required_checks
  const requiredChecks: RequiredCheck[] = [];
  const rc = raw.required_checks;
  if (rc !== undefined && rc !== null) {
    if (!Array.isArray(rc)) {
      issues.push("required_checks は配列にしてください");
    } else {
      rc.forEach((item, i) => {
        const path = `required_checks[${i}]`;
        if (typeof item === "string" && item !== "") {
          requiredChecks.push({ name: item });
        } else if (isObj(item)) {
          const name = str(item, `${path}.name`, "name", true);
          const paths =
            item.paths === undefined
              ? undefined
              : strList(item, `${path}.paths`, "paths");
          if (name) requiredChecks.push(paths ? { name, paths } : { name });
        } else {
          issues.push(`${path} は文字列か { name, paths } にしてください`);
        }
      });
    }
  }

  // limits
  const lm = section("limits");
  const limits = {
    maxFixRounds: num(lm, "limits.max_fix_rounds", "max_fix_rounds", 3),
    staleHours: num(lm, "limits.stale_hours", "stale_hours", 3),
    readyRetryMinutes: num(
      lm,
      "limits.ready_retry_minutes",
      "ready_retry_minutes",
      30,
    ),
  };

  if (issues.length > 0) throw new ConfigError(issues);

  return {
    qa: {
      ...(qaStart ? { start: qaStart } : {}),
      ...(qaUrl ? { url: qaUrl } : {}),
    },
    review: {
      reviewer,
      trigger: trigger as AutopilotConfig["review"]["trigger"],
      ...(command ? { command } : {}),
    },
    requiredChecks,
    limits,
  };
}
