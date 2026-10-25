import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateProject, validateUsageSemantics } from "../src/validation";
import {
  buildUsageEventViews,
  buildUsageSummary,
  findEffectivePrice,
  parseWindowMinute,
  priceMatchesEvent,
  scheduleWeekMinutes,
} from "../src/usage";
import type {
  DiagnosticCode,
  Roadmap,
  UsageEvent,
  UsageLedger,
  UsagePrice,
  UsageScheduleWindow,
} from "../src/types";
import { event, usageRoadmap } from "./usage-fixtures";

/**
 * P3-28 价格周期时段（schedule 与 supersededBy）测试。
 * 锚点 fixture 复刻 2026-10-24 真实事件与 DeepSeek 双档单价（空闲 0.02/1/4、高峰 0.04/2/8 元/M），
 * 断言双档登记后金额复算与合并前一致（deepseek 10.72 / zhipu 1.10 / stepfun 0.13 / totals 11.95）。
 */

const temporaryPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryPaths.splice(0).map((target) => rm(target, { recursive: true, force: true })),
  );
});

const TZ = "Asia/Shanghai";

/** DeepSeek 官方高峰窗口：北京时间周一至周五 9:00-12:00、14:00-18:00 */
const PEAK_WINDOWS: UsageScheduleWindow[] = [
  { days: ["mon", "tue", "wed", "thu", "fri"], start: "09:00", end: "12:00" },
  { days: ["mon", "tue", "wed", "thu", "fri"], start: "14:00", end: "18:00" },
];

const ANCHOR_FROM = "2026-10-24T00:00:00+08:00";
/** 空闲档单价（元/百万 token）：缓存命中 0.02 / 未命中 1 / 输出 4 */
const IDLE_UNIT = {
  inputPricePerUnit: 1,
  cachedInputPricePerUnit: 0.02,
  outputPricePerUnit: 4,
  reasoningPricePerUnit: 4,
};
/** 高峰档单价（元/百万 token）：缓存命中 0.04 / 未命中 2 / 输出 8 */
const PEAK_UNIT = {
  inputPricePerUnit: 2,
  cachedInputPricePerUnit: 0.04,
  outputPricePerUnit: 8,
  reasoningPricePerUnit: 8,
};

function schedulePrice(
  overrides: Partial<UsagePrice> & Pick<UsagePrice, "id">,
): UsagePrice {
  return {
    provider: "alpha",
    modelId: "model-sched",
    currency: "CNY",
    unitTokens: 1000000,
    inputPricePerUnit: 1,
    outputPricePerUnit: 4,
    effectiveFrom: "2026-10-01T00:00:00+08:00",
    effectiveTo: null,
    basis: "测试数据：构造分时单价，无真实账单依据",
    ...overrides,
  };
}

/** 高峰正向档：工作日 09:00-12:00、14:00-18:00 生效 */
const PEAK = schedulePrice({
  id: "p-sched-peak",
  inputPricePerUnit: 2,
  outputPricePerUnit: 8,
  schedule: { timezone: TZ, windows: PEAK_WINDOWS },
});

/** 空闲档：与高峰档同 windows + negate（windows 之外生效，即高峰补集） */
const IDLE = schedulePrice({
  id: "p-sched-idle",
  inputPricePerUnit: 1,
  outputPricePerUnit: 4,
  schedule: { timezone: TZ, negate: true, windows: PEAK_WINDOWS },
});

const at = (occurredAt: string) => ({
  provider: "alpha",
  modelId: "model-sched",
  occurredAt,
});

function codes(ledger: UsageLedger): DiagnosticCode[] {
  return validateUsageSemantics(ledger, usageRoadmap()).map((item) => item.code);
}

