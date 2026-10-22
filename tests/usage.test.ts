import { describe, expect, it } from "vitest";
import { validateSemantics } from "../src/validation";
import {
  USAGE_ASSUMPTION_IDS,
  buildUsageEventViews,
  buildUsageSummary,
  estimateEventCost,
  findEffectivePrice,
  normalizeLedger,
  priceMatchesEvent,
  priceWindowCovers,
  resolveEventCost,
  summarizeUsage,
} from "../src/usage";
import type { UsageEvent, UsageLedger } from "../src/types";
import {
  EVENTS,
  LEDGER,
  PRICES,
  RELEASE_BY_TASK,
  event,
  usageRoadmap,
} from "./usage-fixtures";

function summary() {
  return buildUsageSummary(EVENTS, PRICES, RELEASE_BY_TASK);
}

const roadmap = usageRoadmap();

describe("账本规范化", () => {
  it("prices 缺省为空数组，缓存/推理细分缺省为 0", () => {
    const normalized = normalizeLedger({ schemaVersion: 1, events: EVENTS });
    expect(normalized.prices).toEqual([]);
    const bare = normalized.events.find((item) => item.id === "evt-003");
    expect(bare?.usage).toEqual({
      inputTokens: 900,
      outputTokens: 400,
      cachedInputTokens: 0,
      reasoningTokens: 0,
    });
  });

  it("不修改原始账本对象（纯函数）", () => {
    const before = structuredClone(LEDGER);
    normalizeLedger(LEDGER);
    buildUsageEventViews(EVENTS, PRICES);
    summary();
    expect(LEDGER).toEqual(before);
  });
});

describe("价格匹配（四要素）", () => {
  const at = (occurredAt: string) => ({ provider: "alpha", modelId: "model-a", occurredAt });

  it("effectiveFrom ≤ occurredAt < effectiveTo，effectiveTo 为空视为开放区间", () => {
    const oct = PRICES[0]!;
    const nov = PRICES[1]!;
    expect(priceWindowCovers(oct, "2026-10-01T00:00:00+08:00")).toBe(true);
    expect(priceWindowCovers(oct, "2026-10-31T23:59:59+08:00")).toBe(true);
    expect(priceWindowCovers(oct, "2026-11-01T00:00:00+08:00")).toBe(false);
    expect(priceWindowCovers(nov, "2026-11-01T00:00:00+08:00")).toBe(true);
    expect(priceWindowCovers(nov, "2027-06-01T00:00:00+08:00")).toBe(true);
    expect(priceWindowCovers(oct, "2026-09-30T23:59:59+08:00")).toBe(false);
  });

  it("provider/modelId 不一致即不匹配", () => {
    expect(priceMatchesEvent(PRICES[2]!, at("2026-10-10T09:30:00+08:00"))).toBe(false);
    expect(priceMatchesEvent(PRICES[0]!, at("2026-10-10T09:30:00+08:00"))).toBe(true);
  });

  it("按发生时间命中正确价格版本", () => {
    expect(findEffectivePrice(at("2026-10-10T09:30:00+08:00"), PRICES)?.id).toBe("p-a-oct");
    expect(findEffectivePrice(at("2026-11-05T09:30:00+08:00"), PRICES)?.id).toBe("p-a-nov");
    expect(
      findEffectivePrice(
        { provider: "gamma", modelId: "model-c", occurredAt: "2026-10-10T09:30:00+08:00" },
        PRICES,
      ),
    ).toBeUndefined();
  });
});

