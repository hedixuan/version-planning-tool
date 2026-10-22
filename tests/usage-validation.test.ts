import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runValidate } from "../src/cli";
import { validateProject, validateUsageSemantics } from "../src/validation";
import type { DiagnosticCode, Roadmap, UsageLedger } from "../src/types";
import { LEDGER, PRICES, event, usageRoadmap } from "./usage-fixtures";

const temporaryPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryPaths.splice(0).map((target) => rm(target, { recursive: true, force: true })),
  );
});

async function createProject(options: {
  ledger?: unknown;
  config?: Record<string, unknown>;
  roadmap?: Roadmap;
}): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "version-plan-usage-"));
  temporaryPaths.push(root);
  await writeFile(
    path.join(root, "version-plan.config.json"),
    JSON.stringify(options.config ?? { dataFile: "plan.json" }),
  );
  await writeFile(
    path.join(root, "plan.json"),
    JSON.stringify(options.roadmap ?? usageRoadmap()),
  );
  if (options.ledger !== undefined) {
    await writeFile(
      path.join(root, "usage.json"),
      typeof options.ledger === "string" ? options.ledger : JSON.stringify(options.ledger),
    );
  }
  return root;
}

const withUsage = { dataFile: "plan.json", usageFile: "usage.json" };

function codes(ledger: unknown, roadmap: Roadmap = usageRoadmap()) {
  return validateUsageSemantics(ledger as UsageLedger, roadmap).map((item) => item.code);
}

describe("T01 旧项目兼容", () => {
  it("未配置 usageFile 时校验通过且 usage 为 null（账本文件存在也不加载）", async () => {
    const root = await createProject({ ledger: LEDGER, config: { dataFile: "plan.json" } });
    const result = await validateProject(root);
    expect(result.valid).toBe(true);
    expect(result.usage).toBeNull();
    expect(result.diagnostics).toEqual([]);
  });

  it("未配置 usageFile 时 CLI validate 退出码与输出不变", async () => {
    const root = await createProject({ config: { dataFile: "plan.json" } });
    const outcome = await runValidate(root);
    expect(outcome).toEqual({
      exitCode: 0,
      stdout: ["校验通过：3 个需求"],
      stderr: [],
    });
  });

  it("既有 CONFIG_INVALID 行为不变（未知字段仍然拒绝）", async () => {
    const root = await createProject({ config: { dataFile: "plan.json", extra: 1 } });
    const result = await validateProject(root);
    expect(result.valid).toBe(false);
    expect(result.diagnostics[0]?.code).toBe("CONFIG_INVALID");
    expect(result.usage).toBeNull();
  });

  it("路线数据本身非法时提前返回且 usage 为 null", async () => {
    const root = await createProject({
      ledger: LEDGER,
      config: withUsage,
      roadmap: { schemaVersion: 1, project: { id: "x" } } as unknown as Roadmap,
    });
    const result = await validateProject(root);
    expect(result.valid).toBe(false);
    expect(result.diagnostics.some((item) => item.code === "SCHEMA_INVALID")).toBe(true);
    expect(result.usage).toBeNull();
  });
});