describe("schedule 位图语义", () => {
  it("无 schedule = 全集；窗口为左闭右开分钟区间（周一 00:00 起，0..10079）", () => {
    expect(scheduleWeekMinutes(undefined).size).toBe(10080);
    const bitmap = scheduleWeekMinutes({
      timezone: TZ,
      windows: [{ days: ["mon"], start: "09:00", end: "12:00" }],
    });
    expect(bitmap.size).toBe(180);
    expect(bitmap.has(9 * 60)).toBe(true); // 周一 09:00（含起点）
    expect(bitmap.has(12 * 60 - 1)).toBe(true); // 周一 11:59
    expect(bitmap.has(12 * 60)).toBe(false); // 周一 12:00（右端不含）
    expect(bitmap.has(1440)).toBe(false); // 周二 00:00 不在窗口内
  });

  it("negate=true 取补集（空闲 = 高峰补集）", () => {
    const complement = scheduleWeekMinutes({
      timezone: TZ,
      negate: true,
      windows: [{ days: ["mon"], start: "00:00", end: "01:00" }],
    });
    expect(complement.size).toBe(10080 - 60);
    expect(complement.has(0)).toBe(false); // 周一 00:00 在窗口内，取反后不生效
    expect(complement.has(60)).toBe(true); // 周一 01:00 起生效
  });

  it("negate 缺省为 false：窗口内生效、窗口外不生效", () => {
    const positive = schedulePrice({
      id: "p-sched-no-negate",
      schedule: { timezone: TZ, windows: PEAK_WINDOWS },
    });
    expect(priceMatchesEvent(positive, at("2026-10-27T10:30:00+08:00"))).toBe(true); // 周二高峰内
    expect(priceMatchesEvent(positive, at("2026-10-27T20:00:00+08:00"))).toBe(false); // 周二晚高峰外
    expect(priceMatchesEvent(positive, at("2026-10-31T10:30:00+08:00"))).toBe(false); // 周六
    expect(priceMatchesEvent(IDLE, at("2026-10-27T10:30:00+08:00"))).toBe(false); // negate：高峰内不生效
    expect(priceMatchesEvent(IDLE, at("2026-10-31T10:30:00+08:00"))).toBe(true); // negate：周六生效
  });

  it("parseWindowMinute：合法 HH:MM 解析，越界与缺补零拒绝", () => {
    expect(parseWindowMinute("00:00")).toBe(0);
    expect(parseWindowMinute("09:30")).toBe(570);
    expect(parseWindowMinute("23:59")).toBe(1439);
    expect(parseWindowMinute("24:00")).toBeNaN();
    expect(parseWindowMinute("9:00")).toBeNaN();
    expect(parseWindowMinute("09:60")).toBeNaN();
  });
});

describe("互补窗口不构成重叠", () => {
  it("高峰正向 + 空闲 negate 同 windows：无 USAGE_OVERLAPPING_PRICE", () => {
    expect(codes({ schemaVersion: 1, prices: [PEAK, IDLE], events: [] })).toEqual([]);
  });
});

describe("自动匹配按事件时段命中正确档", () => {
  const prices = [PEAK, IDLE];
  const at10 = { inputTokens: 1000000, outputTokens: 0 };

  it("工作日 10:30 → 高峰档；工作日 20:00 与周六 10:30 → 空闲档", () => {
    expect(findEffectivePrice(at("2026-10-27T10:30:00+08:00"), prices)?.id).toBe("p-sched-peak");
    expect(findEffectivePrice(at("2026-10-27T20:00:00+08:00"), prices)?.id).toBe("p-sched-idle");
    expect(findEffectivePrice(at("2026-10-31T10:30:00+08:00"), prices)?.id).toBe("p-sched-idle");
  });

  it("命中档位决定估算金额（高峰 2 元 vs 空闲 1 元）", () => {
    const views = buildUsageEventViews(
      [
        event("evt-peak", "T1", { ...at("2026-10-27T10:30:00+08:00"), usage: at10 }),
        event("evt-idle-weeknight", "T1", { ...at("2026-10-27T20:00:00+08:00"), usage: at10 }),
        event("evt-idle-weekend", "T1", { ...at("2026-10-31T10:30:00+08:00"), usage: at10 }),
      ],
      prices,
    );
    expect(views[0]!.cost).toMatchObject({ amount: 2, priceId: "p-sched-peak" });
    expect(views[1]!.cost).toMatchObject({ amount: 1, priceId: "p-sched-idle" });
    expect(views[2]!.cost).toMatchObject({ amount: 1, priceId: "p-sched-idle" });
  });
});

