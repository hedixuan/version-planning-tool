import type { Roadmap, UsageApiPayload } from "../../types";

export interface RoadmapPayload {
  roadmap: Roadmap;
  /** 未配置 usageFile 时为 null（契约 §3.2：老服务不返回该字段时同样按 null 处理） */
  usage: UsageApiPayload | null;
}

export async function loadRoadmap(token: string): Promise<RoadmapPayload> {
  const response = await fetch("/api/roadmap", {
    headers: {
      accept: "application/json",
      "x-version-plan-token": token,
      "x-version-plan-origin": window.location.origin,
    },
  });
  if (!response.ok) throw new Error(`服务返回 ${response.status}`);
  const result = (await response.json()) as {
    valid: boolean;
    data?: Roadmap;
    usage?: UsageApiPayload | null;
    diagnostics: { message: string }[];
  };
  if (!result.valid || !result.data) {
    throw new Error(result.diagnostics.map((item) => item.message).join("；") || "服务未返回数据");
  }
  return { roadmap: result.data, usage: result.usage ?? null };
}