describe("估算公式与回退假设（T04 / T14）", () => {
  const normalized = normalizeLedger(LEDGER);

  it("输入拆非缓存+缓存、输出拆非推理+推理四段计价", () => {
    const evt = normalized.events.find((item) => item.id === "evt-001")!;
    // (12000-8000)/1e6*2 + 8000/1e6*0.5 + (3000-1200)/1e6*8 + 1200/1e6*8
    // = 0.008 + 0.004 + 0.0144 + 0.0096 = 0.036
    expect(estimateEventCost(evt, PRICES[0]!)).toEqual({
      currency: "CNY",
      amount: 0.036,
      assumptions: [],
    });
  });

  it("缺 cachedInputPricePerUnit / reasoningPricePerUnit 时回退并标注假设", () => {
    const evt = normalized.events.find((item) => item.id === "evt-005")!;
    // (10000-4000)/1e6*2 + 4000/1e6*2 + (2000-1000)/1e6*8 + 1000/1e6*8
    // = 0.012 + 0.008 + 0.008 + 0.008 = 0.036
    expect(estimateEventCost(evt, PRICES[3]!)).toEqual({
      currency: "CNY",
      amount: 0.036,
      assumptions: [
        USAGE_ASSUMPTION_IDS.cachedInputFallbackToInput,
        USAGE_ASSUMPTION_IDS.reasoningFallbackToOutput,
      ],
    });
  });

  it("未声明细分的价格对无缓存/推理 Token 的事件不产生回退假设", () => {
    const evt = normalized.events.find((item) => item.id === "evt-003")!;
    expect(estimateEventCost(evt, PRICES[2]!).assumptions).toEqual([]);
  });

  it("单位 token 数参与换算（unitTokens=1000）", () => {
    const evt = normalized.events.find((item) => item.id === "evt-003")!;
    // 900/1000*0.01 + 400/1000*0.03 = 0.021
    expect(estimateEventCost(evt, PRICES[2]!).amount).toBe(0.021);
  });
});

describe("事件费用三态与口径唯一性（T05 / T13）", () => {
  const views = buildUsageEventViews(EVENTS, PRICES);
  const costOf = (id: string) => views.find((view) => view.event.id === id)!.cost;

  it("登记 cost 优先于工具估算，且 basis 决定 actual/estimated", () => {
    expect(costOf("evt-002")).toMatchObject({
      state: "actual",
      basis: "registered",
      currency: "CNY",
      amount: 0.021,
    });
    expect(costOf("evt-007")).toMatchObject({
      state: "estimated",
      basis: "registered",
      currency: "CNY",
      amount: 0.008,
    });
    expect(costOf("evt-009")).toMatchObject({
      state: "actual",
      basis: "registered",
      currency: "USD",
      amount: 0.05,
    });
  });

  it("无 cost 时按价格版本自动估算", () => {
    expect(costOf("evt-001")).toMatchObject({
      state: "estimated",
      basis: "computed",
      currency: "CNY",
      amount: 0.036,
      priceId: "p-a-oct",
    });
    expect(costOf("evt-003")).toMatchObject({
      state: "estimated",
      basis: "computed",
      currency: "USD",
      amount: 0.021,
      priceId: "p-b-usd",
    });
  });

  it("缺单价、缺金额、未知可信度都记 unknown 且不计 0 元", () => {
    for (const id of ["evt-006", "evt-008", "evt-011"]) {
      const cost = costOf(id);
      expect(cost.state, id).toBe("unknown");
      expect(cost.amount, id).toBeUndefined();
    }
    expect(costOf("evt-006").basis).toBe("none");
    expect(costOf("evt-008").basis).toBe("registered");
    expect(costOf("evt-011").basis).toBe("none");
  });

  it("T13 四种情况：前三者进 unknownCostEventCount，实际账单进 costActual", () => {
    const priced = buildUsageEventViews(
      [
        event("e-noprice", "T1", {
          provider: "gamma",
          modelId: "model-c",
          usage: { inputTokens: 10, outputTokens: 5 },
        }),
        event("e-noamount", "T1", {
          usage: { inputTokens: 10, outputTokens: 5 },
          cost: { basis: "actual", currency: "CNY" },
        }),
        event("e-unknown", "T1", {
          provider: "beta",
          modelId: "model-b",
          confidence: "unknown",
          usage: { inputTokens: 10, outputTokens: 5 },
        }),
        event("e-actual", "T1", {
          usage: { inputTokens: 10, outputTokens: 5 },
          cost: { basis: "actual", currency: "CNY", amount: 1.5 },
        }),
      ],
      PRICES,
    );
    const result = summarizeUsage(priced, RELEASE_BY_TASK);
    expect(result.totals.unknownCostEventCount).toBe(3);
    expect(result.totals.costActual).toEqual({ CNY: 1.5 });
    expect(result.totals.costEstimated).toEqual({});
  });

  it("一条事件不会同时进入 actual 与 estimated 两个桶", () => {
    const result = summary();
    // T1：evt-002 登记 actual 0.021，evt-001 估算 0.036；若双重计费估算桶会变成 0.057
    expect(result.byTask["T1"]!.costActual).toEqual({ CNY: 0.02 });
    expect(result.byTask["T1"]!.costEstimated).toEqual({ CNY: 0.04, USD: 0.01 });
    expect(result.byTask["T1"]!.unknownCostEventCount).toBe(1);
  });
});

