/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfigProvider } from "antd";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildUsageSummary } from "../src/usage";
import type { Roadmap, UsageApiPayload, UsageLedger } from "../src/types";
import { TaskDetailDrawer } from "../src/web/components/TaskDetailDrawer";
import { TaskListView } from "../src/web/components/Views";
import { UsageView } from "../src/web/components/UsageView";
import { Workspace } from "../src/web/components/Workspace";
import { LEDGER, RELEASE_BY_TASK, usageRoadmap } from "./usage-fixtures";

afterEach(() => {
  cleanup();
});

function renderBoard(ui: ReactElement) {
  return render(<ConfigProvider>{ui}</ConfigProvider>);
}

function usagePayload(ledger: UsageLedger = LEDGER): UsageApiPayload {
  return {
    enabled: true,
    ledger,
    summary: buildUsageSummary(ledger.events, ledger.prices ?? [], RELEASE_BY_TASK),
  };
}

const roadmap: Roadmap = usageRoadmap();

describe("任务列表用量摘要", () => {
  it("展示每任务的模型参与、Token 与费用摘要", () => {
    renderBoard(
      <TaskListView roadmap={roadmap} items={roadmap.requirements} usage={usagePayload()} onOpen={vi.fn()} />,
    );
    const t1 = screen.getByTestId("task-usage-T1");
    expect(t1.textContent).toContain("2 模型 · 4 次调用");
    expect(t1.textContent).toContain("入 17,400 · 出 4,650");
    expect(t1.textContent).toContain("实际 CNY 0.02");
    expect(t1.textContent).toContain("估算 CNY 0.04");
    expect(t1.textContent).toContain("未知 1 次");
    // 实际与估算分列，绝不相加
    expect(t1.textContent).not.toContain("0.06");
  });

  it("无用量记录的任务显示明确未知态", () => {
    const extended: Roadmap = {
      ...roadmap,
      requirements: [
        ...roadmap.requirements,
        {
          id: "T4",
          title: "任务四",
          releaseId: "v1",
          status: "backlog",
          dependsOn: [],
          acceptance: [],
          evidence: [],
        },
      ],
    };
    renderBoard(
      <TaskListView roadmap={extended} items={extended.requirements} usage={usagePayload()} onOpen={vi.fn()} />,
    );
    expect(screen.getByTestId("task-usage-T4").textContent).toBe("无用量记录");
  });

  it("账本未启用时不出现加载错误或虚构统计", () => {
    renderBoard(
      <TaskListView roadmap={roadmap} items={roadmap.requirements} onOpen={vi.fn()} />,
    );
    expect(screen.queryByTestId("task-usage-T1")).toBeNull();
    const cells = screen.getAllByText("—");
    expect(cells.length).toBe(roadmap.requirements.length);
    // 不出现任何虚构的用量统计
    expect(screen.queryByText(/次调用/)).toBeNull();
    expect(screen.queryByText(/入 \d/)).toBeNull();
  });
});

describe("任务详情模型用量", () => {
  it("展示参与角色、模型、Token 细分与费用来源", () => {
    renderBoard(
      <TaskDetailDrawer
        roadmap={roadmap}
        requirement={roadmap.requirements[0]}
        usage={usagePayload()}
        onClose={vi.fn()}
        onNavigate={vi.fn()}
      />,
    );
    expect(screen.getByText("模型用量")).toBeTruthy();
    const evt1 = screen.getByTestId("usage-event-evt-001");
    expect(evt1.textContent).toContain("开发执行");
    expect(evt1.textContent).toContain("alpha/model-a");
    expect(evt1.textContent).toContain("来源：运行日志");
    expect(evt1.textContent).toContain("可信：实测");
    expect(evt1.textContent).toContain("入 12,000（缓存 8,000）");
    expect(evt1.textContent).toContain("出 3,000（推理 1,200）");
    expect(evt1.textContent).toContain("CNY 0.0360");
    expect(evt1.textContent).toContain("工具估算");
    expect(evt1.textContent).toContain("价格版本 p-a-oct");

    const evt2 = screen.getByTestId("usage-event-evt-002");
    expect(evt2.textContent).toContain("登记费用");
    expect(evt2.textContent).toContain("实际费用");

    const evt8 = screen.getByTestId("usage-event-evt-008");
    expect(evt8.textContent).toContain("未知费用（登记费用）");
  });

  it("回退假设在事件明细中可见（T14）", () => {
    renderBoard(
      <TaskDetailDrawer
        roadmap={roadmap}
        requirement={roadmap.requirements[2]}
        usage={usagePayload()}
        onClose={vi.fn()}
        onNavigate={vi.fn()}
      />,
    );
    const evt5 = screen.getByTestId("usage-event-evt-005");
    expect(evt5.textContent).toContain("缓存输入单价缺失，已按输入单价计价");
    expect(evt5.textContent).toContain("推理单价缺失，已按输出单价计价");
  });

  it("账本未启用时不渲染用量区", () => {
    renderBoard(
      <TaskDetailDrawer
        roadmap={roadmap}
        requirement={roadmap.requirements[0]}
        onClose={vi.fn()}
        onNavigate={vi.fn()}
      />,
    );
    expect(screen.queryByText("模型用量")).toBeNull();
  });
});

