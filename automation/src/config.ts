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

  // 見回りが使うのは limits だけ。qa・review・required_checks は、QA や開発のルーティンが
  // 読むもので、不備があっても見回りを止めない。読めるものだけを読み、ほかは既定の値にする
  const obj = (v: unknown): Obj => (isObj(v) ? v : {});
  const text = (v: unknown): string | undefined =>
    typeof v === "string" && v !== "" ? v : undefined;

  const qa = obj(raw.qa);
  const qaStart = text(qa.start);
  const qaUrl = text(qa.url);

  const rv = obj(raw.review);
  const reviewer = text(rv.reviewer) ?? "claude[bot]";
  const trigger = TRIGGERS.find((t) => t === rv.trigger) ?? "none";
  const command = text(rv.command);

  const rc = raw.required_checks;
  const requiredChecks = (Array.isArray(rc) ? rc : []).flatMap(
    (item): RequiredCheck[] => {
      if (typeof item === "string") return item ? [{ name: item }] : [];
      if (!isObj(item)) return [];
      const name = text(item.name);
      if (!name) return [];
      const { paths } = item;
      return Array.isArray(paths) && paths.every((x) => typeof x === "string")
        ? [{ name, paths }]
        : [{ name }];
    },
  );

  const section = (key: string): Obj => {
    const v = raw[key];
    if (v === undefined || v === null) return {};
    if (isObj(v)) return v;
    issues.push(`${key} はオブジェクトにしてください`);
    return {};
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

  // limits (見回りが使う。不備があれば止める)
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
      trigger,
      ...(command ? { command } : {}),
    },
    requiredChecks,
    limits,
  };
}