describe("Token 口径（T04）", () => {
  const result = summary();

  it("输入/输出为总量，缓存/推理为细分且不二次累加", () => {
    expect(result.totals.tokens.input).toBe(52400);
    expect(result.totals.tokens.output).toBe(13050);
    expect(result.totals.tokens.cachedInput).toBe(16000);
    expect(result.totals.tokens.reasoning).toBe(3200);
    // 若把细分再加到总量上，input 会变成 52400+16000
    expect(result.totals.tokens.input).not.toBe(52400 + 16000);
    expect(result.totals.tokens.output).not.toBe(13050 + 3200);
  });

  it("总量等于各事件 inputTokens/outputTokens 之和", () => {
    const input = EVENTS.reduce((sum, item) => sum + item.usage.inputTokens, 0);
    const output = EVENTS.reduce((sum, item) => sum + item.usage.outputTokens, 0);
    expect(result.totals.tokens.input).toBe(input);
    expect(result.totals.tokens.output).toBe(output);
  });
});

describe("多币种与价格版本（T06 / T15）", () => {
  const result = summary();

  it("不同币种分列，不相加", () => {
    expect(result.totals.costActual).toEqual({ CNY: 0.02, USD: 0.05 });
    expect(result.totals.costEstimated).toEqual({ CNY: 0.13, USD: 0.03 });
  });

  it("费率变化只增不改：历史事件按当时费率可复核", () => {
    // evt-001（10 月，2/0.5/8/8）与 evt-004（11 月，1.5/0.4/6/6）同模型不同费率
    const views = buildUsageEventViews(EVENTS, PRICES);
    const oct = views.find((view) => view.event.id === "evt-001")!.cost;
    const nov = views.find((view) => view.event.id === "evt-004")!.cost;
    expect(oct).toMatchObject({ amount: 0.036, priceId: "p-a-oct" });
    expect(nov).toMatchObject({ amount: 0.0496, priceId: "p-a-nov" });
  });

  it("价格表只增不改：汇总不修改任何历史价格字段", () => {
    const before = structuredClone(PRICES);
    summary();
    expect(PRICES).toEqual(before);
  });

  it("显式 priceId 绑定失效价格时不静默改用它价估算", () => {
    const pinned = buildUsageEventViews(
      [
        event("evt-pinned", "T1", {
          occurredAt: "2026-11-20T10:00:00+08:00",
          usage: { inputTokens: 1000000, outputTokens: 0 },
          priceId: "p-a-oct",
        }),
      ],
      PRICES,
    );
    expect(pinned[0]!.cost).toMatchObject({ state: "unknown" });
  });
});