describe("T03 数据错误诊断", () => {
  it("文件缺失与不可解析都报 USAGE_FILE_INVALID", async () => {
    const missing = await createProject({ config: withUsage });
    const missingResult = await validateProject(missing);
    expect(missingResult.valid).toBe(false);
    expect(missingResult.usage).toBeNull();
    expect(missingResult.diagnostics).toEqual([
      expect.objectContaining({ code: "USAGE_FILE_INVALID", path: "usage.json" }),
    ]);

    const broken = await createProject({ ledger: "{ 不是合法 JSON", config: withUsage });
    const brokenResult = await validateProject(broken);
    expect(brokenResult.valid).toBe(false);
    expect(brokenResult.diagnostics.some((item) => item.code === "USAGE_FILE_INVALID")).toBe(true);
  });

  it("schemaVersion 不是 1 报 USAGE_SCHEMA_INVALID", async () => {
    const root = await createProject({
      ledger: { ...LEDGER, schemaVersion: 2 },
      config: withUsage,
    });
    const result = await validateProject(root);
    expect(result.valid).toBe(false);
    expect(result.usage).toBeNull();
    expect(result.diagnostics.every((item) => item.code === "USAGE_SCHEMA_INVALID")).toBe(true);
  });

  it("非法 Token（负数/小数/字符串/null）报 USAGE_SCHEMA_INVALID", async () => {
    const cases: unknown[] = [-1, 1.5, "100", null];
    for (const value of cases) {
      const root = await createProject({
        ledger: {
          schemaVersion: 1,
          events: [
            {
              id: "evt-bad",
              taskId: "T1",
              occurredAt: "2026-10-10T09:30:00+08:00",
              provider: "alpha",
              modelId: "model-a",
              role: "开发执行",
              source: "manual",
              confidence: "measured",
              usage: { inputTokens: value, outputTokens: 10 },
            },
          ],
        },
        config: withUsage,
      });
      const result = await validateProject(root);
      expect(result.valid, JSON.stringify(value)).toBe(false);
      expect(result.usage, JSON.stringify(value)).toBeNull();
      expect(
        result.diagnostics.every((item) => item.code === "USAGE_SCHEMA_INVALID"),
        JSON.stringify(value),
      ).toBe(true);
    }
  });

  it("outputTokens 缺失被 Schema 拒绝（不允许缺字段当 0）", async () => {
    const missingField = await createProject({
      ledger: {
        schemaVersion: 1,
        events: [
          {
            id: "evt-bad",
            taskId: "T1",
            occurredAt: "2026-10-10T09:30:00+08:00",
            provider: "alpha",
            modelId: "model-a",
            role: "开发执行",
            source: "manual",
            confidence: "measured",
            usage: { inputTokens: 1 },
          },
        ],
      },
      config: withUsage,
    });
    const result = await validateProject(missingField);
    expect(result.valid).toBe(false);
    expect(result.diagnostics.some((item) => item.code === "USAGE_SCHEMA_INVALID")).toBe(true);
  });

  it("额外字段被 Schema 拒绝（additionalProperties: false）", async () => {
    const root = await createProject({
      ledger: { ...LEDGER, unexpected: true },
      config: withUsage,
    });
    const result = await validateProject(root);
    expect(result.valid).toBe(false);
    expect(result.diagnostics.some((item) => item.code === "USAGE_SCHEMA_INVALID")).toBe(true);
  });

  it("厨房脏账本一次覆盖全部 12 个语义诊断码", () => {
    const dirty: UsageLedger = {
      schemaVersion: 1,
      project: "wrong-project",
      prices: [
        PRICES[0]!,
        { ...PRICES[0]! },
        {
          id: "p-bad-window",
          provider: "alpha",
          modelId: "model-a",
          currency: "CNY",
          unitTokens: 1000,
          inputPricePerUnit: 1,
          outputPricePerUnit: 1,
          effectiveFrom: "2026-10-05T00:00:00Z",
          effectiveTo: "2026-10-01T00:00:00Z",
          basis: "窗口非法且重叠",
        },
        PRICES[2]!,
      ],
      events: [
        event("evt-dup", "T1", { usage: { inputTokens: 10, outputTokens: 5 }, priceId: "p-a-oct" }),
        event("evt-dup", "T1", { usage: { inputTokens: 10, outputTokens: 5 } }),
        event("evt-dangling", "T-404", { usage: { inputTokens: 10, outputTokens: 5 } }),
        event("evt-unknown-price", "T1", {
          usage: { inputTokens: 10, outputTokens: 5 },
          priceId: "p-missing",
        }),
        event("evt-mismatch", "T1", {
          provider: "beta",
          modelId: "model-b",
          usage: { inputTokens: 10, outputTokens: 5 },
          priceId: "p-a-oct",
        }),
        event("evt-expired", "T1", {
          occurredAt: "2026-12-01T00:00:00Z",
          usage: { inputTokens: 10, outputTokens: 5 },
          priceId: "p-a-oct",
        }),
        event("evt-conflict", "T1", {
          usage: { inputTokens: 10, outputTokens: 5 },
          priceId: "p-a-oct",
          cost: { basis: "actual", currency: "CNY", amount: 1, priceId: "p-b-usd" },
        }),
        event("evt-currency", "T1", {
          usage: { inputTokens: 10, outputTokens: 5 },
          cost: { basis: "actual", currency: "USD", amount: 1, priceId: "p-a-oct" },
        }),
        event("evt-subtotal-input", "T1", {
          usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 11 },
        }),
        event("evt-subtotal-output", "T1", {
          usage: { inputTokens: 10, outputTokens: 5, reasoningTokens: 6 },
        }),
      ],
    };
    const found = new Set(codes(dirty));
    const expected: DiagnosticCode[] = [
      "USAGE_DUPLICATE_EVENT_ID",
      "USAGE_DUPLICATE_PRICE_ID",
      "USAGE_UNKNOWN_TASK",
      "USAGE_UNKNOWN_PRICE",
      "USAGE_PRICE_MODEL_MISMATCH",
      "USAGE_PRICE_NOT_EFFECTIVE",
      "USAGE_PRICE_REF_CONFLICT",
      "USAGE_CURRENCY_MISMATCH",
      "USAGE_TOKEN_SUBTOTAL_EXCEEDED",
      "USAGE_INVALID_PRICE_WINDOW",
      "USAGE_OVERLAPPING_PRICE",
      "USAGE_PROJECT_MISMATCH",
    ];
    expect([...found].sort()).toEqual([...expected].sort());
  });

  it("每个诊断都带 path，且 CLI 退出码为 1", async () => {
    const root = await createProject({
      ledger: { ...LEDGER, events: [event("evt-dup", "T1", { usage: { inputTokens: 1, outputTokens: 1 } }), event("evt-dup", "T1", { usage: { inputTokens: 1, outputTokens: 1 } })] },
      config: withUsage,
    });
    const result = await validateProject(root);
    expect(result.valid).toBe(false);
    expect(result.usage).toBeNull();
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: "USAGE_DUPLICATE_EVENT_ID",
        path: "/events/evt-dup",
      }),
    ]);
    const outcome = await runValidate(root);
    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr.join("\n")).toContain("[USAGE_DUPLICATE_EVENT_ID]");
    expect(outcome.stdout).toEqual([]);
  });

  it("USAGE_TOKEN_SUBTOTAL_EXCEEDED 指向具体 usage 字段", () => {
    const found = validateUsageSemantics(
      {
        schemaVersion: 1,
        events: [
          event("evt-c", "T1", { usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 11 } }),
          event("evt-r", "T1", { usage: { inputTokens: 10, outputTokens: 5, reasoningTokens: 6 } }),
        ],
      } as UsageLedger,
      usageRoadmap(),
    );
    expect(found).toEqual([
      expect.objectContaining({
        code: "USAGE_TOKEN_SUBTOTAL_EXCEEDED",
        path: "/events/evt-c/usage/cachedInputTokens",
      }),
      expect.objectContaining({
        code: "USAGE_TOKEN_SUBTOTAL_EXCEEDED",
        path: "/events/evt-r/usage/reasoningTokens",
      }),
    ]);
  });
});

