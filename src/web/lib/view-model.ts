import { STATUSES, type Release, type Requirement, type Roadmap, type Status } from "../../types";
import { PRIORITY_META } from "./meta";

export type SortKey = "updatedAt" | "priority" | "id" | "title";

export interface Filters {
  query: string;
  statuses: Status[];
  releaseIds: string[];
  priorities: string[];
  owners: string[];
  tags: string[];
}

export const EMPTY_FILTERS: Filters = {
  query: "",
  statuses: [],
  releaseIds: [],
  priorities: [],
  owners: [],
  tags: [],
};

export function filterRequirements(items: Requirement[], filters: Filters): Requirement[] {
  const query = filters.query.trim().toLocaleLowerCase();
  return items.filter((item) => {
    const searchable = [
      item.id,
      item.title,
      item.owner ?? "",
      item.releaseId,
      ...(item.tags ?? []),
    ]
      .join(" ")
      .toLocaleLowerCase();
    return (
      (!query || searchable.includes(query)) &&
      (!filters.statuses.length || filters.statuses.includes(item.status)) &&
      (!filters.releaseIds.length || filters.releaseIds.includes(item.releaseId)) &&
      (!filters.priorities.length ||
        (item.priority !== undefined && filters.priorities.includes(item.priority))) &&
      (!filters.owners.length || filters.owners.includes(item.owner ?? "")) &&
      (!filters.tags.length ||
        filters.tags.every((tag) => (item.tags ?? []).includes(tag)))
    );
  });
}

export function sortRequirements(items: Requirement[], sort: SortKey): Requirement[] {
  return [...items].sort((left, right) => {
    if (sort === "priority") {
      const leftRank = PRIORITY_META[left.priority?.toLocaleLowerCase() ?? ""]?.rank ?? 99;
      const rightRank = PRIORITY_META[right.priority?.toLocaleLowerCase() ?? ""]?.rank ?? 99;
      return leftRank - rightRank || left.id.localeCompare(right.id);
    }
    if (sort === "updatedAt") {
      return (right.updatedAt ?? "").localeCompare(left.updatedAt ?? "") ||
        left.id.localeCompare(right.id);
    }
    return left[sort].localeCompare(right[sort], "zh-CN");
  });
}

export function getFilterOptions(roadmap: Roadmap) {
  const unique = (values: (string | null | undefined)[]) =>
    [...new Set(values.filter((value): value is string => Boolean(value)))].sort((a, b) =>
      a.localeCompare(b, "zh-CN"),
    );
  return {
    priorities: unique(roadmap.requirements.map((item) => item.priority)),
    owners: unique(roadmap.requirements.map((item) => item.owner)),
    tags: unique(roadmap.requirements.flatMap((item) => item.tags ?? [])),
  };
}

export interface DashboardStats {
  total: number;
  done: number;
  completion: number;
  inProgress: number;
  blocked: number;
  review: number;
  statusCounts: Record<Status, number>;
  attention: Requirement[];
}

export function calculateStats(items: Requirement[]): DashboardStats {
  const statusCounts = Object.fromEntries(STATUSES.map((status) => [status, 0])) as Record<
    Status,
    number
  >;
  for (const item of items) statusCounts[item.status] += 1;
  const active = items.filter((item) => item.status !== "cancelled");
  const done = statusCounts.done;
  return {
    total: items.length,
    done,
    completion: active.length ? Math.round((done / active.length) * 100) : 0,
    inProgress: statusCounts.in_progress,
    blocked: statusCounts.blocked,
    review: statusCounts.review,
    statusCounts,
    attention: sortRequirements(
      items.filter(
        (item) =>
          item.status === "blocked" ||
          item.status === "review" ||
          item.dependsOn.some((dependency) => !items.some((candidate) => candidate.id === dependency)),
      ),
      "priority",
    ),
  };
}

export function calculateReleaseProgress(release: Release, items: Requirement[]) {
  const releaseItems = items.filter((item) => item.releaseId === release.id);
  const active = releaseItems.filter((item) => item.status !== "cancelled");
  const done = active.filter((item) => item.status === "done").length;
  return {
    total: releaseItems.length,
    done,
    percent: active.length ? Math.round((done / active.length) * 100) : 0,
  };
}

export function hasActiveFilters(filters: Filters): boolean {
  return Boolean(
    filters.query ||
      filters.statuses.length ||
      filters.releaseIds.length ||
      filters.priorities.length ||
      filters.owners.length ||
      filters.tags.length,
  );
}
