export interface RequiredCheck {
  name: string;
  paths?: string[];
}

export interface AutopilotConfig {
  qa: { start?: string; url?: string };
  review: {
    reviewer: string;
    trigger: "ready_for_review" | "comment" | "none";
    command?: string;
  };
  requiredChecks: RequiredCheck[];
  limits: {
    maxFixRounds: number;
    staleHours: number;
    readyRetryMinutes: number;
  };
}

export const LABELS = {
  ready: "autopilot:ready",
  needsHuman: "needs-human",
} as const;

export const MARKERS = {
  needsHuman: "<!-- autopilot:needs-human -->",
  wake: "<!-- autopilot:wake -->",
} as const;

export const headMarker = (sha: string) => `<!-- autopilot:head ${sha} -->`;
