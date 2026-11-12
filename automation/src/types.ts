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
  irreversible: { paths: string[]; terraformPlanArtifact?: string };
  approvers: string[];
  notify: { slackChannel: string; approverMentions: string[] };
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
  };
}

export const LABELS = {
  ready: "autopilot:ready",
  needsHuman: "needs-human",
} as const;

export const STATUS = { irreversible: "autopilot/irreversible" } as const;

export const MARKERS = {
  started: "<!-- autopilot:started -->",
  developing: "<!-- autopilot:developing -->",
  developed: "<!-- autopilot:developed -->",
  needsHuman: "<!-- autopilot:needs-human -->",
  fixRound: "<!-- autopilot:fix-round -->",
} as const;
