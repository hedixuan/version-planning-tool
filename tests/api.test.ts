/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadRoadmap } from "../src/web/lib/api";
import { buildUsageSummary } from "../src/usage";
import type { UsageApiPayload } from "../src/types";
import { LEDGER, RELEASE_BY_TASK } from "./usage-fixtures";

const roadmapData = {
  schemaVersion: 1,
  project: { id: "p", name: "P" },
  releases: [],
  requirements: [],
};

const usagePayload: UsageApiPayload = {
  enabled: true,
  ledger: LEDGER,
  summary: buildUsageSummary(LEDGER.events, LEDGER.prices ?? [], RELEASE_BY_TASK),
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadRoadmap", () => {
  it("成功时返回路线数据", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          valid: true,
          data: roadmapData,
          usage: null,
          diagnostics: [],
        }),
      }),
    );
    await expect(loadRoadmap("token")).resolves.toMatchObject({
      roadmap: { project: { id: "p" } },
      usage: null,
    });
  });

  it("附带 usage 载荷时原样透传", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          valid: true,
          data: roadmapData,
          usage: usagePayload,
          diagnostics: [],
        }),
      }),
    );
    const payload = await loadRoadmap("token");
    expect(payload.usage).toEqual(usagePayload);
    expect(payload.usage?.summary.totals.eventCount).toBe(11);
  });

  it("旧服务不返回 usage 字段时按未启用处理", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          valid: true,
          data: roadmapData,
          diagnostics: [],
        }),
      }),
    );
    await expect(loadRoadmap("token")).resolves.toMatchObject({
      roadmap: { project: { id: "p" } },
      usage: null,
    });
  });

  it("HTTP 失败和校验失败都转为明确错误", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    await expect(loadRoadmap("token")).rejects.toThrow("服务返回 403");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          valid: false,
          diagnostics: [{ message: "缺少名称" }],
        }),
      }),
    );
    await expect(loadRoadmap("token")).rejects.toThrow("缺少名称");
  });
});
