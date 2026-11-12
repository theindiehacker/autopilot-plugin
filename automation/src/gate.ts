import { type AutopilotConfig, LABELS, STATUS } from "./types";

export type CheckState = "success" | "failure" | "pending" | "missing";

export interface Review {
  user: string;
  state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED";
  commitId: string;
  submittedAt: string;
}

export interface GateInput {
  pr: {
    number: number;
    title: string;
    url: string;
    headSha: string;
    author: string;
    labels: string[];
    isAutopilot: boolean;
    mergeable: "clean" | "conflicting" | "unknown";
    autoMergeEnabled: boolean;
  };
  changedFiles: string[];
  checks: Record<string, CheckState>;
  reviews: Review[];
  approverLogins: string[];
  irreversible: string[];
  fixRounds: number;
  notified: string[];
}

export type GateAction =
  | { type: "addLabel"; label: string }
  | { type: "comment"; body: string }
  | { type: "enableAutoMerge" }
  | {
      type: "notify";
      kind: "approval_request";
      key: string;
      reasons: string[];
    };

export interface GateDecision {
  state: "success" | "pending" | "failure";
  description: string;
  actions: GateAction[];
}

const MAX_DESCRIPTION = 140;

function describe(text: string): string {
  const chars = [...text];
  return chars.length <= MAX_DESCRIPTION
    ? text
    : `${chars.slice(0, MAX_DESCRIPTION - 1).join("")}…`;
}

function requiredCheckNames(
  input: GateInput,
  config: AutopilotConfig,
): string[] {
  const names = config.requiredChecks
    .filter((check) => {
      if (!check.paths || check.paths.length === 0) return true;
      const globs = check.paths.map((p) => new Bun.Glob(p));
      return input.changedFiles.some((file) =>
        globs.some((glob) => glob.match(file)),
      );
    })
    .map((check) => check.name);
  if (input.pr.isAutopilot) names.push(STATUS.qa);
  return [...new Set(names)].filter((name) => name !== STATUS.gate);
}

// ユーザーごとの最新の判定 (COMMENTED は除く)。
// 同じ時刻なら後に並んだものを使う。読めない時刻は、読める時刻より古い。
function latestVerdict(reviews: Review[], user: string): Review | undefined {
  const time = (r: Review) => {
    const t = Date.parse(r.submittedAt);
    return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
  };
  let latest: Review | undefined;
  for (const r of reviews) {
    if (r.user !== user || r.state === "COMMENTED") continue;
    if (!latest || time(r) >= time(latest)) latest = r;
  }
  return latest;
}

// 最新のコミットに対する、取り下げられていない判定だけを返す。
function currentVerdict(input: GateInput, user: string): Review | undefined {
  const latest = latestVerdict(input.reviews, user);
  if (!latest || latest.state === "DISMISSED") return undefined;
  return latest.commitId === input.pr.headSha ? latest : undefined;
}

function hasApproval(input: GateInput): boolean {
  return input.approverLogins
    .filter((login) => login !== input.pr.author)
    .some((login) => currentVerdict(input, login)?.state === "APPROVED");
}

export function evaluateGate(
  input: GateInput,
  config: AutopilotConfig,
): GateDecision {
  const { pr } = input;

  // 1. 人の判断待ち
  if (pr.labels.includes(LABELS.needsHuman)) {
    return {
      state: "failure",
      description: describe(
        "needs-human が付いています。人の対応を待っています",
      ),
      actions: [],
    };
  }

  // 2. 必須のチェック
  const required = requiredCheckNames(input, config);
  const checkState = (name: string): CheckState =>
    input.checks[name] ?? "missing";

  // 3. 失敗
  const failures: string[] = [];
  for (const name of required) {
    if (checkState(name) === "failure") failures.push(`チェック失敗: ${name}`);
  }
  const verdict = pr.isAutopilot
    ? currentVerdict(input, config.review.reviewer)
    : undefined;
  if (pr.isAutopilot && verdict?.state === "CHANGES_REQUESTED") {
    failures.push(`${config.review.reviewer} のレビューが修正を求めています`);
  }
  if (pr.mergeable === "conflicting") {
    failures.push("コンフリクトがあります");
  }
  if (failures.length > 0) {
    const description = describe(failures.join(" / "));
    const actions: GateAction[] = [];
    if (pr.isAutopilot && !pr.labels.includes(LABELS.fix)) {
      if (input.fixRounds >= config.limits.maxFixRounds) {
        actions.push(
          {
            type: "comment",
            body: `修正を ${input.fixRounds} 回行いましたが、まだ直っていません (上限 ${config.limits.maxFixRounds} 回)。人の対応が必要です。\n\n${failures.map((f) => `- ${f}`).join("\n")}`,
          },
          { type: "addLabel", label: LABELS.needsHuman },
        );
      } else {
        actions.push(
          {
            type: "comment",
            body: `関門が通りません。次を直してください。\n\n${failures.map((f) => `- ${f}`).join("\n")}`,
          },
          { type: "addLabel", label: LABELS.fix },
        );
      }
    }
    return { state: "failure", description, actions };
  }

  // 4. 待ち
  const waiting = required.filter((name) => {
    const s = checkState(name);
    return s === "pending" || s === "missing";
  });
  const waitingReview = pr.isAutopilot && verdict === undefined;
  if (waiting.length > 0 || waitingReview) {
    const parts = [...waiting.map((n) => `チェック待ち: ${n}`)];
    if (waitingReview) parts.push(`${config.review.reviewer} のレビュー待ち`);
    return {
      state: "pending",
      description: describe(parts.join(" / ")),
      actions: [],
    };
  }

  // 5. 取り消せない変更には承認者の Approve が要る
  if (input.irreversible.length > 0 && !hasApproval(input)) {
    const key = `approval:${pr.headSha}`;
    const actions: GateAction[] = input.notified.includes(key)
      ? []
      : [
          {
            type: "notify",
            kind: "approval_request",
            key,
            reasons: input.irreversible,
          },
        ];
    return {
      state: "pending",
      description: describe(
        `取り消せない変更があります。承認者の Approve を待っています: ${input.irreversible.join(", ")}`,
      ),
      actions,
    };
  }

  // 6. 成功
  return {
    state: "success",
    description: describe("関門を通過しました"),
    actions:
      pr.isAutopilot && !pr.autoMergeEnabled
        ? [{ type: "enableAutoMerge" }]
        : [],
  };
}
