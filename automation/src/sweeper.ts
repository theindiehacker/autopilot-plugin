import { type AutopilotConfig, LABELS } from "./types";

export interface SweepItem {
  kind: "issue" | "pr";
  number: number;
  title: string;
  url: string;
  labels: string[];
  /** 今の autopilot のラベルが付いた時刻 */
  stateLabeledAt: string;
  updatedAt: string;
  /** 見回りが autopilot:ready を付け直した回数 */
  readyRetries: number;
}

export type SweepAction =
  | { type: "relabelReady"; number: number }
  | { type: "needsHuman"; number: number; reason: string };

const WORKING_LABELS = [LABELS.doing, LABELS.qa, LABELS.fix];

function planItem(
  item: SweepItem,
  now: Date,
  config: AutopilotConfig,
): SweepAction | undefined {
  if (item.labels.includes(LABELS.needsHuman)) return undefined;
  const { readyRetryMinutes, staleHours } = config.limits;

  if (item.labels.includes(LABELS.ready)) {
    const waitedMs = now.getTime() - new Date(item.stateLabeledAt).getTime();
    if (waitedMs <= readyRetryMinutes * 60_000) return undefined;
    if (item.readyRetries === 0)
      return { type: "relabelReady", number: item.number };
    return {
      type: "needsHuman",
      number: item.number,
      reason: `${LABELS.ready} を付け直しましたが、${readyRetryMinutes} 分たっても起動しませんでした。`,
    };
  }

  if (WORKING_LABELS.some((label) => item.labels.includes(label))) {
    const idleMs = now.getTime() - new Date(item.updatedAt).getTime();
    if (idleMs <= staleHours * 3_600_000) return undefined;
    return {
      type: "needsHuman",
      number: item.number,
      reason: `${staleHours} 時間以上動きがありません。`,
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