describe("真重叠必须报 USAGE_OVERLAPPING_PRICE（位图法）", () => {
  it("位图有交集（都覆盖工作日 10:00-12:00）→ 报错", () => {
    const left = schedulePrice({
      id: "p-overlap-a",
      schedule: { timezone: TZ, windows: [{ days: ["mon", "tue", "wed", "thu", "fri"], start: "09:00", end: "12:00" }] },
    });
    const right = schedulePrice({
      id: "p-overlap-b",
      schedule: { timezone: TZ, windows: [{ days: ["mon", "tue", "wed", "thu", "fri"], start: "10:00", end: "14:00" }] },
    });
    const found = validateUsageSemantics(
      { schemaVersion: 1, prices: [left, right], events: [] },
      usageRoadmap(),
    );
    expect(found).toEqual([
      expect.objectContaining({ code: "USAGE_OVERLAPPING_PRICE", path: "/prices/p-overlap-b" }),
    ]);
  });

  it("位图无交集（相邻半开窗口 9-12 与 12-18）→ 不报错", () => {
    const morning = schedulePrice({
      id: "p-adj-morning",
      schedule: { timezone: TZ, windows: [{ days: ["mon", "tue", "wed", "thu", "fri"], start: "09:00", end: "12:00" }] },
    });
    const afternoon = schedulePrice({
      id: "p-adj-afternoon",
      schedule: { timezone: TZ, windows: [{ days: ["mon", "tue", "wed", "thu", "fri"], start: "12:00", end: "18:00" }] },
    });
    expect(codes({ schemaVersion: 1, prices: [morning, afternoon], events: [] })).toEqual([]);
  });

  it("相同 windows 的两条 price → 报错", () => {
    const first = schedulePrice({ id: "p-dup-a", schedule: { timezone: TZ, windows: PEAK_WINDOWS } });
    const second = schedulePrice({ id: "p-dup-b", schedule: { timezone: TZ, windows: PEAK_WINDOWS } });
    const found = codes({ schemaVersion: 1, prices: [first, second], events: [] });
    expect(found).toContain("USAGE_OVERLAPPING_PRICE");
  });

  it("绝对有效期相邻（半开）不构成重叠", () => {
    const early = schedulePrice({
      id: "p-window-early",
      effectiveFrom: "2026-10-01T00:00:00+08:00",
      effectiveTo: "2026-10-15T00:00:00+08:00",
      schedule: { timezone: TZ, windows: PEAK_WINDOWS },
    });
    const late = schedulePrice({
      id: "p-window-late",
      effectiveFrom: "2026-10-15T00:00:00+08:00",
      schedule: { timezone: TZ, windows: PEAK_WINDOWS },
    });
    expect(codes({ schemaVersion: 1, prices: [early, late], events: [] })).toEqual([]);
  });
});

describe("supersededBy 语义", () => {
  /** 旧全天气闲档（无 schedule），被新取反空闲档取代 */
  const OLD_IDLE = schedulePrice({
    id: "p-sched-idle-old",
    supersededBy: "p-sched-idle",
  });

  it("旧档退出自动匹配：空闲时段事件命中新档（不再命中旧档）", () => {
    expect(findEffectivePrice(at("2026-10-31T10:30:00+08:00"), [OLD_IDLE, IDLE, PEAK])?.id).toBe(
      "p-sched-idle",
    );
  });

  it("历史事件显式 priceId 引用旧档仍解析原金额", () => {
    const views = buildUsageEventViews(
      [
        event("evt-old-pinned", "T1", {
          ...at("2026-10-31T10:30:00+08:00"),
          usage: { inputTokens: 1000000, outputTokens: 0 },
          priceId: "p-sched-idle-old",
        }),
      ],
      [OLD_IDLE, IDLE, PEAK],
    );
    expect(views[0]!.cost).toMatchObject({
      state: "estimated",
      basis: "computed",
      amount: 1,
      priceId: "p-sched-idle-old",
    });
  });

  it("旧档退出重叠判定：新档 + 高峰档共存不报重叠", () => {
    expect(codes({ schemaVersion: 1, prices: [OLD_IDLE, IDLE, PEAK], events: [] })).toEqual([]);
  });
});

