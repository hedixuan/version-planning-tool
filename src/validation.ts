import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { Ajv2020, type AnySchema, type ErrorObject } from "ajv/dist/2020.js";
import type { FormatsPlugin } from "ajv-formats";
import { loadProjectConfig, ProjectConfigError, readJsonFile } from "./project.js";
import {
  STATUSES,
  type Diagnostic,
  type Requirement,
  type Roadmap,
  type RoadmapView,
  type Status,
  type UsageApiPayload,
  type UsageEvent,
  type UsageLedger,
  type UsagePrice,
  type ValidationResult,
} from "./types.js";
import { buildUsageSummary, priceWindowCovers } from "./usage.js";

const baseSchemaPath = fileURLToPath(
  new URL("../schema/roadmap.schema.json", import.meta.url),
);
const usageSchemaPath = fileURLToPath(
  new URL("../schema/usage.schema.json", import.meta.url),
);
const addFormats = createRequire(import.meta.url)("ajv-formats") as FormatsPlugin;

function schemaDiagnostics(
  errors: ErrorObject[] | null | undefined,
  code: "SCHEMA_INVALID" | "EXTENSION_SCHEMA_INVALID" | "USAGE_SCHEMA_INVALID",
): Diagnostic[] {
  return (errors ?? []).map((error) => ({
    code,
    path: error.instancePath || "/",
    message: `${error.instancePath || "/"} ${error.message ?? "不符合 Schema"}`,
  }));
}

export function aggregateReleaseStatus(requirements: Requirement[]): Status {
  const active = requirements.filter((item) => item.status !== "cancelled");
  if (active.length === 0) return "cancelled";
  if (active.every((item) => item.status === "done")) return "done";
  if (active.some((item) => item.status === "in_progress" || item.status === "review")) {
    return "in_progress";
  }
  if (active.some((item) => item.status === "ready")) return "ready";
  if (active.every((item) => item.status === "blocked")) return "blocked";
  return "backlog";
}

function duplicateDiagnostics(
  values: { id: string }[],
  code: "DUPLICATE_RELEASE_ID" | "DUPLICATE_REQUIREMENT_ID",
): Diagnostic[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value.id)) duplicates.add(value.id);
    seen.add(value.id);
  }
  return [...duplicates].map((id) => ({
    code,
    message: `ID 重复：${id}`,
  }));
}

function dependencyDiagnostics(roadmap: Roadmap): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const ids = new Set(roadmap.requirements.map((item) => item.id));
  const graph = new Map(
    roadmap.requirements.map((item) => [
      item.id,
      item.dependsOn.filter((dependency) => ids.has(dependency)),
    ]),
  );

  for (const requirement of roadmap.requirements) {
    for (const dependency of requirement.dependsOn) {
      if (!ids.has(dependency)) {
        diagnostics.push({
          code: "BROKEN_DEPENDENCY",
          path: `/requirements/${requirement.id}/dependsOn`,
          message: `需求 ${requirement.id} 依赖不存在的需求 ${dependency}`,
        });
      }
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];
  const reported = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) {
      const start = stack.indexOf(id);
      const cycle = [...stack.slice(start), id];
      const key = [...new Set(cycle)].sort().join("\0");
      if (!reported.has(key)) {
        reported.add(key);
        diagnostics.push({
          code: "CYCLIC_DEPENDENCY",
          message: `检测到循环依赖：${cycle.join(" → ")}`,
        });
      }
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    stack.push(id);
    for (const dependency of graph.get(id) ?? []) visit(dependency);
    stack.pop();
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of graph.keys()) visit(id);
  return diagnostics;
}

