import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveProjectFile } from "../src/project";
import { buildServer, isLoopbackHost } from "../src/server";
import {
  aggregateReleaseStatus,
  createRoadmapView,
  filterRequirements,
  validateProject,
  validateSemantics,
} from "../src/validation";
import type { Requirement, Roadmap, Status } from "../src/types";

const temporaryPaths: string[] = [];

function requirement(
  id: string,
  status: Status = "backlog",
  overrides: Partial<Requirement> = {},
): Requirement {
  return {
    id,
    title: `需求 ${id}`,
    releaseId: "release-a",
    status,
    dependsOn: [],
    acceptance: ["可验证"],
    evidence: [],
    ...overrides,
  };
}

function roadmap(requirements = [requirement("item-a")]): Roadmap {
  return {
    schemaVersion: 1,
    project: { id: "demo", name: "示例项目" },
    releases: [{ id: "release-a", name: "首个版本", status: "backlog" }],
    requirements,
  };
}

async function createProject(
  data: unknown,
  config: Record<string, unknown> = { dataFile: "plan.json" },
): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "version-plan-"));
  temporaryPaths.push(root);
  await writeFile(path.join(root, "version-plan.config.json"), JSON.stringify(config));
  await writeFile(path.join(root, "plan.json"), JSON.stringify(data));
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryPaths.splice(0).map((target) => rm(target, { recursive: true, force: true })),
  );
});

describe("配置路径安全", () => {
  it("拒绝向上路径逃逸和绝对路径", async () => {
    const root = await createProject(roadmap());
    await expect(resolveProjectFile(root, "../outside.json")).rejects.toThrow("相对路径");
    await expect(resolveProjectFile(root, path.resolve(root, "plan.json"))).rejects.toThrow(
      "相对路径",
    );
  });

  it("接受规范化后的项目内路径", async () => {
    const root = await createProject(roadmap());
    await mkdir(path.join(root, "data"));
    await writeFile(path.join(root, "data", "plan.json"), "{}");
    await expect(resolveProjectFile(root, "data/./plan.json")).resolves.toBe(
      await import("node:fs/promises").then(({ realpath }) =>
        realpath(path.join(root, "data", "plan.json")),
      ),
    );
  });
});

describe("Schema 与扩展校验", () => {
  it("通过合法数据并拒绝基础 Schema 错误", async () => {
    const validRoot = await createProject(roadmap());
    expect(await validateProject(validRoot)).toMatchObject({ valid: true });

    const invalidRoot = await createProject({ project: {} });
    const result = await validateProject(invalidRoot);
    expect(result.valid).toBe(false);
    expect(result.diagnostics.some((item) => item.code === "SCHEMA_INVALID")).toBe(true);
  });

  it("应用消费项目的扩展 Schema", async () => {
    const root = await createProject(roadmap(), {
      dataFile: "plan.json",
      schemaFile: "custom.schema.json",
    });
    await writeFile(
      path.join(root, "custom.schema.json"),
      JSON.stringify({
        type: "object",
        properties: {
          project: {
            type: "object",
            properties: { id: { type: "string", pattern: "^CUSTOM-" } },
          },
        },
      }),
    );
    const result = await validateProject(root);
    expect(result.valid).toBe(false);
    expect(result.diagnostics[0]?.code).toBe("EXTENSION_SCHEMA_INVALID");
  });
});

describe("语义校验", () => {
  it("报告重复 ID、未知版本和断裂依赖", () => {
    const data = roadmap([
      requirement("same", "backlog", { dependsOn: ["missing"] }),
      requirement("same", "backlog", { releaseId: "unknown" }),
    ]);
    data.releases.push({ ...data.releases[0]! });
    const codes = validateSemantics(data).map((item) => item.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        "DUPLICATE_RELEASE_ID",
        "DUPLICATE_REQUIREMENT_ID",
        "UNKNOWN_RELEASE",
        "BROKEN_DEPENDENCY",
      ]),
    );
  });

  it("检测多节点循环依赖", () => {
    const data = roadmap([
      requirement("a", "backlog", { dependsOn: ["b"] }),
      requirement("b", "backlog", { dependsOn: ["c"] }),
      requirement("c", "backlog", { dependsOn: ["a"] }),
    ]);
    expect(validateSemantics(data)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "CYCLIC_DEPENDENCY" }),
      ]),
    );
  });
});

