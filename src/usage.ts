import type {
  UsageBucket,
  UsageConfidenceBreakdown,
  UsageConfidenceGroup,
  UsageEvent,
  UsageEventCost,
  UsageEventView,
  UsageLedger,
  UsagePrice,
  UsageSchedule,
  UsageSummary,
  UsageTokenTotals,
  UsageWeekday,
} from "./types.js";

/** 估算假设标识（契约《成本核算规则》§3.3） */
export const USAGE_ASSUMPTION_IDS = {
  cachedInputFallbackToInput: "cached_input_price_fallback_to_input",
  reasoningFallbackToOutput: "reasoning_price_fallback_to_output",
} as const;

/** 金额精度：事件级 4 位小数，汇总 2 位小数（契约《成本核算规则》§3.4） */
export const EVENT_AMOUNT_DIGITS = 4;
export const BUCKET_AMOUNT_DIGITS = 2;

export function roundTo(value: number, digits: number): number {
  if (!Number.isFinite(value)) return value;
  return Number(value.toFixed(digits));
}

export interface NormalizedUsageEvent extends UsageEvent {
  usage: {
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    reasoningTokens: number;
  };
}

export interface NormalizedUsageLedger {
  schemaVersion: number;
  project?: string;
  prices: UsagePrice[];
  events: NormalizedUsageEvent[];
}

/** 账本规范化：prices 缺省为空数组，缓存/推理细分缺省为 0 */
export function normalizeLedger(ledger: UsageLedger): NormalizedUsageLedger {
  return {
    schemaVersion: ledger.schemaVersion,
    project: ledger.project,
    prices: [...(ledger.prices ?? [])],
    events: ledger.events.map((event) => ({
      ...event,
      usage: {
        inputTokens: event.usage.inputTokens,
        outputTokens: event.usage.outputTokens,
        cachedInputTokens: event.usage.cachedInputTokens ?? 0,
        reasoningTokens: event.usage.reasoningTokens ?? 0,
      },
    })),
  };
}

/** 价格有效期是否覆盖 occurredAt：effectiveFrom ≤ t < effectiveTo，effectiveTo 为空视为开放区间 */
export function priceWindowCovers(price: UsagePrice, occurredAt: string): boolean {
  const at = Date.parse(occurredAt);
  const from = Date.parse(price.effectiveFrom);
  if (Number.isNaN(at) || Number.isNaN(from) || at < from) return false;
  if (price.effectiveTo === undefined || price.effectiveTo === null) return true;
  const to = Date.parse(price.effectiveTo);
  return !Number.isNaN(to) && at < to;
}

/** 一周分钟数：位图索引空间 0..10079，周一 00:00 = 0（契约 §5 schedule） */
const WEEK_MINUTES = 7 * 24 * 60;

const WEEKDAY_INDEX: Record<UsageWeekday, number> = {
  mon: 0,
  tue: 1,
  wed: 2,
  thu: 3,
  fri: 4,
  sat: 5,
  sun: 6,
};

/** 无 schedule 的价格全时段生效：共享的全集位图（只读使用，调用方不得修改） */
const FULL_WEEK_MINUTES: Set<number> = new Set(
  Array.from({ length: WEEK_MINUTES }, (_, minute) => minute),
);

/** "HH:MM" → 当日分钟数（00:00–23:59）；非法格式返回 NaN */
export function parseWindowMinute(value: string): number {
  const matched = /^([01][0-9]|2[0-3]):([0-5][0-9])$/u.exec(value);
  if (matched === null) return Number.NaN;
  return Number(matched[1]) * 60 + Number(matched[2]);
}

const weekMinuteFormatters = new Map<string, Intl.DateTimeFormat>();

function weekMinuteFormatter(timezone: string): Intl.DateTimeFormat | undefined {
  const cached = weekMinuteFormatters.get(timezone);
  if (cached !== undefined) return cached;
  try {
    // hourCycle "h23" 保证小时为 00–23 两位；hour12:false 在某些 Node 版本会产出 "24"
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    weekMinuteFormatters.set(timezone, formatter);
    return formatter;
  } catch {
    // 无效时区由校验层报 USAGE_INVALID_SCHEDULE；匹配层视为不命中
    return undefined;
  }
}

/** occurredAt 按 timezone 换算的一周分钟索引（周一 00:00 = 0）；不可解析返回 NaN */
function localWeekMinute(occurredAt: string, timezone: string): number {
  const at = Date.parse(occurredAt);
  if (Number.isNaN(at)) return Number.NaN;
  const formatter = weekMinuteFormatter(timezone);
  if (formatter === undefined) return Number.NaN;
  const parts = formatter.formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((item) => item.type === type)?.value ?? "";
  const weekday = WEEKDAY_INDEX[part("weekday").toLowerCase() as UsageWeekday];
  const hour = Number(part("hour"));
  const minute = Number(part("minute"));
  if (weekday === undefined || !Number.isInteger(hour) || !Number.isInteger(minute)) {
    return Number.NaN;
  }
  return weekday * 1440 + hour * 60 + minute;
}