describe("supersededBy 四反例", () => {
  const cases: { name: string; prices: UsagePrice[]; code: DiagnosticCode; path: string }[] = [
    {
      name: "目标不存在",
      prices: [schedulePrice({ id: "p-sup-unknown", supersededBy: "p-sup-missing" })],
      code: "USAGE_UNKNOWN_SUPERSEDE",
      path: "/prices/p-sup-unknown/supersededBy",
    },
    {
      name: "自引用",
      prices: [schedulePrice({ id: "p-sup-self", supersededBy: "p-sup-self" })],
      code: "USAGE_SUPERSEDE_SELF",
      path: "/prices/p-sup-self/supersededBy",
    },
    {
      name: "跨模型",
      prices: [
        schedulePrice({ id: "p-sup-cross-a", supersededBy: "p-sup-cross-b" }),
        schedulePrice({ id: "p-sup-cross-b", modelId: "model-other" }),
      ],
      code: "USAGE_SUPERSEDE_MODEL_MISMATCH",
      path: "/prices/p-sup-cross-a/supersededBy",
    },
  ];
  for (const item of cases) {
    it(`${item.name} → ${item.code}`, () => {
      const found = validateUsageSemantics(
        { schemaVersion: 1, prices: item.prices, events: [] },
        usageRoadmap(),
      );
      expect(found).toEqual([
        expect.objectContaining({ code: item.code, path: item.path }),
      ]);
    });
  }

  it("成环（A→B→A）→ 两条 price 均报 USAGE_SUPERSEDE_CYCLE", () => {
    const cycleA = schedulePrice({ id: "p-sup-cycle-a", supersededBy: "p-sup-cycle-b" });
    const cycleB = schedulePrice({ id: "p-sup-cycle-b", supersededBy: "p-sup-cycle-a" });
    const found = validateUsageSemantics(
      { schemaVersion: 1, prices: [cycleA, cycleB], events: [] },
      usageRoadmap(),
    );
    expect(found).toEqual([
      expect.objectContaining({ code: "USAGE_SUPERSEDE_CYCLE", path: "/prices/p-sup-cycle-a/supersededBy" }),
      expect.objectContaining({ code: "USAGE_SUPERSEDE_CYCLE", path: "/prices/p-sup-cycle-b/supersededBy" }),
    ]);
  });

  it("链式取代不成环（A→B→C）不报环", () => {
    const chainA = schedulePrice({ id: "p-sup-chain-a", supersededBy: "p-sup-chain-b" });
    const chainB = schedulePrice({ id: "p-sup-chain-b", supersededBy: "p-sup-chain-c" });
    const chainC = schedulePrice({ id: "p-sup-chain-c" });
    expect(codes({ schemaVersion: 1, prices: [chainA, chainB, chainC], events: [] })).toEqual([]);
  });
});

describe("schedule 结构诊断（USAGE_INVALID_SCHEDULE）", () => {
  const cases: { name: string; price: UsagePrice }[] = [
    {
      name: "start >= end",
      price: schedulePrice({
        id: "p-bad-range",
        schedule: { timezone: TZ, windows: [{ days: ["mon"], start: "12:00", end: "12:00" }] },
      }),
    },
    {
      name: "start 晚于 end（跨午夜）",
      price: schedulePrice({
        id: "p-bad-cross",
        schedule: { timezone: TZ, windows: [{ days: ["mon"], start: "22:00", end: "06:00" }] },
      }),
    },
    {
      name: "days 为空数组",
      price: schedulePrice({
        id: "p-bad-days",
        schedule: { timezone: TZ, windows: [{ days: [], start: "09:00", end: "12:00" }] },
      }),
    },
    {
      name: "时区无效",
      price: schedulePrice({
        id: "p-bad-tz",
        schedule: { timezone: "Not/AZone", windows: PEAK_WINDOWS },
      }),
    },
  ];
  for (const item of cases) {
    it(`${item.name} → USAGE_INVALID_SCHEDULE`, () => {
      const found = validateUsageSemantics(
        { schemaVersion: 1, prices: [item.price], events: [] },
        usageRoadmap(),
      );
      expect(found).toEqual([
        expect.objectContaining({
          code: "USAGE_INVALID_SCHEDULE",
          path: `/prices/${item.price.id}/schedule`,
        }),
      ]);
    });
  }
});

