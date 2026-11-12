export type DeployMode = "none" | "on_merge" | "dispatch";

export interface RequiredCheck {
  name: string;
  paths?: string[];
}

export interface AutopilotConfig {
  routineGithubUser: string;
  qa: { start?: string; url?: string };
  review: {
    reviewer: string;
    trigger: "ready_for_review" | "comment" | "none";
    command?: string;
  };
  requiredChecks: RequiredCheck[];
  notify: { slackChannel: string };
  limits: {
    maxFixRounds: number;
    staleHours: number;
    readyRetryMinutes: number;
  };
  deploy: {
    mode: DeployMode;
    workflow?: string;
    inputs: Record<string, string>;
    environments: string[];
    verify?: string;
    rollback?: string;
    timeoutMinutes: number;
    rollbackAfterIrreversible: boolean;
    /** マージした PR がこの glob に合うファイルを変えていたら、取り消せない変更を含む */
    irreversiblePaths: string[];
  };
}

export const LABELS = {
  ready: "autopilot:ready",
  needsHuman: "needs-human",
} as const;

export const MARKERS = {
  started: "<!-- autopilot:started -->",
  developing: "<!-- autopilot:developing -->",
  needsHuman: "<!-- autopilot:needs-human -->",
  fixRound: "<!-- autopilot:fix-round -->",
} as const;