/**
 * schedule → 一周分钟位图（0..10079，周一 00:00 起；左闭右开分钟区间）。
 * negate=true 取补集；无 schedule = 全集。非法窗口（start ≥ end 或格式非法）跳过——
 * 结构合法性由校验层的 USAGE_INVALID_SCHEDULE 拦截，此处仅防御。
 */
export function scheduleWeekMinutes(schedule: UsageSchedule | undefined): Set<number> {
  if (schedule === undefined) return FULL_WEEK_MINUTES;
  const minutes = new Set<number>();
  for (const window of schedule.windows) {
    const start = parseWindowMinute(window.start);
    const end = parseWindowMinute(window.end);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start >= end) continue;
    for (const day of window.days) {
      const dayOffset = WEEKDAY_INDEX[day] * 1440;
      for (let minute = start; minute < end; minute += 1) minutes.add(dayOffset + minute);
    }
  }
  if (schedule.negate === true) {
    const complement = new Set<number>();
    for (let minute = 0; minute < WEEK_MINUTES; minute += 1) {
      if (!minutes.has(minute)) complement.add(minute);
    }
    return complement;
  }
  return minutes;
}

const weekBitmapCache = new WeakMap<UsagePrice, Set<number>>();

/** price 的一周分钟位图（按 price 对象身份缓存；无 schedule = 全集） */
export function priceWeekBitmap(price: UsagePrice): Set<number> {
  const cached = weekBitmapCache.get(price);
  if (cached !== undefined) return cached;
  const bitmap = scheduleWeekMinutes(price.schedule);
  weekBitmapCache.set(price, bitmap);
  return bitmap;
}

/** price 的周期时段是否覆盖 occurredAt（无 schedule = 全时段命中；时区无效或时间不可解析 = 不命中） */
export function scheduleCoversEvent(price: UsagePrice, occurredAt: string): boolean {
  if (price.schedule === undefined) return true;
  const minute = localWeekMinute(occurredAt, price.schedule.timezone);
  if (Number.isNaN(minute)) return false;
  return priceWeekBitmap(price).has(minute);
}

/** 四要素一致 + 周期时段命中（契约 §5 规则 5）：provider、modelId 一致、occurredAt 落在有效期内且命中 schedule 时段 */
export function priceMatchesEvent(
  price: UsagePrice,
  event: Pick<UsageEvent, "provider" | "modelId" | "occurredAt">,
): boolean {
  return (
    price.provider === event.provider &&
    price.modelId === event.modelId &&
    priceWindowCovers(price, event.occurredAt) &&
    scheduleCoversEvent(price, event.occurredAt)
  );
}

/** 按 (provider, modelId) 与发生时间自动匹配价格；被 supersededBy 取代的价格退出候选；多条命中取 effectiveFrom 最新者（重叠已被校验层拦截） */
export function findEffectivePrice(
  event: Pick<UsageEvent, "provider" | "modelId" | "occurredAt">,
  prices: UsagePrice[],
): UsagePrice | undefined {
  const candidates = prices.filter(
    (price) => price.supersededBy === undefined && priceMatchesEvent(price, event),
  );
  if (candidates.length === 0) return undefined;
  return candidates.reduce((latest, price) =>
    Date.parse(price.effectiveFrom) > Date.parse(latest.effectiveFrom) ? price : latest,
  );
}

export interface EstimatedEventCost {
  currency: string;
  amount: number;
  assumptions: string[];
}

/** 单事件估算金额（契约《成本核算规则》§3.2 公式 + §3.3 回退假设） */
export function estimateEventCost(
  event: NormalizedUsageEvent,
  price: UsagePrice,
): EstimatedEventCost {
  const unit = price.unitTokens;
  const input = event.usage.inputTokens;
  const output = event.usage.outputTokens;
  const cachedInput = event.usage.cachedInputTokens;
  const reasoning = event.usage.reasoningTokens;
  const assumptions: string[] = [];

  // §3.3：cachedInputPricePerUnit 缺失 → 缓存输入段按输入单价计价（发生回退时标注假设）
  const cachedInputPrice = price.cachedInputPricePerUnit ?? price.inputPricePerUnit;
  if (price.cachedInputPricePerUnit === undefined && cachedInput > 0) {
    assumptions.push(USAGE_ASSUMPTION_IDS.cachedInputFallbackToInput);
  }
  // §3.3：reasoningPricePerUnit 缺失 → 推理段按输出单价计价（发生回退时标注假设）
  const reasoningPrice = price.reasoningPricePerUnit ?? price.outputPricePerUnit;
  if (price.reasoningPricePerUnit === undefined && reasoning > 0) {
    assumptions.push(USAGE_ASSUMPTION_IDS.reasoningFallbackToOutput);
  }

  const amount =
    ((input - cachedInput) / unit) * price.inputPricePerUnit +
    (cachedInput / unit) * cachedInputPrice +
    ((output - reasoning) / unit) * price.outputPricePerUnit +
    (reasoning / unit) * reasoningPrice;

  return {
    currency: price.currency,
    amount: roundTo(amount, EVENT_AMOUNT_DIGITS),
    assumptions,
  };
}