describe("T10 价格引用有效期", () => {
  it("显式引用过期/未生效价格报 USAGE_PRICE_NOT_EFFECTIVE", () => {
    const expired = codes({
      schemaVersion: 1,
      prices: PRICES,
      events: [
        event("evt-late", "T1", {
          occurredAt: "2026-12-01T00:00:00Z",
          usage: { inputTokens: 10, outputTokens: 5 },
          priceId: "p-a-oct",
        }),
      ],
    });
    expect(expired).toEqual(["USAGE_PRICE_NOT_EFFECTIVE"]);

    const early = codes({
      schemaVersion: 1,
      prices: PRICES,
      events: [
        event("evt-early", "T1", {
          occurredAt: "2026-09-01T00:00:00Z",
          usage: { inputTokens: 10, outputTokens: 5 },
          priceId: "p-a-nov",
        }),
      ],
    });
    expect(early).toEqual(["USAGE_PRICE_NOT_EFFECTIVE"]);
  });

  it("provider/modelId 错配报 USAGE_PRICE_MODEL_MISMATCH", () => {
    const found = codes({
      schemaVersion: 1,
      prices: PRICES,
      events: [
        event("evt-mismatch", "T1", {
          provider: "beta",
          modelId: "model-b",
          usage: { inputTokens: 10, outputTokens: 5 },
          priceId: "p-a-oct",
        }),
      ],
    });
    expect(found).toEqual(["USAGE_PRICE_MODEL_MISMATCH"]);
  });

  it("cost.priceId 过期时路径指向 cost.priceId", () => {
    const found = validateUsageSemantics(
      {
        schemaVersion: 1,
        prices: PRICES,
        events: [
          event("evt-cost-expired", "T1", {
            occurredAt: "2026-12-01T00:00:00Z",
            usage: { inputTokens: 10, outputTokens: 5 },
            cost: { basis: "actual", currency: "CNY", amount: 1, priceId: "p-a-oct" },
          }),
        ],
      } as UsageLedger,
      usageRoadmap(),
    );
    expect(found).toEqual([
      expect.objectContaining({
        code: "USAGE_PRICE_NOT_EFFECTIVE",
        path: "/events/evt-cost-expired/cost/priceId",
      }),
    ]);
  });

  it("校验失败时 usage 为 null，不会进入汇总", async () => {
    const root = await createProject({
      ledger: {
        schemaVersion: 1,
        prices: PRICES,
        events: [
          event("evt-late", "T1", {
            occurredAt: "2026-12-01T00:00:00Z",
            usage: { inputTokens: 10, outputTokens: 5 },
            priceId: "p-a-oct",
          }),
        ],
      },
      config: withUsage,
    });
    const result = await validateProject(root);
    expect(result.valid).toBe(false);
    expect(result.usage).toBeNull();
    expect(result.diagnostics.map((item) => item.code)).toContain("USAGE_PRICE_NOT_EFFECTIVE");
  });
});

