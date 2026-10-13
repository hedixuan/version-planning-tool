/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfigProvider } from "antd";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Requirement, Roadmap } from "../src/types";
import { App } from "../src/web/App";
import { TaskDetailDrawer } from "../src/web/components/TaskDetailDrawer";
import { Workspace } from "../src/web/components/Workspace";
import { OverviewView, TaskListView } from "../src/web/components/Views";

function item(id: string, overrides: Partial<Requirement> = {}): Requirement {
  return {
    id,
    title: `任务 ${id}`,
    releaseId: "v1",
    status: "ready",
    dependsOn: [],
    acceptance: ["可验证"],
    evidence: [],
    ...overrides,
  };
}

const roadmap: Roadmap = {
  schemaVersion: 1,
  project: { id: "demo", name: "示例工作台", description: "测试项目" },
  updatedAt: "2026-10-12T08:00:00.000Z",
  releases: [{ id: "v1", name: "首个版本", status: "ready", goal: "交付首版" }],
  requirements: [
    item("P0-00", {
      title: "接入工具",
      status: "blocked",
      priority: "high",
      owner: "Ada",
      tags: ["tooling"],
      dependsOn: ["missing"],
      acceptance: ["独立工具可展示需求"],
      evidence: ["README.md"],
    }),
    item("P0-01", {
      title: "固定环境",
      status: "review",
      priority: "medium",
      owner: "Ben",
      tags: ["env"],
    }),
  ],
};

afterEach(() => {
  cleanup();
});

function renderBoard(ui: ReactElement) {
  return render(<ConfigProvider>{ui}</ConfigProvider>);
}

describe("专业看板视图", () => {
  it("概览展示指标、版本进度和关注任务", () => {
    renderBoard(
      <OverviewView
        roadmap={roadmap}
        items={roadmap.requirements}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByTestId("view-overview")).toBeTruthy();
    expect(screen.getByText("总体完成率")).toBeTruthy();
    expect(screen.getByText("需要关注")).toBeTruthy();
    expect(screen.getAllByText("接入工具").length).toBeGreaterThan(0);
  });

  it("任务列表支持打开详情，空态给出说明", async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    const { rerender } = renderBoard(
      <TaskListView roadmap={roadmap} items={roadmap.requirements} onOpen={onOpen} />,
    );
    await user.click(screen.getByRole("button", { name: "打开任务 P0-00 接入工具" }));
    expect(onOpen).toHaveBeenCalledWith(roadmap.requirements[0]);

    rerender(
      <ConfigProvider>
        <TaskListView roadmap={roadmap} items={[]} onOpen={onOpen} />
      </ConfigProvider>,
    );
    expect(screen.getByText("没有符合条件的任务")).toBeTruthy();
  });

  it("工作台可切换视图、筛选并打开详情", async () => {
    const user = userEvent.setup();
    renderBoard(<Workspace roadmap={roadmap} />);
    expect(screen.getByLabelText("关注事项")).toBeTruthy();
    expect(screen.getByText("示例工作台")).toBeTruthy();

    await user.click(screen.getByRole("menuitem", { name: /任务列表/ }));
    expect(await screen.findByTestId("view-list")).toBeTruthy();

    await user.click(screen.getByRole("menuitem", { name: /状态看板/ }));
    expect(await screen.findByTestId("view-board")).toBeTruthy();

    await user.click(screen.getByRole("menuitem", { name: /版本路线/ }));
    expect(await screen.findByTestId("view-releases")).toBeTruthy();
    expect(screen.getByText("交付首版")).toBeTruthy();

    await user.type(screen.getByLabelText("搜索任务"), "接入");
    expect(screen.getByText("1 项结果")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "重置筛选" }));
    expect(screen.getByText("2 项结果")).toBeTruthy();
  });

  it("详情可导航依赖并标记缺失引用", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    renderBoard(
      <TaskDetailDrawer
        roadmap={{
          ...roadmap,
          requirements: [
            ...roadmap.requirements,
            item("dep-1", { title: "前置任务", status: "done" }),
          ],
        }}
        requirement={{
          ...roadmap.requirements[1]!,
          dependsOn: ["dep-1", "missing"],
        }}
        onClose={vi.fn()}
        onNavigate={onNavigate}
      />,
    );
    expect(screen.getByText("缺失引用：missing")).toBeTruthy();
    expect(screen.getByText("可验证")).toBeTruthy();
    await user.click(screen.getByText("前置任务"));
    expect(onNavigate).toHaveBeenCalledWith("dep-1");
  });
});

describe("加载失败恢复", () => {
  it("缺少令牌时展示错误且不提供重新加载", () => {
    window.history.pushState({}, "", "/");
    renderBoard(<App />);
    expect(screen.getByText("版本计划加载失败")).toBeTruthy();
    expect(screen.getByText(/缺少会话令牌/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "重新加载" })).toBeNull();
  });
});
