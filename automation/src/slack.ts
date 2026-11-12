import type { AutopilotConfig } from "./types";

export type NotificationKind =
  | "approval_request"
  | "needs_human"
  | "deploy_hold"
  | "deploy_rolled_back"
  | "done";

export interface Notification {
  kind: NotificationKind;
  title: string;
  url: string;
  details: string[];
  links?: { label: string; url: string }[];
}

const HEADLINES: Record<NotificationKind, string> = {
  approval_request: ":raised_hand: 承認をお願いします",
  needs_human: ":warning: 人の判断が必要です",
  deploy_hold:
    ":rotating_light: 取り消せない変更を含むデプロイの確認に失敗しました (ロールバックしていません)",
  deploy_rolled_back:
    ":rewind: デプロイ後の確認に失敗したため、ロールバックしました",
  done: ":white_check_mark: 対応が終わりました",
};

const MENTION_KINDS: NotificationKind[] = ["approval_request", "deploy_hold"];

// Slack mrkdwn では & < > だけエスケープすればよい。<!channel> のような一斉メンションを防ぐ。
function escapeSlack(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function formatSlackMessage(
  n: Notification,
  config: AutopilotConfig,
): { text: string } {
  const lines = [`${HEADLINES[n.kind]}: <${n.url}|${escapeSlack(n.title)}>`];
  for (const d of n.details) lines.push(escapeSlack(d));
  for (const l of n.links ?? [])
    lines.push(`<${l.url}|${escapeSlack(l.label)}>`);
  const mentions = config.notify.approverMentions;
  if (MENTION_KINDS.includes(n.kind) && mentions.length > 0)
    lines.push(mentions.join(" "));
  return { text: lines.join("\n") };
}

// webhookUrl は秘密なので、ログにもエラーにも出さない。
export async function sendSlack(
  webhookUrl: string,
  message: { text: string },
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const res = await fetchImpl(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(message),
  });
  if (!res.ok)
    throw new Error(`Slack への送信に失敗しました: HTTP ${res.status}`);
}
