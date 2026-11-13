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
}

export type SweepAction =
  | { type: "relabelReady"; number: number }
  | { type: "needsHuman"; number: number; reason: string }
  | { type: "wake"; number: number; headSha: string; reason: string };

const elapsedMs = (from: string, now: Date) =>
  now.getTime() - new Date(from).getTime();

/** needs-human のコメントで、理由の次の行に書く、人がすること。where は「Issue #<n> の 」など */
const nextStep = (where = "") =>
  `直してから、${where}${LABELS.needsHuman} を外して ${LABELS.ready} を付け直してください。`;

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
        reason: `${LABELS.ready} を付け直しましたが、${readyRetryMinutes} 分たっても起動しませんでした。\n${nextStep()}`,
      };
    }
    return undefined;
  }

  const stale = elapsedMs(item.updatedAt, now) > staleMs;
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
    const where =
      item.issueNumber === undefined
        ? "Issue の "
        : `Issue #${item.issueNumber} の `;
    return {
      type: "needsHuman",
      number: item.number,
      reason: `起こしても、${staleHours} 時間直りませんでした (${item.conflicting ? "コンフリクト" : "動きがありません"})\n${nextStep(where)}`,
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