export function validateSemantics(roadmap: Roadmap): Diagnostic[] {
  const diagnostics = [
    ...duplicateDiagnostics(roadmap.releases, "DUPLICATE_RELEASE_ID"),
    ...duplicateDiagnostics(roadmap.requirements, "DUPLICATE_REQUIREMENT_ID"),
  ];
  const releaseIds = new Set(roadmap.releases.map((release) => release.id));
  for (const requirement of roadmap.requirements) {
    if (!releaseIds.has(requirement.releaseId)) {
      diagnostics.push({
        code: "UNKNOWN_RELEASE",
        path: `/requirements/${requirement.id}/releaseId`,
        message: `需求 ${requirement.id} 引用了未知版本 ${requirement.releaseId}`,
      });
    }
  }
  diagnostics.push(...dependencyDiagnostics(roadmap));
  for (const release of roadmap.releases) {
    const expected = aggregateReleaseStatus(
      roadmap.requirements.filter((item) => item.releaseId === release.id),
    );
    if (release.status !== expected) {
      diagnostics.push({
        code: "RELEASE_STATUS_MISMATCH",
        path: `/releases/${release.id}/status`,
        message: `版本 ${release.id} 状态应为 ${expected}，当前为 ${release.status}`,
      });
    }
  }
  return diagnostics;
}

function duplicateIdDiagnostics(
  items: { id: string }[],
  code: "USAGE_DUPLICATE_EVENT_ID" | "USAGE_DUPLICATE_PRICE_ID",
  basePath: string,
): Diagnostic[] {
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const item of items) {
    if (seen.has(item.id) && !duplicates.includes(item.id)) duplicates.push(item.id);
    seen.add(item.id);
  }
  return duplicates.map((id) => ({
    code,
    path: `${basePath}/${id}`,
    message: `ID 重复：${id}`,
  }));
}

function priceWindowDiagnostics(prices: UsagePrice[]): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const price of prices) {
    if (
      price.effectiveTo !== undefined &&
      price.effectiveTo !== null &&
      Date.parse(price.effectiveTo) <= Date.parse(price.effectiveFrom)
    ) {
      diagnostics.push({
        code: "USAGE_INVALID_PRICE_WINDOW",
        path: `/prices/${price.id}`,
        message: `价格 ${price.id} 的 effectiveTo 早于等于 effectiveFrom`,
      });
    }
  }

  // 同一 (provider, modelId) 的有效期不得重叠（半开区间，相邻不构成重叠）
  const groups = new Map<string, UsagePrice[]>();
  for (const price of prices) {
    const key = `${price.provider}\u0000${price.modelId}`;
    const group = groups.get(key) ?? [];
    group.push(price);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    const sorted = [...group].sort(
      (left, right) => Date.parse(left.effectiveFrom) - Date.parse(right.effectiveFrom),
    );
    let furthest: UsagePrice | undefined;
    let furthestEnd = Number.NEGATIVE_INFINITY;
    for (const price of sorted) {
      const start = Date.parse(price.effectiveFrom);
      const end =
        price.effectiveTo === undefined || price.effectiveTo === null
          ? Number.POSITIVE_INFINITY
          : Date.parse(price.effectiveTo);
      if (furthest && start < furthestEnd) {
        diagnostics.push({
          code: "USAGE_OVERLAPPING_PRICE",
          path: `/prices/${price.id}`,
          message: `价格 ${price.id} 与 ${furthest.id} 的有效期重叠（同一 provider/modelId 不得重叠）`,
        });
      }
      if (end > furthestEnd) {
        furthest = price;
        furthestEnd = end;
      }
    }
  }
  return diagnostics;
}