describe("confidence 三组子汇总（T12）", () => {
  const result = summary();
  const { totals } = result;

  it("三组互斥完备：eventCount 之和恒等于桶 eventCount", () => {
    const { measured, estimated, unknown } = totals.confidence;
    expect(measured.eventCount + estimated.eventCount + unknown.eventCount).toBe(
      totals.eventCount,
    );
    expect(measured.eventCount).toBe(7);
    expect(estimated.eventCount).toBe(2);
    expect(unknown.eventCount).toBe(2);
  });

  it("三组 tokens 逐字段之和恒等于桶 tokens", () => {
    const { measured, estimated, unknown } = totals.confidence;
    expect(
      measured.tokens.input + estimated.tokens.input + unknown.tokens.input,
    ).toBe(totals.tokens.input);
    expect(
      measured.tokens.output + estimated.tokens.output + unknown.tokens.output,
    ).toBe(totals.tokens.output);
    expect(
      measured.tokens.cachedInput + estimated.tokens.cachedInput + unknown.tokens.cachedInput,
    ).toBe(totals.tokens.cachedInput);
    expect(
      measured.tokens.reasoning + estimated.tokens.reasoning + unknown.tokens.reasoning,
    ).toBe(totals.tokens.reasoning);
  });

  it("子汇总不再计入总量（分组视图，不是额外消耗）", () => {
    expect(totals.tokens.input).toBe(52400);
    expect(totals.tokens.input).not.toBe(52400 * 2);
  });

  it("每个汇总桶都满足三组恒等约束", () => {
    const buckets = [
      totals,
      ...Object.values(result.byTask),
      ...Object.values(result.byRelease),
      ...Object.values(result.byModel),
      ...Object.values(result.byProvider),
      ...Object.values(result.byRole),
    ];
    for (const bucket of buckets) {
      const { measured, estimated, unknown } = bucket.confidence;
      expect(measured.eventCount + estimated.eventCount + unknown.eventCount).toBe(
        bucket.eventCount,
      );
      expect(
        measured.tokens.input + estimated.tokens.input + unknown.tokens.input,
      ).toBe(bucket.tokens.input);
      expect(
        measured.tokens.output + estimated.tokens.output + unknown.tokens.output,
      ).toBe(bucket.tokens.output);
    }
  });
});

describe("五维汇总一致性（T02 / T07）", () => {
  const result = summary();

  it("按任务、模型、角色、版本正确关联（一任务多事件/多角色/多模型）", () => {
    expect(Object.keys(result.byTask).sort()).toEqual(["T1", "T2", "T3"]);
    const t1 = result.byTask["T1"]!;
    expect(t1.eventCount).toBe(4);
    expect(t1.taskCount).toBe(1);
    expect(t1.modelCount).toBe(2);
    expect(Object.keys(result.byRole).sort()).toEqual([
      "主控协调",
      "开发执行",
      "独立验收",
      "返工",
    ]);
    expect(result.byRole["开发执行"]!.eventCount).toBe(4);
    expect(result.byRole["返工"]!.eventCount).toBe(2);
    expect(result.byModel["alpha/model-a"]!.taskCount).toBe(3);
    expect(result.byModel["beta/model-b"]!.eventCount).toBe(4);
  });

  it("任务明细之和与整体一致（任务桶等于其全部事件累加）", () => {
    const t1Views = buildUsageEventViews(
      EVENTS.filter((item) => item.taskId === "T1"),
      PRICES,
    );
    const t1Direct = summarizeUsage(t1Views, RELEASE_BY_TASK).byTask["T1"]!;
    expect(t1Direct).toEqual(result.byTask["T1"]);
  });

  it("版本、模型、供应商、角色、任务五层汇总之和等于整体", () => {
    const sumOf = (buckets: Record<string, { eventCount: number; tokens: { input: number; output: number } }>) =>
      Object.values(buckets).reduce(
        (acc, bucket) => ({
          eventCount: acc.eventCount + bucket.eventCount,
          input: acc.input + bucket.tokens.input,
          output: acc.output + bucket.tokens.output,
        }),
        { eventCount: 0, input: 0, output: 0 },
      );
    for (const dimension of [
      result.byTask,
      result.byRelease,
      result.byModel,
      result.byProvider,
      result.byRole,
    ]) {
      const total = sumOf(dimension);
      expect(total.eventCount).toBe(result.totals.eventCount);
      expect(total.input).toBe(result.totals.tokens.input);
      expect(total.output).toBe(result.totals.tokens.output);
    }
  });

  it("各维度费用分列与整体一致（无双重计费）", () => {
    const cny = (value: Record<string, number>) => value["CNY"] ?? 0;
    const usd = (value: Record<string, number>) => value["USD"] ?? 0;
    const sumActualCny = Object.values(result.byTask).reduce(
      (sum, bucket) => sum + cny(bucket.costActual),
      0,
    );
    const sumActualUsd = Object.values(result.byTask).reduce(
      (sum, bucket) => sum + usd(bucket.costActual),
      0,
    );
    expect(sumActualCny).toBeCloseTo(cny(result.totals.costActual), 2);
    expect(sumActualUsd).toBeCloseTo(usd(result.totals.costActual), 2);
    const sumEstimatedCny = Object.values(result.byRelease).reduce(
      (sum, bucket) => sum + cny(bucket.costEstimated),
      0,
    );
    expect(sumEstimatedCny).toBeCloseTo(cny(result.totals.costEstimated), 2);
    const sumUnknown = Object.values(result.byModel).reduce(
      (sum, bucket) => sum + bucket.unknownCostEventCount,
      0,
    );
    expect(sumUnknown).toBe(result.totals.unknownCostEventCount);
  });

  it("悬空 taskId 事件不进入汇总（防御，校验层已拦截）", () => {
    const dangling = buildUsageEventViews(
      [event("evt-dangling", "T-999", { usage: { inputTokens: 10, outputTokens: 5 } })],
      PRICES,
    );
    const result = summarizeUsage(dangling, RELEASE_BY_TASK);
    expect(result.totals.eventCount).toBe(0);
    expect(Object.keys(result.byTask)).toEqual([]);
  });

  it("汇总键为 provider/modelId、provider、role、releaseId、taskId", () => {
    expect(Object.keys(result.byModel).sort()).toEqual([
      "alpha/model-a",
      "alpha/model-fallback",
      "beta/model-b",
      "gamma/model-c",
    ]);
    expect(Object.keys(result.byProvider).sort()).toEqual(["alpha", "beta", "gamma"]);
    expect(Object.keys(result.byRelease).sort()).toEqual(["v1", "v2"]);
  });
});