describe("T11 双 priceId 职责", () => {
  it("只有顶层 priceId：按快照估算并通过校验", async () => {
    const root = await createProject({ ledger: LEDGER, config: withUsage });
    const result = await validateProject(root);
    expect(result.valid).toBe(true);
    expect(result.usage?.enabled).toBe(true);
    expect(result.usage?.summary.byTask["T1"]!.costEstimated).toEqual({ CNY: 0.04, USD: 0.01 });
  });

  it("只有 cost.priceId：登记费用生效", async () => {
    const root = await createProject({
      ledger: {
        schemaVersion: 1,
        prices: PRICES,
        events: [
          event("evt-costref", "T1", {
            usage: { inputTokens: 1000, outputTokens: 100 },
            cost: { basis: "actual", currency: "CNY", amount: 2.5, priceId: "p-a-oct" },
          }),
        ],
      },
      config: withUsage,
    });
    const result = await validateProject(root);
    expect(result.valid).toBe(true);
    expect(result.usage?.summary.totals.costActual).toEqual({ CNY: 2.5 });
    expect(result.usage?.summary.totals.costEstimated).toEqual({});
  });

  it("两者一致：均生效", async () => {
    const root = await createProject({
      ledger: {
        schemaVersion: 1,
        prices: PRICES,
        events: [
          event("evt-both", "T1", {
            usage: { inputTokens: 1000, outputTokens: 100 },
            priceId: "p-a-oct",
            cost: { basis: "actual", currency: "CNY", amount: 2.5, priceId: "p-a-oct" },
          }),
        ],
      },
      config: withUsage,
    });
    const result = await validateProject(root);
    expect(result.valid).toBe(true);
    expect(result.usage?.summary.totals.costActual).toEqual({ CNY: 2.5 });
  });

  it("两者不一致：USAGE_PRICE_REF_CONFLICT 失败", async () => {
    const root = await createProject({
      ledger: {
        schemaVersion: 1,
        prices: PRICES,
        events: [
          event("evt-conflict", "T1", {
            usage: { inputTokens: 1000, outputTokens: 100 },
            priceId: "p-a-oct",
            cost: { basis: "actual", currency: "CNY", amount: 2.5, priceId: "p-a-nov" },
          }),
        ],
      },
      config: withUsage,
    });
    const result = await validateProject(root);
    expect(result.valid).toBe(false);
    expect(result.usage).toBeNull();
    expect(result.diagnostics[0]).toEqual(
      expect.objectContaining({
        code: "USAGE_PRICE_REF_CONFLICT",
        path: "/events/evt-conflict/priceId",
      }),
    );
  });
});

