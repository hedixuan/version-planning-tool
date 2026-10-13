import { describe, expect, it } from "vitest";
import type { Requirement, Roadmap, Status } from "../src/types";
import {
  EMPTY_FILTERS,
  calculateReleaseProgress,
  calculateStats,
  filterRequirements,
  getFilterOptions,
  hasActiveFilters,
  sortRequirements,
} from "../src/web/lib/view-model";

function item(
  id: string,
  status: Status,
  overrides: Partial<Requirement> = {},
): Requirement {
  return {
    id,
    title: `需求 ${id}`,
    releaseId: "r1",
    status,
    dependsOn: [],
    acceptance: ["可验证"],
    evidence: [],
    ...overrides,
  };
}

const sample: Requirement[] = [
  item("a", "blocked", {
    title: "登录阻塞",
    priority: "high",
    owner: "Ada",
    tags: ["web", "auth"],
    dependsOn: ["missing"],
    updatedAt: "2026-10-01T00:00:00.000Z",
  }),
  item("b", "review", {
    title: "接口验收",
    priority: "low",
    owner: "Ben",
    tags: ["api"],
    releaseId: "r2",
    updatedAt: "2026-10-02T00:00:00.000Z",
  }),
  item("c", "done", {
    title: "文档完成",
    priority: "medium",
    owner: "Ada",
    tags: ["docs"],
    updatedAt: "2026-09-01T00:00:00.000Z",
  }),
];

const roadmap: Roadmap = {
  schemaVersion: 1,
  project: { id: "demo", name: "示例" },
  releases: [
    { id: "r1", name: "首版", status: "in_progress" },
    { id: "r2", name: "二版", status: "ready" },
  ],
  requirements: sample,
};

describe("组合筛选", () => {
  it("按文本、状态、版本、优先级、负责人和标签组合筛选", () => {
    expect(
      filterRequirements(sample, {
        ...EMPTY_FILTERS,
        query: "登录",
        statuses: ["blocked"],
        releaseIds: ["r1"],
        priorities: ["high"],
        owners: ["Ada"],
        tags: ["web"],
      }).map((item) => item.id),
    ).toEqual(["a"]);
    expect(
      filterRequirements(sample, { ...EMPTY_FILTERS, tags: ["web", "missing"] }),
    ).toHaveLength(0);
  });

  it("识别活动筛选并提取筛选项", () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, query: "a" })).toBe(true);
    expect(getFilterOptions(roadmap)).toEqual({
      priorities: ["high", "low", "medium"],
      owners: ["Ada", "Ben"],
      tags: ["api", "auth", "docs", "web"],
    });
  });
});

describe("排序与统计", () => {
  it("按优先级、更新时间和标题排序", () => {
    expect(sortRequirements(sample, "priority").map((item) => item.id)).toEqual([
      "a",
      "c",
      "b",
    ]);
    expect(sortRequirements(sample, "updatedAt").map((item) => item.id)).toEqual([
      "b",
      "a",
      "c",
    ]);
    expect(sortRequirements(sample, "title").map((item) => item.id)).toEqual(
      [...sample]
        .sort((left, right) => left.title.localeCompare(right.title, "zh-CN"))
        .map((item) => item.id),
    );
  });

  it("计算状态统计、关注队列和版本进度", () => {
    const stats = calculateStats(sample);
    expect(stats.blocked).toBe(1);
    expect(stats.review).toBe(1);
    expect(stats.done).toBe(1);
    expect(stats.completion).toBe(33);
    expect(stats.attention.map((item) => item.id)).toEqual(["a", "b"]);
    expect(calculateReleaseProgress(roadmap.releases[0]!, sample)).toEqual({
      total: 2,
      done: 1,
      percent: 50,
    });
  });
});