describe("版本聚合", () => {
  it.each([
    [["cancelled"], "cancelled"],
    [["done", "cancelled"], "done"],
    [["review", "done"], "in_progress"],
    [["in_progress", "blocked"], "in_progress"],
    [["ready", "blocked"], "ready"],
    [["blocked", "blocked"], "blocked"],
    [["backlog", "blocked"], "backlog"],
  ] as [Status[], Status][])("%j 聚合为 %s", (statuses, expected) => {
    expect(aggregateReleaseStatus(statuses.map((item, index) => requirement(`${index}`, item)))).toBe(
      expected,
    );
  });

  it("报告版本聚合状态不一致", () => {
    const data = roadmap([requirement("a", "done")]);
    expect(validateSemantics(data)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "RELEASE_STATUS_MISMATCH" }),
      ]),
    );
  });
});

describe("筛选与数据视图", () => {
  const data = roadmap([
    requirement("first", "ready", { title: "登录页面", tags: ["web"] }),
    requirement("second", "done", { title: "服务接口", tags: ["api"] }),
  ]);
  data.releases[0]!.status = "ready";

  it("按文本、状态与版本筛选", () => {
    expect(filterRequirements(data.requirements, { query: "WEB" })).toHaveLength(1);
    expect(filterRequirements(data.requirements, { status: "done" })[0]?.id).toBe("second");
    expect(
      filterRequirements(data.requirements, { releaseId: "missing" }),
    ).toHaveLength(0);
  });

  it("按版本与全部七种状态建立视图", () => {
    const view = createRoadmapView(data);
    expect(view.requirementsByRelease["release-a"]).toHaveLength(2);
    expect(Object.keys(view.requirementsByStatus)).toHaveLength(7);
    expect(view.requirementsByStatus.ready[0]?.id).toBe("first");
  });
});

describe("HTTP 只读路由", () => {
  it("提供健康检查、路线数据、安全头并拒绝未知 API", async () => {
    const root = await createProject(roadmap());
    const app = await buildServer(root, { serveStatic: false });
    const health = await app.inject({ method: "GET", url: "/__health" });
    expect(health.json()).toEqual({ ok: true });
    expect(health.headers["x-content-type-options"]).toBe("nosniff");

    const response = await app.inject({ method: "GET", url: "/api/roadmap" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ valid: true });
    expect(response.headers["cache-control"]).toBe("no-store");

    const missing = await app.inject({ method: "GET", url: "/api/files?path=../x" });
    expect(missing.statusCode).toBe(404);
    await app.close();
  });

  it("生产会话同时校验令牌和请求来源", async () => {
    const root = await createProject(roadmap());
    const session = {
      token: "test-session-token",
      origin: "http://127.0.0.1:4173",
    };
    const app = await buildServer(root, { serveStatic: false, session });

    expect(
      (await app.inject({ method: "GET", url: "/api/roadmap" })).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/roadmap",
          headers: {
            origin: "http://malicious.example",
            "x-version-plan-token": session.token,
          },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/roadmap",
          headers: {
            "x-version-plan-origin": session.origin,
            "x-version-plan-token": session.token,
            "sec-fetch-site": "same-origin",
          },
        })
      ).statusCode,
    ).toBe(200);
    await app.close();
  });

  it("只接受 loopback host", () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("127.20.30.40")).toBe(true);
    expect(isLoopbackHost("::1")).toBe(true);
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("0.0.0.0")).toBe(false);
    expect(isLoopbackHost("192.168.1.2")).toBe(false);
  });
});
