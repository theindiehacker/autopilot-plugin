import { type AutopilotConfig, LABELS } from "./types";

export interface SweepItem {
  kind: "issue" | "pr";
  number: number;
  title: string;
  url: string;
  labels: string[];
  /** autopilot:ready が最後に付いた時刻 */
  readyLabeledAt?: string;
  /** autopilot:ready が付いた回数 − 1 (呼び出し側が数える) */
  readyRetries: number;
  /** 開発の Draft PR ができた時刻 */
  startedAt?: string;
  hasPr: boolean;
  updatedAt: string;
  conflicting: boolean;
  /** PR の今の head (PR だけ) */
  headSha?: string;
  /** App のボットが書いた、起こす印 (PR だけ) */
  wakes: { at: string; headSha: string }[];
}

export type SweepAction =
  | { type: "relabelReady"; number: number }
  | { type: "needsHuman"; number: number; reason: string }
  | { type: "wake"; number: number; headSha: string; reason: string };

const elapsedMs = (from: string, now: Date) =>
  now.getTime() - new Date(from).getTime();

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
        reason: `${LABELS.ready} を付け直しましたが、${readyRetryMinutes} 分たっても起動しませんでした。`,
      };
    }
    if (
      item.startedAt !== undefined &&
      !item.hasPr &&
      elapsedMs(item.startedAt, now) > staleMs
    ) {
      return {
        type: "needsHuman",
        number: item.number,
        reason: `開始から ${staleHours} 時間以上、PR ができていません。`,
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
    return {
      type: "needsHuman",
      number: item.number,
      reason: `起こしても、${staleHours} 時間直りませんでした (${item.conflicting ? "コンフリクト" : "動きがありません"})`,
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
