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
  type ValidationResult,
} from "./types.js";

const baseSchemaPath = fileURLToPath(
  new URL("../schema/roadmap.schema.json", import.meta.url),
);
const addFormats = createRequire(import.meta.url)("ajv-formats") as FormatsPlugin;

function schemaDiagnostics(
  errors: ErrorObject[] | null | undefined,
  code: "SCHEMA_INVALID" | "EXTENSION_SCHEMA_INVALID",
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
        };
      }
    }

    const roadmap = data as Roadmap;
    const diagnostics = validateSemantics(roadmap);
    return { valid: diagnostics.length === 0, data: roadmap, diagnostics };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      valid: false,
      diagnostics: [{ code: "CONFIG_INVALID", message }],
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
