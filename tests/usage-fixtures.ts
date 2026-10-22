import type { Roadmap, UsageEvent, UsageLedger, UsagePrice, UsageTokenUsage } from "../src/types";

/**
 * 用量测试夹具（构造值，非真实消耗）：
 * - alpha/model-a 有 2026-10 与 2026-11 两个价格版本（费率变化只增不改）；
 * - beta/model-b 为 USD 计价、unitTokens=1000，且未声明缓存/推理单价；
 * - alpha/model-fallback 未声明缓存/推理单价（用于回退假设）；
 * - gamma/model-c 无任何价格。
 */
export const PRICES: UsagePrice[] = [
  {
    id: "p-a-oct",
    provider: "alpha",
    modelId: "model-a",
    currency: "CNY",
    unitTokens: 1000000,
    inputPricePerUnit: 2,
    cachedInputPricePerUnit: 0.5,
    outputPricePerUnit: 8,
    reasoningPricePerUnit: 8,
    effectiveFrom: "2026-10-01T00:00:00+08:00",
    effectiveTo: "2026-11-01T00:00:00+08:00",
    basis: "定价页快照 2026-10",
  },
  {
    id: "p-a-nov",
    provider: "alpha",
    modelId: "model-a",
    currency: "CNY",
    unitTokens: 1000000,
    inputPricePerUnit: 1.5,
    cachedInputPricePerUnit: 0.4,
    outputPricePerUnit: 6,
    reasoningPricePerUnit: 6,
    effectiveFrom: "2026-11-01T00:00:00+08:00",
    effectiveTo: null,
    basis: "定价页快照 2026-11",
  },
  {
    id: "p-b-usd",
    provider: "beta",
    modelId: "model-b",
    currency: "USD",
    unitTokens: 1000,
    inputPricePerUnit: 0.01,
    outputPricePerUnit: 0.03,
    effectiveFrom: "2026-01-01T00:00:00Z",
    effectiveTo: null,
    basis: "供应商文档",
  },
  {
    id: "p-fallback",
    provider: "alpha",
    modelId: "model-fallback",
    currency: "CNY",
    unitTokens: 1000000,
    inputPricePerUnit: 2,
    outputPricePerUnit: 8,
    effectiveFrom: "2026-10-01T00:00:00+08:00",
    effectiveTo: null,
    basis: "仅声明输入/输出单价",
  },
];

export function event(
  id: string,
  taskId: string,
  overrides: Partial<UsageEvent> & { usage: UsageTokenUsage },
): UsageEvent {
  return {
    id,
    taskId,
    occurredAt: "2026-10-10T09:30:00+08:00",
    provider: "alpha",
    modelId: "model-a",
    role: "开发执行",
    source: "manual",
    confidence: "measured",
    ...overrides,
  };
}

