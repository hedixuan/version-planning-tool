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
  usageFile?: string;
}

/** 用量来源：provider=供应商返回，runtime_log=运行日志，manual=人工登记，estimate=估算 */
export type UsageSource = "provider" | "runtime_log" | "manual" | "estimate";

/** 可信状态：measured=实际记录，estimated=估算，unknown=未知 */
export type UsageConfidence = "measured" | "estimated" | "unknown";

/** 登记费用的依据类型：actual=供应商账单等实际费用，estimated=登记者自行估算 */
export type UsageCostBasis = "actual" | "estimated";

/** 事件费用三态（契约 §6.5：登记 cost > 工具估算 > unknown，互斥不重复计费） */
export type UsageCostState = "actual" | "estimated" | "unknown";

export interface UsageTokenUsage {
  inputTokens: number;
  outputTokens: number;
  /** inputTokens 的细分项（缓存命中部分已包含在输入总量内） */
  cachedInputTokens?: number;
  /** outputTokens 的细分项（推理产出已包含在输出总量内） */
  reasoningTokens?: number;
}

export interface UsageCostRecord {
  basis: UsageCostBasis;
  currency: string;
  /** 缺 amount 时汇总按 unknown 处理，不得当作 0 */
  amount?: number;
  /** 登记费用的计价依据引用（审计锚点） */
  priceId?: string;
  note?: string;
  assumptions?: string[];
}

export interface UsageEvent {
  id: string;
  taskId: string;
  occurredAt: string;
  provider: string;
  modelId: string;
  agent?: string | null;
  role: string;
  source: UsageSource;
  confidence: UsageConfidence;
  usage: UsageTokenUsage;
  /** 估算快照引用：事件无 cost 时固定自动估算所用的价格版本 */
  priceId?: string;
  cost?: UsageCostRecord;
  note?: string;
}

export interface UsagePrice {
  id: string;
  provider: string;
  modelId: string;
  currency: string;
  unitTokens: number;
  inputPricePerUnit: number;
  cachedInputPricePerUnit?: number;
  outputPricePerUnit: number;
  reasoningPricePerUnit?: number;
  effectiveFrom: string;
  /** null 或缺失表示至今有效（开放区间） */
  effectiveTo?: string | null;
  basis: string;
  note?: string;
}

export interface UsageLedger {
  schemaVersion: number;
  project?: string;
  prices?: UsagePrice[];
  events: UsageEvent[];
}

/** Token 口径：input/output 为总量，cachedInput/reasoning 为细分，不再计入总量 */
export interface UsageTokenTotals {
  input: number;
  output: number;
  cachedInput: number;
  reasoning: number;
}

/** confidence 三组之一的分组视图（与总量是分组关系，不再相加） */
export interface UsageConfidenceGroup {
  eventCount: number;
  tokens: UsageTokenTotals;
}

export interface UsageConfidenceBreakdown {
  measured: UsageConfidenceGroup;
  estimated: UsageConfidenceGroup;
  unknown: UsageConfidenceGroup;
}

export interface UsageBucket {
  eventCount: number;
  taskCount: number;
  modelCount: number;
  tokens: UsageTokenTotals;
  confidence: UsageConfidenceBreakdown;
  /** 实际费用，按币种分列，不同币种不相加 */
  costActual: Record<string, number>;
  /** 估算费用，按币种分列 */
  costEstimated: Record<string, number>;
  /** 费用未知的事件计数（不是 0 元） */
  unknownCostEventCount: number;
  /** 该桶涉及的全部估算假设标识 */
  assumptions: string[];
}

export interface UsageSummary {
  totals: UsageBucket;
  byTask: Record<string, UsageBucket>;
  byRelease: Record<string, UsageBucket>;
  byModel: Record<string, UsageBucket>;
  byProvider: Record<string, UsageBucket>;
  byRole: Record<string, UsageBucket>;
}

/** 事件级费用解析结果（CLI、服务、前端共用同一纯函数产出） */
export interface UsageEventCost {
  state: UsageCostState;
  /** registered=登记费用，computed=工具估算，none=无依据 */
  basis: "registered" | "computed" | "none";
  currency?: string;
  /** 事件级金额四舍五入到 4 位小数 */
  amount?: number;
  priceId?: string;
  assumptions: string[];
  note?: string;
}

export interface UsageEventView {
  event: UsageEvent;
  cost: UsageEventCost;
}

/** 只读 API 的 usage 载荷（契约 §10） */
export interface UsageApiPayload {
  enabled: true;
  ledger: UsageLedger;
  summary: UsageSummary;
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
  | "RELEASE_STATUS_MISMATCH"
  | "USAGE_SCHEMA_INVALID"
  | "USAGE_FILE_INVALID"
  | "USAGE_DUPLICATE_EVENT_ID"
  | "USAGE_DUPLICATE_PRICE_ID"
  | "USAGE_UNKNOWN_TASK"
  | "USAGE_UNKNOWN_PRICE"
  | "USAGE_PRICE_MODEL_MISMATCH"
  | "USAGE_PRICE_NOT_EFFECTIVE"
  | "USAGE_PRICE_REF_CONFLICT"
  | "USAGE_CURRENCY_MISMATCH"
  | "USAGE_TOKEN_SUBTOTAL_EXCEEDED"
  | "USAGE_INVALID_PRICE_WINDOW"
  | "USAGE_OVERLAPPING_PRICE"
  | "USAGE_PROJECT_MISMATCH";

export interface Diagnostic {
  code: DiagnosticCode;
  message: string;
  path?: string;
}

export interface ValidationResult {
  valid: boolean;
  data?: Roadmap;
  diagnostics: Diagnostic[];
  /** 未配置 usageFile 为 null；配置但校验失败为 null 且 diagnostics 含用量诊断 */
  usage: UsageApiPayload | null;
}

export interface RoadmapView {
  roadmap: Roadmap;
  requirementsByRelease: Record<string, Requirement[]>;
  requirementsByStatus: Record<Status, Requirement[]>;
}
