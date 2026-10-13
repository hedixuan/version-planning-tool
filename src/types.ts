export const STATUSES = [
  "backlog",
  "ready",
  "in_progress",
  "blocked",
  "review",
  "done",
  "cancelled",
] as const;

export type Status = (typeof STATUSES)[number];

export interface ProjectInfo {
  id: string;
  name: string;
  description?: string;
}

export interface Release {
  id: string;
  name: string;
  goal?: string;
  status: Status;
  phases?: string[];
  exitCriteria?: string[];
}

export interface Requirement {
  id: string;
  title: string;
  releaseId: string;
  status: Status;
  type?: string;
  priority?: string;
  owner?: string | null;
  dependsOn: string[];
  acceptance: string[];
  evidence: string[];
  sourcePath?: string;
  tags?: string[];
  updatedAt?: string;
}

export interface Roadmap {
  schemaVersion: number;
  project: ProjectInfo;
  updatedAt?: string;
  releases: Release[];
  requirements: Requirement[];
}

export interface VersionPlanConfig {
  dataFile: string;
  schemaFile?: string;
}

export type DiagnosticCode =
  | "CONFIG_INVALID"
  | "SCHEMA_INVALID"
  | "EXTENSION_SCHEMA_INVALID"
  | "DUPLICATE_RELEASE_ID"
  | "DUPLICATE_REQUIREMENT_ID"
  | "UNKNOWN_RELEASE"
  | "BROKEN_DEPENDENCY"
  | "CYCLIC_DEPENDENCY"
  | "RELEASE_STATUS_MISMATCH";

export interface Diagnostic {
  code: DiagnosticCode;
  message: string;
  path?: string;
}

export interface ValidationResult {
  valid: boolean;
  data?: Roadmap;
  diagnostics: Diagnostic[];
}

export interface RoadmapView {
  roadmap: Roadmap;
  requirementsByRelease: Record<string, Requirement[]>;
  requirementsByStatus: Record<Status, Requirement[]>;
}
