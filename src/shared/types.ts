export type Severity = 'P1' | 'P2' | 'P3';
export type ModStatus = 'on_watch' | 'available' | 'offline';
export type AiProvider = 'openai' | 'gemini';

export interface Claim {
  contentId: string;
  mod: string;
  claimedAt: number;
  incidentId: string | null;
  note: string;
}

export interface Incident {
  id: string;
  title: string;
  description: string;
  severity: Severity;
  declaredBy: string;
  declaredAt: number;
  closedAt: number | null;
  status: 'active' | 'closed';
  itemCount: number;
  aiSummary: string;
  postmortemUrl: string;
}

export interface PatternCluster {
  label: string;
  count: number;
  examples: string[];
}

export interface PatternRadarResult {
  generatedAt: number;
  clusters: PatternCluster[];
  anomalyScore: number;
  coordinatedSignals: string[];
  suggestedAutomods: string[];
}

export interface ModSchedule {
  timezone: string;
  activeHours: [number, number][];
  status: ModStatus;
  statusUpdatedAt: number;
}

export interface CoverageGaps {
  computedAt: number;
  gapHours: number[];
}

export interface WorkloadEntry {
  removals: number;
  approvals: number;
  bans: number;
  mutes: number;
  notes: number;
  total: number;
}

export interface AppConfig {
  aiProvider: AiProvider;
  aiApiKey: string;
  aiBaseUrl: string;
  aiModel: string;
  notifChannel: 'modmail' | 'pm';
  leadMod: string;
  p1Def: string;
  p2Def: string;
  p3Def: string;
  installedAt: number;
  version: string;
}
