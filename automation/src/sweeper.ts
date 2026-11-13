import { type AutopilotConfig, LABELS } from "./types";

export interface SweepItem {
  kind: "issue" | "pr";
  number: number;
  title: string;
  url: string;
  labels: string[];
  /** autopilot:ready が最後に付いた時刻 */
  readyLabeledAt?: string;
  /** needs-human が最後に外された後に、autopilot:ready が付いた回数 − 1 (呼び出し側が数える) */
  readyRetries: number;
  /** 開発が始まったと分かる時刻 (ラベルより後に作られたか更新された、開発の PR の updated_at) */
  startedAt?: string;
  updatedAt: string;
  conflicting: boolean;
  /** PR の今の head (PR だけ) */
  headSha?: string;
  /** ブランチ名 autopilot/<n>- の Issue の番号 (PR だけ。読めなければ無し) */
  issueNumber?: number;
  /** App のボットが書いた、起こす印 (PR だけ) */
  wakes: { at: string; headSha: string }[];
  /** 人 (CODEOWNERS の持ち主など) にレビューを頼んでいて、まだ届いていない (PR だけ。requested_reviewers か requested_teams がある) */
  reviewRequested?: boolean;
}

export type SweepAction =
  | { type: "relabelReady"; number: number }
  | { type: "needsHuman"; number: number; reason: string }
  | { type: "wake"; number: number; headSha: string; reason: string };

const elapsedMs = (from: string, now: Date) =>
  now.getTime() - new Date(from).getTime();

// needs-human のコメントで、理由の次の行に書く、人がすること。
// autopilot:ready は、付いたままでは起動しない (起動は issues.labeled だけ)。一度外してから付け直してもらう
const issueNextStep = `直してから、${LABELS.needsHuman} を外してください。続けて、${LABELS.ready} を一度外してから、付け直してください。`;
// 見回りは、PR にだけ needs-human を付ける。PR の needs-human は、再開した開発のルーティンが外す
const pullNextStep = (issueNumber?: number) =>
  `続けるときは、Issue${issueNumber === undefined ? "" : ` #${issueNumber}`} の ${LABELS.ready} を一度外してから、付け直してください。PR の ${LABELS.needsHuman} は、再開した開発のルーティンが外します。`;

function planItem(
  item: SweepItem,
  now: Date,
  config: AutopilotConfig,
): SweepAction | undefined {
  if (item.labels.includes(LABELS.needsHuman)) return undefined;
  const { readyRetryMinutes, staleHours } = config.limits;
  const staleMs = staleHours * 3_600_000;

  if (item.kind === "issue") {
    if (
      item.labels.includes(LABELS.ready) &&
      item.startedAt === undefined &&
      item.readyLabeledAt !== undefined &&
      elapsedMs(item.readyLabeledAt, now) > readyRetryMinutes * 60_000
    ) {
      if (item.readyRetries === 0)
        return { type: "relabelReady", number: item.number };
      return {
        type: "needsHuman",
        number: item.number,
        reason: `${LABELS.ready} を付け直しましたが、${readyRetryMinutes} 分たっても起動しませんでした。\n${issueNextStep}`,
      };
    }
    return undefined;
  }

  // 人のレビュー (CODEOWNERS の持ち主の Approve など) を待っている PR は、動きが無くても困りごとにしない。
  // 起こしても直すことが無く、needs-human にすると、持ち主の Approve でマージされなくなるため。コンフリクトは起こす
  const stale =
    elapsedMs(item.updatedAt, now) > staleMs && item.reviewRequested !== true;
  if (!item.conflicting && !stale) return undefined;
  const headSha = item.headSha ?? "";
  const lastWake = item.wakes
    .filter((w) => w.headSha === headSha)
    .map((w) => w.at)
    .sort((a, b) => Date.parse(a) - Date.parse(b))
    .at(-1);
  if (lastWake === undefined) {
    return {
      type: "wake",
      number: item.number,
      headSha,
      reason: item.conflicting
        ? "コンフリクトがあります (デフォルトブランチを取り込んでください)"
        : `${staleHours} 時間動きがありません`,
    };
  }
  if (elapsedMs(lastWake, now) > staleMs) {
    return {
      type: "needsHuman",
      number: item.number,
      reason: `起こしても、${staleHours} 時間直りませんでした (${item.conflicting ? "コンフリクト" : "動きがありません"})\n${pullNextStep(item.issueNumber)}`,
    };
  }
  return undefined;
}

export function planSweep(
  items: SweepItem[],
  now: Date,
  config: AutopilotConfig,
): SweepAction[] {
  const actions: SweepAction[] = [];
  for (const item of items) {
    const action = planItem(item, now, config);
    if (action) actions.push(action);
  }
  return actions;
}
