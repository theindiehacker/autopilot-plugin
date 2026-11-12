export interface Review {
  user: string;
  state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED";
  commitId: string;
  submittedAt: string;
}

export interface IrreversibleInput {
  pr: {
    number: number;
    title: string;
    url: string;
    headSha: string;
    author: string;
  };
  reviews: Review[];
  approverLogins: string[];
  irreversible: string[];
  notified: string[];
}

export interface IrreversibleDecision {
  state: "success" | "pending";
  description: string;
  actions: {
    type: "notify";
    kind: "approval_request";
    key: string;
    reasons: string[];
  }[];
}

const MAX_DESCRIPTION = 140;

function describe(text: string): string {
  const chars = [...text];
  return chars.length <= MAX_DESCRIPTION
    ? text
    : `${chars.slice(0, MAX_DESCRIPTION - 1).join("")}…`;
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
function currentVerdict(
  input: IrreversibleInput,
  user: string,
): Review | undefined {
  const latest = latestVerdict(input.reviews, user);
  if (!latest || latest.state === "DISMISSED") return undefined;
  return latest.commitId === input.pr.headSha ? latest : undefined;
}

export function evaluateIrreversible(
  input: IrreversibleInput,
): IrreversibleDecision {
  const { pr } = input;
  if (input.irreversible.length === 0) {
    return {
      state: "success",
      description: "取り消せない変更はありません",
      actions: [],
    };
  }
  const approver = input.approverLogins
    .filter((login) => login !== pr.author)
    .find((login) => currentVerdict(input, login)?.state === "APPROVED");
  if (approver !== undefined) {
    return {
      state: "success",
      description: describe(`承認されました: ${approver}`),
      actions: [],
    };
  }
  const key = `approval:${pr.headSha}`;
  return {
    state: "pending",
    description: describe(`承認待ち: ${input.irreversible.join(", ")}`),
    actions: input.notified.includes(key)
      ? []
      : [
          {
            type: "notify",
            kind: "approval_request",
            key,
            reasons: input.irreversible,
          },
        ],
  };
}
