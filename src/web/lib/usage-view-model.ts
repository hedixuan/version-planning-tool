import type {
  Roadmap,
  UsageApiPayload,
  UsageBucket,
  UsageConfidence,
  UsageCostState,
  UsageEventView,
  UsageLedger,
  UsageSource,
  UsageSummary,
} from "../../types";
import { buildUsageEventViews, lowConfidenceRatio, summarizeUsage } from "../../usage";

export interface UsageContext {
  ledger: UsageLedger;
  views: UsageEventView[];
  releaseByTask: Map<string, string>;
  /** 全量汇总（无筛选口径），与只读 API 返回的 summary 同源 */
  summary: UsageSummary;
}

/** 由消费项目数据构建用量上下文：与 CLI、服务共用 src/usage.ts 同一纯函数链路 */
export function createUsageContext(roadmap: Roadmap, usage: UsageApiPayload): UsageContext {
  const releaseByTask = new Map(roadmap.requirements.map((item) => [item.id, item.releaseId]));
  const views = buildUsageEventViews(usage.ledger.events, usage.ledger.prices ?? []);
  return {
    ledger: usage.ledger,
    views,
    releaseByTask,
    summary: summarizeUsage(views, releaseByTask),
  };
}

/** 筛选集合的汇总（口径与整体一致，契约《成本核算规则》§6.5） */
export function scopeUsageSummary(context: UsageContext, taskIds: Set<string>): UsageSummary {
  return summarizeUsage(
    context.views.filter((view) => taskIds.has(view.event.taskId)),
    context.releaseByTask,
  );
}

export function taskEventViews(context: UsageContext, taskId: string): UsageEventView[] {
  return context.views.filter((view) => view.event.taskId === taskId);
}

export const CONFIDENCE_LABELS: Record<UsageConfidence, string> = {
  measured: "实测",
  estimated: "估算",
  unknown: "未知",
};

export const SOURCE_LABELS: Record<UsageSource, string> = {
  provider: "供应商返回",
  runtime_log: "运行日志",
  manual: "人工登记",
  estimate: "估算",
};

export const COST_STATE_LABELS: Record<UsageCostState, string> = {
  actual: "实际费用",
  estimated: "估算费用",
  unknown: "未知费用",
};

export const COST_BASIS_LABELS: Record<"registered" | "computed" | "none", string> = {
  registered: "登记费用",
  computed: "工具估算",
  none: "无依据",
};

export const ASSUMPTION_LABELS: Record<string, string> = {
  cached_input_price_fallback_to_input: "缓存输入单价缺失，已按输入单价计价",
  reasoning_price_fallback_to_output: "推理单价缺失，已按输出单价计价",
};

export function assumptionLabel(id: string): string {
  return ASSUMPTION_LABELS[id] ?? id;
}

export function formatTokens(value: number): string {
  return value.toLocaleString("zh-CN");
}

export function formatAmount(amount: number, digits = 2): string {
  return amount.toFixed(digits);
}

/** 按币种分列展示，不同币种不相加；无金额返回占位符 */
export function formatCosts(costs: Record<string, number>, digits = 2): string {
  const entries = Object.entries(costs);
  if (entries.length === 0) return "—";
  return entries
    .map(([currency, amount]) => `${currency} ${amount.toFixed(digits)}`)
    .join(" · ");
}

/** 低可信（estimated + unknown）事件占比，供统计口径说明展示 */
export function formatLowConfidenceRatio(bucket: UsageBucket): string {
  if (bucket.eventCount === 0) return "0%";
  return `${Math.round(lowConfidenceRatio(bucket) * 100)}%`;
}

export function formatEventCost(view: UsageEventView): string {
  const { cost } = view;
  if (cost.state === "unknown" || cost.amount === undefined || cost.currency === undefined) {
    return "未知费用";
  }
  return `${cost.currency} ${cost.amount.toFixed(4)}`;
}

export function formatEventTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).format(date);
}
