import type { Status } from "../../types";

export const STATUS_META: Record<
  Status,
  { label: string; color: string; tone: string }
> = {
  backlog: { label: "待规划", color: "default", tone: "neutral" },
  ready: { label: "就绪", color: "blue", tone: "ready" },
  in_progress: { label: "进行中", color: "processing", tone: "progress" },
  blocked: { label: "阻塞", color: "error", tone: "danger" },
  review: { label: "待验收", color: "warning", tone: "warning" },
  done: { label: "已完成", color: "success", tone: "success" },
  cancelled: { label: "已取消", color: "default", tone: "muted" },
};

export const PRIORITY_META: Record<string, { label: string; rank: number; tone: string }> = {
  urgent: { label: "紧急", rank: 0, tone: "danger" },
  high: { label: "高", rank: 1, tone: "warning" },
  medium: { label: "中", rank: 2, tone: "ready" },
  low: { label: "低", rank: 3, tone: "neutral" },
};

export function priorityLabel(priority?: string): string {
  if (!priority) return "未设置";
  return PRIORITY_META[priority.toLocaleLowerCase()]?.label ?? priority;
}