function unknownCost(note?: string): UsageEventCost {
  return { state: "unknown", basis: "none", assumptions: [], note };
}

/**
 * 事件费用口径唯一性（契约 §6.5 优先级）：
 * 1. 事件带 cost → 以登记为准（缺 amount 按 unknown，不得当作 0）；
 * 2. 否则工具按价格版本与公式自动估算 → estimated；
 * 3. 否则 → unknown。
 * 自动估算路径上 confidence 为 unknown 的事件用量依据不足，费用记 unknown（契约 §14 T13）。
 */
export function resolveEventCost(
  event: NormalizedUsageEvent,
  prices: UsagePrice[],
): UsageEventCost {
  if (event.cost) {
    const cost = event.cost;
    if (cost.amount === undefined) {
      // 缺 amount 的登记记录按 unknown 处理，不得当作 0 元计入任何合计。
      return {
        ...unknownCost(cost.note),
        basis: "registered",
        currency: cost.currency,
        priceId: cost.priceId,
      };
    }
    return {
      state: cost.basis,
      basis: "registered",
      currency: cost.currency,
      amount: roundTo(cost.amount, EVENT_AMOUNT_DIGITS),
      priceId: cost.priceId,
      assumptions: [...(cost.assumptions ?? [])],
      note: cost.note,
    };
  }

  if (event.confidence === "unknown") {
    return unknownCost();
  }

  let price: UsagePrice | undefined;
  if (event.priceId !== undefined) {
    // 显式快照引用：不得静默按错配、过期或时段不符的价格估算；
    // superseded 不影响显式引用合法性（历史事件快照不受影响）。
    const referenced = prices.find((item) => item.id === event.priceId);
    price = referenced && priceMatchesEvent(referenced, event) ? referenced : undefined;
  } else {
    price = findEffectivePrice(event, prices);
  }
  if (!price) {
    return unknownCost();
  }

  const estimated = estimateEventCost(event, price);
  return {
    state: "estimated",
    basis: "computed",
    currency: estimated.currency,
    amount: estimated.amount,
    priceId: price.id,
    assumptions: estimated.assumptions,
  };
}

/** 事件级费用视图：CLI、服务、前端共用同一实现，保证任务明细与各级汇总数值一致 */
export function buildUsageEventViews(
  events: UsageEvent[],
  prices: UsagePrice[] = [],
): UsageEventView[] {
  const normalized = normalizeLedger({ schemaVersion: 1, events, prices });
  return normalized.events.map((event) => ({
    event,
    cost: resolveEventCost(event, normalized.prices),
  }));
}

function zeroTokens(): UsageTokenTotals {
  return { input: 0, output: 0, cachedInput: 0, reasoning: 0 };
}

function zeroConfidenceGroup(): UsageConfidenceGroup {
  return { eventCount: 0, tokens: zeroTokens() };
}

function zeroConfidenceBreakdown(): UsageConfidenceBreakdown {
  return {
    measured: zeroConfidenceGroup(),
    estimated: zeroConfidenceGroup(),
    unknown: zeroConfidenceGroup(),
  };
}

function addTokens(target: UsageTokenTotals, source: UsageTokenTotals): void {
  target.input += source.input;
  target.output += source.output;
  target.cachedInput += source.cachedInput;
  target.reasoning += source.reasoning;
}

function addCost(target: Record<string, number>, currency: string, amount: number): void {
  target[currency] = (target[currency] ?? 0) + amount;
}

function finalizeCost(source: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(source).map(([currency, amount]) => [
      currency,
      roundTo(amount, BUCKET_AMOUNT_DIGITS),
    ]),
  );
}

class BucketBuilder {
  private eventCount = 0;
  private readonly tasks = new Set<string>();
  private readonly models = new Set<string>();
  private readonly tokens = zeroTokens();
  private readonly confidence = zeroConfidenceBreakdown();
  private readonly costActual: Record<string, number> = {};
  private readonly costEstimated: Record<string, number> = {};
  private unknownCostEventCount = 0;
  private readonly assumptions = new Set<string>();

