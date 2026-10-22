#!/usr/bin/env node
import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { serveProject } from "./server.js";
import { validateProject } from "./validation.js";

const usage = `用法：
  version-plan serve --project <path> [--port 4173] [--host 127.0.0.1] [--open]
  version-plan validate --project <path>`;

function openBrowser(url: string): void {
  let executable: string;
  let args: string[];
  if (process.platform === "win32") {
    executable = "cmd.exe";
    args = ["/d", "/s", "/c", "start", "", url];
  } else if (process.platform === "darwin") {
    executable = "open";
    args = [url];
  } else {
    executable = "xdg-open";
    args = [url];
  }
  const child = spawn(executable, args, {
    detached: true,
    shell: false,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
}

function assertNodeVersion(): void {
  const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 17)) {
    throw new Error(`需要 Node.js >=22.17，当前为 ${process.versions.node}`);
  }
}

export interface ValidateCommandResult {
  exitCode: number;
  stdout: string[];
  stderr: string[];
}

/** validate 命令的纯逻辑：成功退出码 0，失败退出码 1；输出格式与 CLI 既有行为一致 */
export async function runValidate(project: string): Promise<ValidateCommandResult> {
  const result = await validateProject(project);
  if (result.valid) {
    return {
      exitCode: 0,
      stdout: [`校验通过：${result.data?.requirements.length ?? 0} 个需求`],
      stderr: [],
    };
  }
  return {
    exitCode: 1,
    stdout: [],
    stderr: result.diagnostics.map((diagnostic) => `[${diagnostic.code}] ${diagnostic.message}`),
  };
}

async function main(): Promise<void> {
  assertNodeVersion();
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      project: { type: "string" },
      port: { type: "string", default: "4173" },
      host: { type: "string", default: "127.0.0.1" },
      open: { type: "boolean", default: false },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
    strict: true,
  });

  if (values.help) {
    console.log(usage);
    return;
  }
  const command = positionals[0];
  if (!command || !values.project || positionals.length !== 1) {
    throw new Error(usage);
  }
  const project = resolve(values.project);

  if (command === "validate") {
    const outcome = await runValidate(project);
    for (const line of outcome.stdout) console.log(line);
    for (const line of outcome.stderr) console.error(line);
    process.exitCode = outcome.exitCode;
    return;
  }

  if (command === "serve") {
    const port = Number(values.port);
    const running = await serveProject({
      project,
      host: values.host ?? "127.0.0.1",
      port,
    });
    const close = async (): Promise<void> => {
      await running.app.close();
      process.exit(0);
    };
    process.once("SIGINT", () => void close());
    process.once("SIGTERM", () => void close());
    console.log(`版本计划服务已启动：${running.url}`);
    if (values.open) openBrowser(running.url);
    return;
  }

  throw new Error(`未知命令：${command}\n${usage}`);
}

/** 仅当本文件作为入口直接执行（含经符号链接的全局 bin）时运行 main，便于测试导入 */
function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
