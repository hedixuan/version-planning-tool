import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "../src/server";
import type { UsageApiPayload } from "../src/types";
import { LEDGER, usageRoadmap } from "./usage-fixtures";

const temporaryPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryPaths.splice(0).map((target) => rm(target, { recursive: true, force: true })),
  );
});

async function createProject(options: {
  ledger?: unknown;
  config?: Record<string, unknown>;
}): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "version-plan-api-"));
  temporaryPaths.push(root);
  await writeFile(
    path.join(root, "version-plan.config.json"),
    JSON.stringify(options.config ?? { dataFile: "plan.json" }),
  );
  await writeFile(path.join(root, "plan.json"), JSON.stringify(usageRoadmap()));
  if (options.ledger !== undefined) {
    await writeFile(path.join(root, "usage.json"), JSON.stringify(options.ledger));
  }
  return root;
}

const withUsage = { dataFile: "plan.json", usageFile: "usage.json" };

describe("T01 只读 API 兼容", () => {
  it("未配置 usageFile 时既有字段不变且附带 usage: null", async () => {
    const root = await createProject({ ledger: LEDGER, config: { dataFile: "plan.json" } });
    const app = await buildServer(root, { serveStatic: false });
    const response = await app.inject({ method: "GET", url: "/api/roadmap" });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.valid).toBe(true);
    expect(body.diagnostics).toEqual([]);
    expect(body.data.project.id).toBe("usage-demo");
    expect(body.data.requirements).toHaveLength(3);
    expect(body.usage).toBeNull();
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    await app.close();
  });

  it("不提供任何写接口", async () => {
    const root = await createProject({ config: withUsage, ledger: LEDGER });
    const app = await buildServer(root, { serveStatic: false });
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const response = await app.inject({ method, url: "/api/roadmap", payload: {} });
      expect(response.statusCode).toBe(404);
    }
    const files = await app.inject({ method: "GET", url: "/api/files?path=../x" });
    expect(files.statusCode).toBe(404);
    await app.close();
  });
});

describe("用量只读 API（契约 §10）", () => {
  it("配置合法账本时返回 enabled/ledger/summary", async () => {
    const root = await createProject({ ledger: LEDGER, config: withUsage });
    const app = await buildServer(root, { serveStatic: false });
    const response = await app.inject({ method: "GET", url: "/api/roadmap" });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.valid).toBe(true);
    const usage = body.usage as UsageApiPayload;
    expect(usage.enabled).toBe(true);
    expect(usage.ledger.schemaVersion).toBe(1);
    expect(usage.ledger.events).toHaveLength(11);
    expect(usage.ledger.prices).toHaveLength(4);
    expect(usage.summary.totals.eventCount).toBe(11);
    expect(usage.summary.totals.tokens.input).toBe(52400);
    expect(usage.summary.totals.confidence.measured.eventCount).toBe(7);
    expect(Object.keys(usage.summary.byTask).sort()).toEqual(["T1", "T2", "T3"]);
    await app.close();
  });

  it("账本校验失败时 usage 为 null 且 diagnostics 含用量诊断码", async () => {
    const root = await createProject({
      config: withUsage,
      ledger: {
        schemaVersion: 1,
        events: [
          {
            id: "evt-dangling",
            taskId: "T-404",
            occurredAt: "2026-10-10T09:30:00+08:00",
            provider: "alpha",
            modelId: "model-a",
            role: "开发执行",
            source: "manual",
            confidence: "measured",
            usage: { inputTokens: 10, outputTokens: 5 },
          },
        ],
      },
    });
    const app = await buildServer(root, { serveStatic: false });
    const response = await app.inject({ method: "GET", url: "/api/roadmap" });
    const body = response.json();
    expect(body.valid).toBe(false);
    expect(body.usage).toBeNull();
    expect(body.diagnostics.map((item: { code: string }) => item.code)).toContain(
      "USAGE_UNKNOWN_TASK",
    );
    await app.close();
  });

  it("空账本返回 enabled 且 summary 全零（T08 空数据边界）", async () => {
    const root = await createProject({
      config: withUsage,
      ledger: { schemaVersion: 1, project: "usage-demo", events: [] },
    });
    const app = await buildServer(root, { serveStatic: false });
    const body = (await app.inject({ method: "GET", url: "/api/roadmap" })).json();
    expect(body.valid).toBe(true);
    expect(body.usage.enabled).toBe(true);
    expect(body.usage.summary.totals).toMatchObject({
      eventCount: 0,
      taskCount: 0,
      modelCount: 0,
      tokens: { input: 0, output: 0, cachedInput: 0, reasoning: 0 },
      costActual: {},
      costEstimated: {},
      unknownCostEventCount: 0,
      assumptions: [],
    });
    await app.close();
  });

  it("会话令牌与来源校验不因用量字段而改变", async () => {
    const root = await createProject({ ledger: LEDGER, config: withUsage });
    const session = { token: "test-session-token", origin: "http://127.0.0.1:4173" };
    const app = await buildServer(root, { serveStatic: false, session });
    expect(
      (await app.inject({ method: "GET", url: "/api/roadmap" })).statusCode,
    ).toBe(401);
    const ok = await app.inject({
      method: "GET",
      url: "/api/roadmap",
      headers: {
        "x-version-plan-origin": session.origin,
        "x-version-plan-token": session.token,
        "sec-fetch-site": "same-origin",
      },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().usage.enabled).toBe(true);
    await app.close();
  });
});