  add(view: UsageEventView): void {
    const { event, cost } = view;
    this.eventCount += 1;
    this.tasks.add(event.taskId);
    this.models.add(`${event.provider}/${event.modelId}`);
    addTokens(this.tokens, {
      input: event.usage.inputTokens,
      output: event.usage.outputTokens,
      cachedInput: event.usage.cachedInputTokens ?? 0,
      reasoning: event.usage.reasoningTokens ?? 0,
    });

    const group = this.confidence[event.confidence];
    group.eventCount += 1;
    addTokens(group.tokens, {
      input: event.usage.inputTokens,
      output: event.usage.outputTokens,
      cachedInput: event.usage.cachedInputTokens ?? 0,
      reasoning: event.usage.reasoningTokens ?? 0,
    });

    if (cost.state === "unknown" || cost.amount === undefined || cost.currency === undefined) {
      this.unknownCostEventCount += 1;
    } else if (cost.state === "actual") {
      addCost(this.costActual, cost.currency, cost.amount);
    } else {
      addCost(this.costEstimated, cost.currency, cost.amount);
    }

    for (const assumption of cost.assumptions) this.assumptions.add(assumption);
  }

  build(): UsageBucket {
    return {
      eventCount: this.eventCount,
      taskCount: this.tasks.size,
      modelCount: this.models.size,
      tokens: { ...this.tokens },
      confidence: {
        measured: { eventCount: this.confidence.measured.eventCount, tokens: { ...this.confidence.measured.tokens } },
        estimated: { eventCount: this.confidence.estimated.eventCount, tokens: { ...this.confidence.estimated.tokens } },
        unknown: { eventCount: this.confidence.unknown.eventCount, tokens: { ...this.confidence.unknown.tokens } },
      },
      costActual: finalizeCost(this.costActual),
      costEstimated: finalizeCost(this.costEstimated),
      unknownCostEventCount: this.unknownCostEventCount,
      assumptions: [...this.assumptions].sort((left, right) => left.localeCompare(right)),
    };
  }
}

/**
 * 五维汇总（契约 §10）。纯函数：任务明细、版本汇总、模型统计、整体统计由同一链路产出。
 * 汇总金额 = 各事件金额之和后按 2 位小数展示，不做事件级二次四舍五入。
 * taskId 不在 releaseByTask 中的悬空事件不进入汇总（校验层已拦截，此处仅为防御）。
 */
export function summarizeUsage(
  views: UsageEventView[],
  releaseByTask: Map<string, string>,
): UsageSummary {
  const totals = new BucketBuilder();
  const byTask = new Map<string, BucketBuilder>();
  const byRelease = new Map<string, BucketBuilder>();
  const byModel = new Map<string, BucketBuilder>();
  const byProvider = new Map<string, BucketBuilder>();
  const byRole = new Map<string, BucketBuilder>();

  for (const view of views) {
    const { event } = view;
    const releaseId = releaseByTask.get(event.taskId);
    if (releaseId === undefined) continue;

    const task = byTask.get(event.taskId) ?? new BucketBuilder();
    const release = byRelease.get(releaseId) ?? new BucketBuilder();
    const model = byModel.get(`${event.provider}/${event.modelId}`) ?? new BucketBuilder();
    const provider = byProvider.get(event.provider) ?? new BucketBuilder();
    const role = byRole.get(event.role) ?? new BucketBuilder();
    for (const builder of [totals, task, release, model, provider, role]) builder.add(view);
    byTask.set(event.taskId, task);
    byRelease.set(releaseId, release);
    byModel.set(`${event.provider}/${event.modelId}`, model);
    byProvider.set(event.provider, provider);
    byRole.set(event.role, role);
  }

  const build = (builders: Map<string, BucketBuilder>): Record<string, UsageBucket> =>
    Object.fromEntries([...builders.entries()].map(([key, builder]) => [key, builder.build()]));
  return {
    totals: totals.build(),
    byTask: build(byTask),
    byRelease: build(byRelease),
    byModel: build(byModel),
    byProvider: build(byProvider),
    byRole: build(byRole),
  };
}

/** 便捷入口：由账本原始 events/prices 直接产出汇总 */
export function buildUsageSummary(
  events: UsageEvent[],
  prices: UsagePrice[],
  releaseByTask: Map<string, string>,
): UsageSummary {
  return summarizeUsage(buildUsageEventViews(events, prices), releaseByTask);
}

/** 低可信（estimated + unknown）事件占比，供统计口径说明展示 */
export function lowConfidenceRatio(bucket: UsageBucket): number {
  if (bucket.eventCount === 0) return 0;
  const low = bucket.confidence.estimated.eventCount + bucket.confidence.unknown.eventCount;
  return low / bucket.eventCount;
}