describe("回退假设逐级冒泡（T14）", () => {
  const result = summary();

  it("事件假设进入所属任务/模型/版本/角色/供应商桶", () => {
    const fallbackIds = [
      USAGE_ASSUMPTION_IDS.cachedInputFallbackToInput,
      USAGE_ASSUMPTION_IDS.reasoningFallbackToOutput,
    ];
    expect(result.byTask["T3"]!.assumptions).toEqual(
      expect.arrayContaining([...fallbackIds, "manual-rounding"]),
    );
    expect(result.byModel["alpha/model-fallback"]!.assumptions).toEqual(fallbackIds);
    expect(result.byRelease["v1"]!.assumptions).toEqual(expect.arrayContaining(fallbackIds));
    expect(result.byRole["返工"]!.assumptions).toEqual(expect.arrayContaining(fallbackIds));
    expect(result.byProvider["alpha"]!.assumptions).toEqual(expect.arrayContaining(fallbackIds));
    expect(result.totals.assumptions).toEqual([
      "cached_input_price_fallback_to_input",
      "manual-rounding",
      "reasoning_price_fallback_to_output",
    ]);
    // 未涉及回退的桶不含假设
    expect(result.byTask["T1"]!.assumptions).toEqual([]);
    expect(result.byTask["T2"]!.assumptions).toEqual([]);
  });
});