describe("合法账本与空账本", () => {
  it("合法账本校验通过并产出 usage 载荷", async () => {
    const root = await createProject({ ledger: LEDGER, config: withUsage });
    const result = await validateProject(root);
    expect(result.valid).toBe(true);
    expect(result.data?.requirements).toHaveLength(3);
    const usage = result.usage!;
    expect(usage.enabled).toBe(true);
    expect(usage.ledger).toEqual(LEDGER);
    expect(usage.summary.totals.eventCount).toBe(11);
    expect(usage.summary.totals.tokens).toEqual({
      input: 52400,
      output: 13050,
      cachedInput: 16000,
      reasoning: 3200,
    });
    expect(usage.summary.totals.costActual).toEqual({ CNY: 0.02, USD: 0.05 });
    expect(usage.summary.totals.costEstimated).toEqual({ CNY: 0.13, USD: 0.03 });
    expect(usage.summary.totals.unknownCostEventCount).toBe(3);
    expect(Object.keys(usage.summary.byRelease).sort()).toEqual(["v1", "v2"]);
  });

  it("空 events 是合法状态：启用但暂无数据", async () => {
    const root = await createProject({
      ledger: { schemaVersion: 1, project: "usage-demo", prices: PRICES, events: [] },
      config: withUsage,
    });
    const result = await validateProject(root);
    expect(result.valid).toBe(true);
    expect(result.usage?.enabled).toBe(true);
    expect(result.usage?.summary.totals.eventCount).toBe(0);
    expect(result.usage?.summary.totals.costActual).toEqual({});
    expect(result.usage?.summary.byTask).toEqual({});
  });

  it("project 缺省时不校验项目一致性", async () => {
    const root = await createProject({
      ledger: { schemaVersion: 1, events: [] },
      config: withUsage,
    });
    const result = await validateProject(root);
    expect(result.valid).toBe(true);
    expect(result.usage?.enabled).toBe(true);
  });
});

describe("usageFile 路径安全与配置校验", () => {
  it("绝对路径、向上逃逸、非字符串都报 CONFIG_INVALID", async () => {
    const cases: Record<string, unknown>[] = [
      { dataFile: "plan.json", usageFile: "C:/windows/win.ini" },
      { dataFile: "plan.json", usageFile: "../outside.json" },
      { dataFile: "plan.json", usageFile: 42 },
    ];
    for (const config of cases) {
      const root = await createProject({ ledger: LEDGER, config });
      const result = await validateProject(root);
      expect(result.valid, JSON.stringify(config)).toBe(false);
      expect(result.diagnostics[0]?.code, JSON.stringify(config)).toBe("CONFIG_INVALID");
      expect(result.usage).toBeNull();
    }
  });

  it("缺失的中间目录按 USAGE_FILE_INVALID 处理而非崩溃", async () => {
    const root = await createProject({
      config: { dataFile: "plan.json", usageFile: "missing-dir/usage.json" },
    });
    const result = await validateProject(root);
    expect(result.valid).toBe(false);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: "USAGE_FILE_INVALID", path: "missing-dir/usage.json" }),
    ]);
    expect(result.usage).toBeNull();
  });
});