function priceReferenceDiagnostics(
  event: UsageEvent,
  priceById: Map<string, UsagePrice>,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const references: { priceId: string; path: string }[] = [];
  if (event.priceId !== undefined) {
    references.push({ priceId: event.priceId, path: `/events/${event.id}/priceId` });
  }
  if (event.cost?.priceId !== undefined && event.cost.priceId !== event.priceId) {
    references.push({ priceId: event.cost.priceId, path: `/events/${event.id}/cost/priceId` });
  }

  for (const reference of references) {
    const price = priceById.get(reference.priceId);
    if (!price) {
      diagnostics.push({
        code: "USAGE_UNKNOWN_PRICE",
        path: reference.path,
        message: `事件 ${event.id} 引用不存在的价格 ${reference.priceId}`,
      });
      continue;
    }
    if (price.provider !== event.provider || price.modelId !== event.modelId) {
      diagnostics.push({
        code: "USAGE_PRICE_MODEL_MISMATCH",
        path: reference.path,
        message: `事件 ${event.id} 引用价格 ${price.id}，但其 (provider, modelId) 与事件的 (${event.provider}, ${event.modelId}) 不一致`,
      });
    }
    if (!priceWindowCovers(price, event.occurredAt)) {
      diagnostics.push({
        code: "USAGE_PRICE_NOT_EFFECTIVE",
        path: reference.path,
        message: `事件 ${event.id} 的发生时间 ${event.occurredAt} 不在价格 ${price.id} 的有效期内`,
      });
    }
  }

  if (event.cost?.priceId !== undefined) {
    const price = priceById.get(event.cost.priceId);
    if (price && price.currency !== event.cost.currency) {
      diagnostics.push({
        code: "USAGE_CURRENCY_MISMATCH",
        path: `/events/${event.id}/cost/currency`,
        message: `事件 ${event.id} 的费用币种 ${event.cost.currency} 与价格 ${price.id} 的币种 ${price.currency} 不一致`,
      });
    }
  }
  return diagnostics;
}

/** 用量账本语义校验（契约 §7.2 全部 13 个诊断码） */
export function validateUsageSemantics(ledger: UsageLedger, roadmap: Roadmap): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const events = ledger.events;
  const prices = ledger.prices ?? [];

  if (ledger.project !== undefined && ledger.project !== roadmap.project.id) {
    diagnostics.push({
      code: "USAGE_PROJECT_MISMATCH",
      path: "/project",
      message: `账本 project「${ledger.project}」与需求池 project.id「${roadmap.project.id}」不一致`,
    });
  }

  diagnostics.push(...duplicateIdDiagnostics(events, "USAGE_DUPLICATE_EVENT_ID", "/events"));
  diagnostics.push(...duplicateIdDiagnostics(prices, "USAGE_DUPLICATE_PRICE_ID", "/prices"));
  diagnostics.push(...priceWindowDiagnostics(prices));

  const taskIds = new Set(roadmap.requirements.map((item) => item.id));
  const priceById = new Map(prices.map((price) => [price.id, price]));
  for (const event of events) {
    if (!taskIds.has(event.taskId)) {
      diagnostics.push({
        code: "USAGE_UNKNOWN_TASK",
        path: `/events/${event.id}/taskId`,
        message: `事件 ${event.id} 关联不存在的任务 ${event.taskId}`,
      });
    }

    const cachedInputTokens = event.usage.cachedInputTokens ?? 0;
    if (cachedInputTokens > event.usage.inputTokens) {
      diagnostics.push({
        code: "USAGE_TOKEN_SUBTOTAL_EXCEEDED",
        path: `/events/${event.id}/usage/cachedInputTokens`,
        message: `事件 ${event.id} 的 cachedInputTokens（${cachedInputTokens}）超过 inputTokens（${event.usage.inputTokens}）`,
      });
    }
    const reasoningTokens = event.usage.reasoningTokens ?? 0;
    if (reasoningTokens > event.usage.outputTokens) {
      diagnostics.push({
        code: "USAGE_TOKEN_SUBTOTAL_EXCEEDED",
        path: `/events/${event.id}/usage/reasoningTokens`,
        message: `事件 ${event.id} 的 reasoningTokens（${reasoningTokens}）超过 outputTokens（${event.usage.outputTokens}）`,
      });
    }

    if (
      event.priceId !== undefined &&
      event.cost?.priceId !== undefined &&
      event.priceId !== event.cost.priceId
    ) {
      diagnostics.push({
        code: "USAGE_PRICE_REF_CONFLICT",
        path: `/events/${event.id}/priceId`,
        message: `事件 ${event.id} 同时引用价格 ${event.priceId}（估算快照）与 ${event.cost.priceId}（登记依据），两者不一致`,
      });
    }

    diagnostics.push(...priceReferenceDiagnostics(event, priceById));
  }
  return diagnostics;
}