describe("显式价格引用的估算保护（T10 / T11）", () => {
  it("显式引用不存在或四要素不一致时不静默估算", () => {
    const cases: { name: string; overrides: Partial<UsageEvent> }[] = [
      { name: "过期价格", overrides: { occurredAt: "2026-11-20T10:00:00+08:00", priceId: "p-a-oct" } },
      { name: "未生效价格", overrides: { occurredAt: "2026-09-15T10:00:00+08:00", priceId: "p-a-nov" } },
      { name: "provider 错配", overrides: { provider: "beta", modelId: "model-b", priceId: "p-a-oct" } },
      { name: "modelId 错配", overrides: { modelId: "model-z", priceId: "p-a-oct" } },
      { name: "priceId 不存在", overrides: { priceId: "p-missing" } },
    ];
    for (const item of cases) {
      const views = buildUsageEventViews(
        [
          event("evt-bad", "T1", {
            usage: { inputTokens: 1000, outputTokens: 100 },
            ...item.overrides,
          }),
        ],
        PRICES,
      );
      const cost = views[0]!.cost;
      expect(cost.state, item.name).toBe("unknown");
      expect(cost.amount, item.name).toBeUndefined();
    }
  });

  it("顶层 priceId 固定估算快照（T11 场景一）", () => {
    const views = buildUsageEventViews(
      [
        event("evt-snapshot", "T1", {
          occurredAt: "2026-10-25T10:00:00+08:00",
          usage: { inputTokens: 1000000, outputTokens: 0 },
          priceId: "p-a-oct",
        }),
      ],
      PRICES,
    );
    expect(views[0]!.cost).toMatchObject({
      state: "estimated",
      basis: "computed",
      currency: "CNY",
      amount: 2,
      priceId: "p-a-oct",
    });
  });

  it("cost.priceId 不改变登记费用优先的结论（T11 场景二/三）", () => {
    const views = buildUsageEventViews(
      [
        event("evt-costref", "T1", {
          usage: { inputTokens: 1000000, outputTokens: 0 },
          cost: { basis: "actual", currency: "CNY", amount: 3, priceId: "p-a-oct" },
        }),
      ],
      PRICES,
    );
    expect(views[0]!.cost).toMatchObject({
      state: "actual",
      basis: "registered",
      amount: 3,
      priceId: "p-a-oct",
    });
  });

  it("resolveEventCost 与 buildUsageEventViews 结果一致", () => {
    const normalized = normalizeLedger(LEDGER);
    const direct = normalized.events.map((item) => ({
      event: item,
      cost: resolveEventCost(item, PRICES),
    }));
    expect(direct).toEqual(buildUsageEventViews(EVENTS, PRICES));
  });
});

describe("契约 §11 示例账本", () => {
  it("示例数据可正常汇总", () => {
    const sampleLedger: UsageLedger = {
      schemaVersion: 1,
      project: "sample-product",
      prices: [
        {
          id: "sample-model-2026-10",
          provider: "sample",
          modelId: "sample-model",
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
      ],
      events: [
        event("evt-sample-001", "account-login", {
          occurredAt: "2026-10-10T09:30:00+08:00",
          provider: "sample",
          modelId: "sample-model",
          agent: "dev-sample-01",
          role: "开发执行",
          source: "runtime_log",
          usage: {
            inputTokens: 12000,
            outputTokens: 3000,
            cachedInputTokens: 8000,
            reasoningTokens: 1200,
          },
          priceId: "sample-model-2026-10",
        }),
        event("evt-sample-002", "account-login", {
          occurredAt: "2026-10-11T14:00:00+08:00",
          provider: "sample",
          modelId: "sample-model",
          role: "独立验收",
          source: "manual",
          confidence: "estimated",
          usage: { inputTokens: 5000, outputTokens: 1500 },
          cost: { basis: "actual", currency: "CNY", amount: 0.021, note: "测试数据：模拟供应商账单" },
        }),
        event("evt-sample-003", "first-release-setup", {
          occurredAt: "2026-10-12T10:00:00+08:00",
          provider: "other",
          modelId: "other-model",
          role: "主控协调",
          source: "manual",
          confidence: "unknown",
          usage: { inputTokens: 900, outputTokens: 400 },
        }),
      ],
    };
    const releaseByTask = new Map([
      ["account-login", "first-release"],
      ["first-release-setup", "first-release"],
    ]);
    const result = buildUsageSummary(sampleLedger.events, sampleLedger.prices!, releaseByTask);
    expect(result.totals.eventCount).toBe(3);
    expect(result.totals.taskCount).toBe(2);
    expect(result.totals.costActual).toEqual({ CNY: 0.02 });
    expect(result.totals.costEstimated).toEqual({ CNY: 0.04 });
    expect(result.totals.unknownCostEventCount).toBe(1);
    expect(result.byRelease["first-release"]!.eventCount).toBe(3);
  });
});

describe("夹具与路线数据的一致性", () => {
  it("用量夹具的 roadmap 本身通过路线语义校验", () => {
    expect(validateSemantics(roadmap)).toEqual([]);
  });

  it("汇总用的 releaseByTask 与 roadmap 一致", () => {
    expect(RELEASE_BY_TASK.get("T3")).toBe("v1");
    expect([...RELEASE_BY_TASK.keys()].sort()).toEqual(
      roadmap.requirements.map((item) => item.id).sort(),
    );
  });
});
