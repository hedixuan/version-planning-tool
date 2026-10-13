/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadRoadmap } from "../src/web/lib/api";

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
          data: { schemaVersion: 1, project: { id: "p", name: "P" }, releases: [], requirements: [] },
          diagnostics: [],
        }),
      }),
    );
    await expect(loadRoadmap("token")).resolves.toMatchObject({
      project: { id: "p" },
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