async function loadUsageLedger(
  usagePath: string,
  usageFile: string,
  roadmap: Roadmap,
): Promise<{ diagnostics: Diagnostic[]; payload?: UsageApiPayload }> {
  let raw: unknown;
  try {
    raw = await readJsonFile(usagePath);
  } catch {
    return {
      diagnostics: [
        {
          code: "USAGE_FILE_INVALID",
          path: usageFile,
          message: `用量账本文件缺失或不可解析：${usageFile}`,
        },
      ],
    };
  }

  const usageSchema = JSON.parse(await readFile(usageSchemaPath, "utf8")) as object;
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validateUsage = ajv.compile(usageSchema);
  if (!validateUsage(raw)) {
    return { diagnostics: schemaDiagnostics(validateUsage.errors, "USAGE_SCHEMA_INVALID") };
  }

  const ledger = raw as UsageLedger;
  const diagnostics = validateUsageSemantics(ledger, roadmap);
  if (diagnostics.length > 0) return { diagnostics };

  const releaseByTask = new Map(roadmap.requirements.map((item) => [item.id, item.releaseId]));
  const summary = buildUsageSummary(ledger.events, ledger.prices ?? [], releaseByTask);
  return { diagnostics: [], payload: { enabled: true, ledger, summary } };
}

export async function validateProject(projectRoot: string): Promise<ValidationResult> {
  try {
    const project = await loadProjectConfig(projectRoot);
    const data = await readJsonFile(project.dataPath);
    const baseSchema = JSON.parse(await readFile(baseSchemaPath, "utf8")) as object;
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv);
    const validateBase = ajv.compile(baseSchema);
    if (!validateBase(data)) {
      return {
        valid: false,
        diagnostics: schemaDiagnostics(validateBase.errors, "SCHEMA_INVALID"),
        usage: null,
      };
    }

    if (project.schemaPath) {
      const extensionSchema = (await readJsonFile(project.schemaPath)) as AnySchema;
      const validateExtension = ajv.compile(extensionSchema);
      if (!validateExtension(data)) {
        return {
          valid: false,
          diagnostics: schemaDiagnostics(
            validateExtension.errors,
            "EXTENSION_SCHEMA_INVALID",
          ),
          usage: null,
        };
      }
    }

    const roadmap = data as Roadmap;
    const diagnostics = validateSemantics(roadmap);
    let usage: UsageApiPayload | null = null;
    const usageFile = project.config.usageFile;
    if (project.usagePath && usageFile) {
      const loaded = await loadUsageLedger(project.usagePath, usageFile, roadmap);
      diagnostics.push(...loaded.diagnostics);
      usage = loaded.payload ?? null;
    }
    return { valid: diagnostics.length === 0, data: roadmap, diagnostics, usage };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      valid: false,
      diagnostics: [{ code: "CONFIG_INVALID", message }],
      usage: null,
    };
  }
}

export function createRoadmapView(roadmap: Roadmap): RoadmapView {
  const requirementsByRelease = Object.fromEntries(
    roadmap.releases.map((release) => [
      release.id,
      roadmap.requirements.filter((item) => item.releaseId === release.id),
    ]),
  );
  const requirementsByStatus = Object.fromEntries(
    STATUSES.map((status) => [
      status,
      roadmap.requirements.filter((item) => item.status === status),
    ]),
  ) as Record<Status, Requirement[]>;
  return { roadmap, requirementsByRelease, requirementsByStatus };
}

export function filterRequirements(
  requirements: Requirement[],
  filters: { query?: string; status?: Status; releaseId?: string },
): Requirement[] {
  const query = filters.query?.trim().toLocaleLowerCase();
  return requirements.filter(
    (item) =>
      (!filters.status || item.status === filters.status) &&
      (!filters.releaseId || item.releaseId === filters.releaseId) &&
      (!query ||
        `${item.id} ${item.title} ${(item.tags ?? []).join(" ")}`
          .toLocaleLowerCase()
          .includes(query)),
  );
}

export { ProjectConfigError };