describe("整体用量视图", () => {
  it("展示指标卡、五维汇总与统计口径说明", async () => {
    const user = userEvent.setup();
    renderBoard(
      <UsageView roadmap={roadmap} items={roadmap.requirements} usage={usagePayload()} onOpen={vi.fn()} />,
    );
    expect(screen.getByTestId("view-usage")).toBeTruthy();
    expect(screen.getByText("调用事件")).toBeTruthy();
    expect(screen.getByText("11")).toBeTruthy();
    expect(screen.getByText("52,400")).toBeTruthy();
    expect(screen.getAllByText("实际费用").length).toBeGreaterThan(0);
    expect(screen.getByText("CNY 0.02 · USD 0.05")).toBeTruthy();
    expect(screen.getByText("未知费用事件")).toBeTruthy();
    expect(screen.getByText("3 次")).toBeTruthy();

    const notes = screen.getByTestId("usage-notes");
    expect(notes.textContent).toContain("永不相加");
    expect(notes.textContent).toContain("多币种分列展示，未做汇率换算");
    expect(notes.textContent).toContain("缓存输入/推理 Token 为细分项");

    // confidence 三组与低可信占比（T12 UI）：estimated 2 + unknown 2，共 11 次调用
    const confidence = screen.getByTestId("usage-confidence");
    expect(confidence.textContent).toContain("低可信占比 36%");
    expect(screen.getByTestId("usage-confidence-measured").textContent).toContain("7");
    expect(screen.getByTestId("usage-confidence-estimated").textContent).toContain("2");
    expect(screen.getByTestId("usage-confidence-unknown").textContent).toContain("2");

    // 估算假设（T14）
    const assumptions = screen.getByTestId("usage-assumptions");
    expect(assumptions.textContent).toContain("缓存输入单价缺失，已按输入单价计价");
    expect(assumptions.textContent).toContain("推理单价缺失，已按输出单价计价");

    // 按任务表格可下钻到任务明细
    await user.click(screen.getByRole("tab", { name: "按任务" }));
    expect(await screen.findByText("任务一")).toBeTruthy();
    expect(screen.getByText("任务三")).toBeTruthy();
  });

  it("点击按任务行打开任务明细", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    renderBoard(
      <UsageView roadmap={roadmap} items={roadmap.requirements} usage={usagePayload()} onOpen={onOpen} />,
    );
    await user.click(screen.getByRole("tab", { name: "按任务" }));
    await user.click(await screen.findByText("任务一"));
    expect(onOpen).toHaveBeenCalledWith(roadmap.requirements[0]);
  });

  it("筛选后汇总与整体口径一致", () => {
    renderBoard(
      <UsageView
        roadmap={roadmap}
        items={roadmap.requirements.filter((item) => item.id === "T2")}
        usage={usagePayload()}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByText("已筛选：1/3 个任务")).toBeTruthy();
    expect(screen.getAllByText("22,900").length).toBeGreaterThan(0);
    expect(screen.getAllByText("USD 0.05").length).toBeGreaterThan(0);
  });
});

describe("T08 UI 边界", () => {
  it("空账本显示空态且不虚构统计", () => {
    renderBoard(
      <UsageView
        roadmap={roadmap}
        items={roadmap.requirements}
        usage={usagePayload({ schemaVersion: 1, project: "usage-demo", events: [] })}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByTestId("usage-empty").textContent).toContain("当前范围没有用量记录");
    expect(screen.getByTestId("view-usage").textContent).not.toContain("NaN");
    // 口径说明仍然可见
    expect(screen.getByTestId("usage-notes")).toBeTruthy();
  });

  it("仅有用量无价格时费用全部为未知", () => {
    const noPrices: UsageLedger = {
      schemaVersion: 1,
      project: "usage-demo",
      events: LEDGER.events.filter((item) => !item.cost).slice(0, 2),
    };
    renderBoard(
      <UsageView roadmap={roadmap} items={roadmap.requirements} usage={usagePayload(noPrices)} onOpen={vi.fn()} />,
    );
    expect(screen.getByText("未知费用事件")).toBeTruthy();
    expect(screen.getByText("2 次")).toBeTruthy();
    // 实际/估算费用列显示占位符而非虚构金额
    expect(screen.getByTestId("view-usage").textContent).not.toContain("估算 CNY");
    expect(screen.getByTestId("view-usage").textContent).not.toContain("实际 CNY");
  });

  it("actual 与 estimated 同时存在时分列展示", () => {
    renderBoard(
      <UsageView roadmap={roadmap} items={roadmap.requirements} usage={usagePayload()} onOpen={vi.fn()} />,
    );
    expect(screen.getByText("CNY 0.02 · USD 0.05")).toBeTruthy();
    expect(screen.getByText("CNY 0.13 · USD 0.03")).toBeTruthy();
  });
});

describe("T01 UI 兼容", () => {
  it("账本未启用时工作台正常渲染且不出现模型用量入口", () => {
    renderBoard(<Workspace roadmap={roadmap} />);
    expect(screen.getByText("用量演示项目")).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /模型用量/ })).toBeNull();
    expect(screen.getByTestId("view-overview")).toBeTruthy();
  });

  it("账本启用后出现模型用量入口且可切换", async () => {
    const user = userEvent.setup();
    renderBoard(<Workspace roadmap={roadmap} usage={usagePayload()} />);
    await user.click(screen.getByRole("menuitem", { name: /模型用量/ }));
    expect(screen.getByTestId("view-usage")).toBeTruthy();
  });
});
