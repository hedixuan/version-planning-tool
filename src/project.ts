import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import type { VersionPlanConfig } from "./types.js";

const CONFIG_NAME = "version-plan.config.json";

export class ProjectConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectConfigError";
  }
}

async function parseJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ProjectConfigError(`无法读取 JSON 文件 ${file}：${detail}`);
  }
}

export async function resolveProjectFile(
  projectRoot: string,
  relativeFile: string,
): Promise<string> {
  if (
    !relativeFile ||
    path.isAbsolute(relativeFile) ||
    relativeFile.includes("\0") ||
    relativeFile.split(/[\\/]/u).some((part) => part === ".." || part.includes(":"))
  ) {
    throw new ProjectConfigError(`配置路径必须是项目内相对路径：${relativeFile}`);
  }

  const root = await realpath(projectRoot);
  const candidate = path.resolve(root, path.normalize(relativeFile));
  const relative = path.relative(root, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new ProjectConfigError(`配置路径越出项目目录：${relativeFile}`);
  }

  let actual: string;
  try {
    actual = await realpath(candidate);
  } catch {
    throw new ProjectConfigError(`配置文件指向的路径不存在：${relativeFile}`);
  }
  const actualRelative = path.relative(root, actual);
  if (actualRelative.startsWith("..") || path.isAbsolute(actualRelative)) {
    throw new ProjectConfigError(`符号链接越出项目目录：${relativeFile}`);
  }
  return actual;
}

export async function loadProjectConfig(projectRoot: string): Promise<{
  root: string;
  config: VersionPlanConfig;
  dataPath: string;
  schemaPath?: string;
}> {
  const root = await realpath(projectRoot);
  const raw = await parseJson(path.join(root, CONFIG_NAME));
  if (
    typeof raw !== "object" ||
    raw === null ||
    Array.isArray(raw) ||
    typeof (raw as Record<string, unknown>).dataFile !== "string"
  ) {
    throw new ProjectConfigError("version-plan.config.json 必须包含字符串 dataFile");
  }

  const keys = Object.keys(raw);
  if (keys.some((key) => key !== "dataFile" && key !== "schemaFile")) {
    throw new ProjectConfigError("version-plan.config.json 包含未知字段");
  }
  const schemaFile = (raw as Record<string, unknown>).schemaFile;
  if (schemaFile !== undefined && typeof schemaFile !== "string") {
    throw new ProjectConfigError("schemaFile 必须是字符串");
  }

  const config = raw as VersionPlanConfig;
  return {
    root,
    config,
    dataPath: await resolveProjectFile(root, config.dataFile),
    schemaPath: config.schemaFile
      ? await resolveProjectFile(root, config.schemaFile)
      : undefined,
  };
}

export async function readJsonFile(file: string): Promise<unknown> {
  return parseJson(file);
}
