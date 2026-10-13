import type { Roadmap } from "../../types";

export async function loadRoadmap(token: string): Promise<Roadmap> {
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
    diagnostics: { message: string }[];
  };
  if (!result.valid || !result.data) {
    throw new Error(result.diagnostics.map((item) => item.message).join("；") || "服务未返回数据");
  }
  return result.data;
}