export const EVENTS: UsageEvent[] = [
  // 显式绑定 10 月价格快照；带缓存与推理细分
  event("evt-001", "T1", {
    occurredAt: "2026-10-10T09:30:00+08:00",
    source: "runtime_log",
    usage: { inputTokens: 12000, outputTokens: 3000, cachedInputTokens: 8000, reasoningTokens: 1200 },
    priceId: "p-a-oct",
  }),
  // 登记实际费用（供应商账单）
  event("evt-002", "T1", {
    occurredAt: "2026-10-11T14:00:00+08:00",
    role: "独立验收",
    confidence: "estimated",
    usage: { inputTokens: 5000, outputTokens: 1500 },
    cost: { basis: "actual", currency: "CNY", amount: 0.021, note: "供应商账单" },
  }),
  // USD 自动匹配计价
  event("evt-003", "T2", {
    occurredAt: "2026-10-12T10:00:00+08:00",
    provider: "beta",
    modelId: "model-b",
    role: "主控协调",
    usage: { inputTokens: 900, outputTokens: 400 },
  }),
  // 同一模型 11 月费率（价格版本历史可复核）
  event("evt-004", "T2", {
    occurredAt: "2026-11-05T10:00:00+08:00",
    source: "provider",
    usage: { inputTokens: 20000, outputTokens: 4000, cachedInputTokens: 4000, reasoningTokens: 1000 },
  }),
  // 缺缓存/推理单价 → 回退假设
  event("evt-005", "T3", {
    occurredAt: "2026-10-15T10:00:00+08:00",
    provider: "alpha",
    modelId: "model-fallback",
    role: "返工",
    source: "estimate",
    confidence: "estimated",
    usage: { inputTokens: 10000, outputTokens: 2000, cachedInputTokens: 4000, reasoningTokens: 1000 },
  }),
  // 无价格、无费用、可信度未知
  event("evt-006", "T3", {
    occurredAt: "2026-10-16T10:00:00+08:00",
    provider: "gamma",
    modelId: "model-c",
    confidence: "unknown",
    usage: { inputTokens: 700, outputTokens: 300 },
  }),
  // 登记的估算费用（含自报假设）
  event("evt-007", "T3", {
    occurredAt: "2026-10-17T10:00:00+08:00",
    role: "独立验收",
    usage: { inputTokens: 1000, outputTokens: 500 },
    cost: { basis: "estimated", currency: "CNY", amount: 0.008, assumptions: ["manual-rounding"] },
  }),
  // 登记费用缺 amount → unknown，不得当作 0
  event("evt-008", "T1", {
    occurredAt: "2026-10-18T10:00:00+08:00",
    usage: { inputTokens: 100, outputTokens: 50 },
    cost: { basis: "actual", currency: "CNY" },
  }),
  // 登记实际费用（USD，带计价依据引用）
  event("evt-009", "T2", {
    occurredAt: "2026-10-19T10:00:00+08:00",
    provider: "beta",
    modelId: "model-b",
    role: "主控协调",
    usage: { inputTokens: 2000, outputTokens: 1000 },
    cost: { basis: "actual", currency: "USD", amount: 0.05, priceId: "p-b-usd" },
  }),
  event("evt-010", "T1", {
    occurredAt: "2026-10-20T10:00:00+08:00",
    provider: "beta",
    modelId: "model-b",
    role: "返工",
    usage: { inputTokens: 300, outputTokens: 100 },
  }),
  // 可信度未知但存在可用价格 → 费用仍记 unknown（T13 第三种情况）
  event("evt-011", "T3", {
    occurredAt: "2026-10-21T10:00:00+08:00",
    provider: "beta",
    modelId: "model-b",
    role: "独立验收",
    confidence: "unknown",
    usage: { inputTokens: 400, outputTokens: 200 },
  }),
];

export const LEDGER: UsageLedger = {
  schemaVersion: 1,
  project: "usage-demo",
  prices: PRICES,
  events: EVENTS,
};

export const RELEASE_BY_TASK = new Map([
  ["T1", "v1"],
  ["T2", "v2"],
  ["T3", "v1"],
]);

export function usageRoadmap(): Roadmap {
  return {
    schemaVersion: 1,
    project: { id: "usage-demo", name: "用量演示项目" },
    releases: [
      { id: "v1", name: "第一版本", status: "in_progress" },
      { id: "v2", name: "第二版本", status: "in_progress" },
    ],
    requirements: [
      {
        id: "T1",
        title: "任务一",
        releaseId: "v1",
        status: "in_progress",
        dependsOn: [],
        acceptance: [],
        evidence: [],
      },
      {
        id: "T2",
        title: "任务二",
        releaseId: "v2",
        status: "in_progress",
        dependsOn: [],
        acceptance: [],
        evidence: [],
      },
      {
        id: "T3",
        title: "任务三",
        releaseId: "v1",
        status: "done",
        dependsOn: [],
        acceptance: [],
        evidence: [],
      },
    ],
  };
}
