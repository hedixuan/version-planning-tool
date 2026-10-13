import staticPlugin from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { validateProject } from "./validation.js";

export function isLoopbackHost(host: string): boolean {
  const normalized = host.toLocaleLowerCase().replace(/^\[(.*)\]$/u, "$1");
  if (normalized === "localhost" || normalized === "::1") return true;
  if (normalized.startsWith("::ffff:")) {
    return isLoopbackHost(normalized.slice("::ffff:".length));
  }
  const parts = normalized.split(".");
  return (
    parts.length === 4 &&
    parts[0] === "127" &&
    parts.every((part) => /^\d{1,3}$/u.test(part) && Number(part) <= 255)
  );
}

export async function buildServer(
  projectRoot: string,
  options: {
    serveStatic?: boolean;
    session?: { token: string; origin: string };
  } = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    bodyLimit: 16 * 1024,
  });

  app.addHook("onSend", async (_request, reply, payload) => {
    reply
      .header("x-content-type-options", "nosniff")
      .header("x-frame-options", "DENY")
      .header("referrer-policy", "no-referrer")
      .header("content-security-policy", "default-src 'self'; style-src 'self' 'unsafe-inline'");
    return payload;
  });

  app.get("/__health", async () => ({ ok: true }));
  app.get("/api/roadmap", async (request, reply) => {
    if (options.session) {
      const suppliedToken = request.headers["x-version-plan-token"];
      if (
        typeof suppliedToken !== "string" ||
        !tokensEqual(suppliedToken, options.session.token)
      ) {
        return reply.code(401).send({
          error: "UNAUTHORIZED",
          message: "缺少或无效的版本计划会话令牌",
        });
      }
      const suppliedOrigins = readRequestOrigins(
        request.headers.origin,
        request.headers.referer,
      );
      const declaredOrigin = request.headers["x-version-plan-origin"];
      const hasTrustedDeclaredOrigin =
        declaredOrigin === options.session.origin &&
        request.headers["sec-fetch-site"] === "same-origin";
      if (
        !suppliedOrigins.includes(options.session.origin) &&
        !hasTrustedDeclaredOrigin
      ) {
        return reply.code(403).send({
          error: "ORIGIN_FORBIDDEN",
          message: "请求来源不在当前版本计划会话允许范围内",
        });
      }
    }
    reply.header("cache-control", "no-store");
    return validateProject(projectRoot);
  });

  if (options.serveStatic !== false) {
    const webRoot = fileURLToPath(new URL("./web", import.meta.url));
    await app.register(staticPlugin, {
      root: webRoot,
      wildcard: false,
      index: false,
    });
    app.setNotFoundHandler((request, reply) => {
      if (request.method === "GET" && !request.url.startsWith("/api/")) {
        return reply.sendFile("index.html");
      }
      return reply.code(404).send({
        error: "NOT_FOUND",
        message: "请求的只读资源不存在",
      });
    });
  }

  return app;
}

function tokensEqual(supplied: string, expected: string): boolean {
  const suppliedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(expected);
  return (
    suppliedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(suppliedBuffer, expectedBuffer)
  );
}

function readRequestOrigins(
  origin: string | undefined,
  referer: string | undefined,
): string[] {
  const origins: string[] = [];
  if (origin) origins.push(origin);
  if (referer) {
    try {
      origins.push(new URL(referer).origin);
    } catch {
      // 非法 Referer 不能成为可信来源。
    }
  }
  return origins;
}

export async function serveProject(options: {
  project: string;
  host: string;
  port: number;
}): Promise<{ app: FastifyInstance; url: string }> {
  if (!isLoopbackHost(options.host)) {
    throw new Error(`拒绝非 loopback 监听地址：${options.host}`);
  }
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
    throw new Error(`端口必须是 1 到 65535 的整数：${options.port}`);
  }
  const origin = `http://${options.host}:${options.port}`;
  const token = randomBytes(32).toString("base64url");
  const app = await buildServer(options.project, {
    session: { token, origin },
  });
  await app.listen({ host: options.host, port: options.port });
  return {
    app,
    url: `${origin}/?token=${encodeURIComponent(token)}`,
  };
}