describe("跨时区：occurredAt 按 price 时区判定本地星期与时分", () => {
  const night = schedulePrice({
    id: "p-sched-night",
    schedule: {
      timezone: TZ,
      windows: [{ days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"], start: "00:00", end: "02:00" }],
    },
  });

  it("Z / +00:00 偏移按北京星期与时分判定（含起点、不含终点、跨星期换日）", () => {
    expect(priceMatchesEvent(night, at("2026-10-25T16:00:00Z"))).toBe(true); // 周一 00:00（含起点）
    expect(priceMatchesEvent(night, at("2026-10-25T16:30:00Z"))).toBe(true); // 周一 00:30
    expect(priceMatchesEvent(night, at("2026-10-25T17:59:59Z"))).toBe(true); // 周一 01:59:59
    expect(priceMatchesEvent(night, at("2026-10-25T18:00:00Z"))).toBe(false); // 周一 02:00（不含终点）
    expect(priceMatchesEvent(night, at("2026-10-25T15:59:59Z"))).toBe(false); // 周日 23:59:59
    expect(priceMatchesEvent(night, at("2026-10-26T16:30:00+00:00"))).toBe(true); // 周二 00:30
    expect(priceMatchesEvent(night, at("2026-10-26T00:30:00+08:00"))).toBe(true); // 周一 00:30（+08:00 直书）
    expect(priceMatchesEvent(night, at("2026-10-25T18:30:00+08:00"))).toBe(false); // 周六 18:30（窗口外）
  });
});

describe("显式 priceId 与事件时段不匹配", () => {
  const prices = [PEAK, IDLE];

  it("显式绑高峰档的周末/高峰外事件报 USAGE_PRICE_NOT_EFFECTIVE 且不静默估算", () => {
    const pinned = [
      event("evt-weekend-peak", "T1", {
        ...at("2026-10-31T10:30:00+08:00"), // 周六
        usage: { inputTokens: 1000000, outputTokens: 0 },
        priceId: "p-sched-peak",
      }),
      event("evt-weeknight-peak", "T1", {
        ...at("2026-10-27T20:00:00+08:00"), // 周二晚（高峰外）
        usage: { inputTokens: 1000000, outputTokens: 0 },
        priceId: "p-sched-peak",
      }),
      event("evt-peaktime-idle", "T1", {
        ...at("2026-10-27T10:30:00+08:00"), // 周二高峰内（negate 空闲档之外）
        usage: { inputTokens: 1000000, outputTokens: 0 },
        priceId: "p-sched-idle",
      }),
    ];
    for (const item of pinned) {
      const found = codes({ schemaVersion: 1, prices, events: [item] });
      expect(found, item.id).toEqual(["USAGE_PRICE_NOT_EFFECTIVE"]);
    }
    const views = buildUsageEventViews(pinned, prices);
    for (const view of views) {
      expect(view.cost.state, view.event.id).toBe("unknown");
      expect(view.cost.amount, view.event.id).toBeUndefined();
    }
  });
});

// —— 回归锚点：DeepSeek 双档 + 2026-10-24 周六真实事件（复刻父仓账本口径） ——

function anchorModelPrices(modelId: string, ids: { old: string; idle: string; peak: string }): UsagePrice[] {
  const base = {
    provider: "deepseek",
    modelId,
    currency: "CNY",
    unitTokens: 1000000,
    effectiveFrom: ANCHOR_FROM,
    effectiveTo: null,
    basis: "测试数据：DeepSeek 官方定价页快照口径复刻（空闲 0.02/1/4、高峰 0.04/2/8 元/M），构造值非真实账单",
  };
  return [
    // 旧全天气闲档：追加 supersededBy 指向新取反空闲档（仅追加该字段，计价字段零改动）
    { ...base, id: ids.old, ...IDLE_UNIT, supersededBy: ids.idle },
    // 新空闲档：negate 取高峰补集
    { ...base, id: ids.idle, ...IDLE_UNIT, schedule: { timezone: TZ, negate: true, windows: PEAK_WINDOWS } },
    // 高峰档：与空闲档互补
    { ...base, id: ids.peak, ...PEAK_UNIT, schedule: { timezone: TZ, windows: PEAK_WINDOWS } },
  ];
}

const ANCHOR_PRICES: UsagePrice[] = [
  {
    id: "test-deepseek-chat-2026-10",
    provider: "deepseek",
    modelId: "deepseek-chat",
    currency: "CNY",
    unitTokens: 1000000,
    inputPricePerUnit: 2,
    cachedInputPricePerUnit: 0.5,
    outputPricePerUnit: 8,
    reasoningPricePerUnit: 8,
    effectiveFrom: "2026-10-01T00:00:00+08:00",
    effectiveTo: null,
    basis: "测试数据：构造单价，无真实账单依据",
  },
  {
    id: "test-stepfun-step-2-2026-10",
    provider: "stepfun",
    modelId: "step-2",
    currency: "CNY",
    unitTokens: 1000000,
    inputPricePerUnit: 4,
    outputPricePerUnit: 10,
    effectiveFrom: "2026-10-01T00:00:00+08:00",
    effectiveTo: null,
    basis: "测试数据：构造单价，无真实账单依据",
  },
  ...anchorModelPrices("deepseek-flash", {
    old: "deepseek-flash-offpeak-2026-10",
    idle: "deepseek-flash-offpeak-2026-10-schedule",
    peak: "deepseek-flash-peak-2026-10",
  }),
  ...anchorModelPrices("deepseek-v4.1-flash", {
    old: "deepseek-v41flash-offpeak-2026-10",
    idle: "deepseek-v41flash-offpeak-2026-10-schedule",
    peak: "deepseek-v41flash-peak-2026-10",
  }),
  ...anchorModelPrices("DeepSeek-V4.1-Flash-1017-Event", {
    old: "deepseek-v41flash-1017-offpeak-2026-10",
    idle: "deepseek-v41flash-1017-offpeak-2026-10-schedule",
    peak: "deepseek-v41flash-1017-peak-2026-10",
  }),
  {
    id: "glm-5.3-flash-2026-10",
    provider: "zhipu",
    modelId: "GLM-5.3-Flash",
    currency: "CNY",
    unitTokens: 1000000,
    inputPricePerUnit: 0.8,
    cachedInputPricePerUnit: 0.23,
    outputPricePerUnit: 2.8,
    effectiveFrom: ANCHOR_FROM,
    effectiveTo: null,
    basis: "测试数据：智谱定价页快照口径复刻，构造值非真实账单",
  },
];

const ANCHOR_EVENTS: UsageEvent[] = [
  // 测试事件（P3-25 交付的样例，原样复刻）
  {
    id: "evt-test-001",
    taskId: "P3-01",
    occurredAt: "2026-10-15T09:30:00+08:00",
    provider: "deepseek",
    modelId: "deepseek-chat",
    role: "开发执行",
    source: "runtime_log",
    confidence: "measured",
    usage: { inputTokens: 12000, outputTokens: 3000, cachedInputTokens: 8000, reasoningTokens: 1200 },
    priceId: "test-deepseek-chat-2026-10",
    note: "测试数据：构造事件，非真实消耗",
  },
  {
    id: "evt-test-002",
    taskId: "P3-01",
    occurredAt: "2026-10-15T14:00:00+08:00",
    provider: "deepseek",
    modelId: "deepseek-chat",
    role: "独立验收",
    source: "manual",
    confidence: "measured",
    usage: { inputTokens: 5000, outputTokens: 1500 },
    cost: {
      basis: "actual",
      currency: "CNY",
      amount: 0.021,
      priceId: "test-deepseek-chat-2026-10",
      note: "测试数据：模拟供应商账单金额，非真实账单",
    },
    note: "测试数据：构造事件，非真实消耗",
  },
  {
    id: "evt-test-003",
    taskId: "P3-02",
    occurredAt: "2026-10-16T10:00:00+08:00",
    provider: "sample",
    modelId: "sample-model",
    role: "主控协调",
    source: "manual",
    confidence: "estimated",
    usage: { inputTokens: 900, outputTokens: 400 },
    note: "测试数据：构造事件，非真实消耗；供应方与模型无对应价格，费用为未知",
  },
  {
    id: "evt-test-004",
    taskId: "P3-20",
    occurredAt: "2026-10-17T11:20:00+08:00",
    provider: "stepfun",
    modelId: "step-2",
    role: "开发执行",
    source: "runtime_log",
    confidence: "measured",
    usage: { inputTokens: 20000, outputTokens: 5000, cachedInputTokens: 6000 },
    priceId: "test-stepfun-step-2-2026-10",
    note: "测试数据：构造事件，非真实消耗；缺缓存输入价触发回退假设标注",
  },
  {
    id: "evt-test-005",
    taskId: "P3-21",
    occurredAt: "2026-10-18T16:45:00+08:00",
    provider: "deepseek",
    modelId: "deepseek-chat",
    role: "返工",
    source: "manual",
    confidence: "unknown",
    usage: { inputTokens: 3000, outputTokens: 1200 },
    note: "测试数据：构造事件，非真实消耗；可信度未知，费用为未知",
  },
  {
    id: "evt-test-006",
    taskId: "P3-02",
    occurredAt: "2026-10-19T09:10:00+08:00",
    provider: "deepseek",
    modelId: "deepseek-chat",
    role: "独立验收",
    source: "manual",
    confidence: "estimated",
    usage: { inputTokens: 8000, outputTokens: 2400 },
    cost: {
      basis: "estimated",
      currency: "CNY",
      amount: 0.03,
      note: "测试数据：登记者自行估算的金额，非工具公式结果",
      assumptions: ["按用量明细与构造单价手工估算"],
    },
    note: "测试数据：构造事件，非真实消耗",
  },
  // 2026-10-24（周六）真实事件：显式绑旧全天气闲档（该档 superseded 后仍可显式引用）
  {
    id: "evt-20261024-p326-ds-flash",
    taskId: "P3-26",
    occurredAt: "2026-10-24T21:49:00+08:00",
    provider: "deepseek",
    modelId: "deepseek-flash",
    agent: "WorkBuddy 主控会话 09620f79（含同会话子代理调用）",
    role: "主控协调",
    source: "runtime_log",
    confidence: "measured",
    usage: {
      inputTokens: 130953499,
      outputTokens: 249584,
      cachedInputTokens: 128629504,
      reasoningTokens: 90401,
    },
    priceId: "deepseek-flash-offpeak-2026-10",
    note: "真实用量复刻：2026-10-24 当日聚合，330 次调用；周六全天空闲时段",
  },
  {
    id: "evt-20261024-p326-ds-v41flash",
    taskId: "P3-26",
    occurredAt: "2026-10-24T21:49:00+08:00",
    provider: "deepseek",
    modelId: "deepseek-v4.1-flash",
    agent: "WorkBuddy 主控会话 09620f79 + 会话 489857ac",
    role: "主控协调",
    source: "runtime_log",
    confidence: "measured",
    usage: {
      inputTokens: 40239560,
      outputTokens: 176468,
      cachedInputTokens: 38458240,
      reasoningTokens: 92688,
    },
    priceId: "deepseek-v41flash-offpeak-2026-10",
    note: "真实用量复刻：2026-10-24 当日跨 2 个 transcript，217 次调用；周六全天空闲时段",
  },
  {
    id: "evt-20261024-p326-ds-v41flash1017",
    taskId: "P3-26",
    occurredAt: "2026-10-24T21:49:00+08:00",
    provider: "deepseek",
    modelId: "DeepSeek-V4.1-Flash-1017-Event",
    agent: "WorkBuddy 主控会话 09620f79（含同会话子代理调用）",
    role: "主控协调",
    source: "runtime_log",
    confidence: "measured",
    usage: {
      inputTokens: 26404546,
      outputTokens: 134804,
      cachedInputTokens: 25961600,
      reasoningTokens: 46296,
    },
    priceId: "deepseek-v41flash-1017-offpeak-2026-10",
    note: "真实用量复刻：2026-10-24 当日，222 次调用；周六全天空闲时段",
  },
  {
    id: "evt-20261024-p326-glm53flash",
    taskId: "P3-26",
    occurredAt: "2026-10-24T10:47:00+08:00",
    provider: "zhipu",
    modelId: "GLM-5.3-Flash",
    agent: "WorkBuddy 会话 6088015b",
    role: "独立验收",
    source: "runtime_log",
    confidence: "measured",
    usage: {
      inputTokens: 4029553,
      outputTokens: 22074,
      cachedInputTokens: 3830272,
      reasoningTokens: 11408,
    },
    priceId: "glm-5.3-flash-2026-10",
    note: "真实用量复刻：2026-10-24 本地 10:00–10:47 独立会话，48 次调用",
  },
];

const ANCHOR_LEDGER: UsageLedger = {
  schemaVersion: 1,
  project: "game-agent-harness",
  prices: ANCHOR_PRICES,
  events: ANCHOR_EVENTS,
};

const ANCHOR_RELEASE_BY_TASK = new Map([
  ["P3-01", "v0.3"],
  ["P3-02", "v0.3"],
  ["P3-20", "v0.3"],
  ["P3-21", "v0.3"],
  ["P3-26", "v0.3"],
]);

function anchorRoadmap(): Roadmap {
  return {
    schemaVersion: 1,
    project: { id: "game-agent-harness", name: "用量锚点复刻项目" },
    releases: [{ id: "v0.3", name: "第三阶段", status: "done" }],
    requirements: ["P3-01", "P3-02", "P3-20", "P3-21", "P3-26"].map((id) => ({
      id,
      title: `任务 ${id}`,
      releaseId: "v0.3",
      status: "done",
      dependsOn: [],
      acceptance: [],
      evidence: [],
    })),
  };
}

describe("回归锚点：DeepSeek 双档 + 2026-10-24 周六真实事件", () => {
  it("双档 + supersededBy 的锚点账本通过语义校验（无任何诊断）", () => {
    expect(validateUsageSemantics(ANCHOR_LEDGER, anchorRoadmap())).toEqual([]);
  });

  it("显式绑旧全天气闲档的历史事件金额复算与合并前一致", () => {
    const views = buildUsageEventViews(ANCHOR_EVENTS, ANCHOR_PRICES);
    const costOf = (id: string) => views.find((view) => view.event.id === id)!.cost;
    // 空闲档单价（命中 0.02 / 未命中 1 / 输出 4 元/M），事件级 4 位小数
    expect(costOf("evt-20261024-p326-ds-flash")).toMatchObject({
      state: "estimated",
      basis: "computed",
      currency: "CNY",
      amount: 5.8949,
      priceId: "deepseek-flash-offpeak-2026-10", // superseded 旧档仍可显式引用
    });
    expect(costOf("evt-20261024-p326-ds-v41flash")).toMatchObject({
      amount: 3.2564,
      priceId: "deepseek-v41flash-offpeak-2026-10",
    });
    expect(costOf("evt-20261024-p326-ds-v41flash1017")).toMatchObject({
      amount: 1.5014,
      priceId: "deepseek-v41flash-1017-offpeak-2026-10",
    });
    expect(costOf("evt-20261024-p326-glm53flash")).toMatchObject({
      amount: 1.1022,
      priceId: "glm-5.3-flash-2026-10",
    });
  });

  it("汇总金额与合并前一致：deepseek 10.72 / zhipu 1.10 / stepfun 0.13 / totals 11.95", () => {
    const summary = buildUsageSummary(ANCHOR_EVENTS, ANCHOR_PRICES, ANCHOR_RELEASE_BY_TASK);
    expect(summary.totals.costActual).toEqual({ CNY: 0.02 });
    expect(summary.totals.costEstimated).toEqual({ CNY: 11.95 });
    expect(summary.totals.unknownCostEventCount).toBe(2);
    expect(summary.byProvider["deepseek"]!.costEstimated).toEqual({ CNY: 10.72 });
    expect(summary.byProvider["zhipu"]!.costEstimated).toEqual({ CNY: 1.1 });
    expect(summary.byProvider["stepfun"]!.costEstimated).toEqual({ CNY: 0.13 });
  });

  it("自动匹配路径下同类事件（周六）命中空闲新档且金额不变", () => {
    const views = buildUsageEventViews(
      [
        {
          ...ANCHOR_EVENTS.find((item) => item.id === "evt-20261024-p326-ds-flash")!,
          id: "evt-20261024-p326-ds-flash-auto",
          priceId: undefined,
        },
      ],
      ANCHOR_PRICES,
    );
    expect(views[0]!.cost).toMatchObject({
      state: "estimated",
      basis: "computed",
      currency: "CNY",
      amount: 5.8949,
      priceId: "deepseek-flash-offpeak-2026-10-schedule", // 新取反空闲档（非 superseded 旧档）
    });
  });

  it("锚点账本经完整校验管线通过并产出 usage 载荷（Schema 接受新字段）", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "version-plan-schedule-"));
    temporaryPaths.push(root);
    await writeFile(
      path.join(root, "version-plan.config.json"),
      JSON.stringify({ dataFile: "plan.json", usageFile: "usage.json" }),
    );
    await writeFile(path.join(root, "plan.json"), JSON.stringify(anchorRoadmap()));
    await writeFile(path.join(root, "usage.json"), JSON.stringify(ANCHOR_LEDGER));
    const result = await validateProject(root);
    expect(result.diagnostics).toEqual([]);
    expect(result.valid).toBe(true);
    expect(result.usage?.enabled).toBe(true);
    expect(result.usage?.summary.totals.costEstimated).toEqual({ CNY: 11.95 });
    expect(result.usage?.summary.byProvider["deepseek"]!.costEstimated).toEqual({ CNY: 10.72 });
  });
});
