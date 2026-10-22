import {
  AlertOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  EyeOutlined,
} from "@ant-design/icons";
import { Card, Empty, Progress, Tag, Typography } from "antd";
import { useMemo } from "react";
import type { Release, Requirement, Roadmap, UsageApiPayload } from "../../types";
import { STATUSES } from "../../types";
import { openOnKeyboard } from "../lib/keyboard";
import { STATUS_META } from "../lib/meta";
import {
  calculateReleaseProgress,
  calculateStats,
} from "../lib/view-model";
import { createUsageContext } from "../lib/usage-view-model";
import { OverlayScroll } from "./OverlayScroll";
import { PriorityTag, StatusTag, TaskCard } from "./TaskPrimitives";
import { TaskUsageCell } from "./UsageView";

const { Paragraph, Text, Title } = Typography;

interface ViewProps {
  roadmap: Roadmap;
  items: Requirement[];
  /** 配置了 usageFile 时的只读账本载荷；未启用为 null/undefined */
  usage?: UsageApiPayload | null;
  onOpen: (item: Requirement) => void;
}

export function OverviewView({ roadmap, items, onOpen }: ViewProps) {
  const stats = calculateStats(items);
  const summary = [
    { label: "总体完成率", value: `${stats.completion}%`, icon: <CheckCircleOutlined />, tone: "success" },
    { label: "进行中", value: stats.inProgress, icon: <ClockCircleOutlined />, tone: "progress" },
    { label: "阻塞", value: stats.blocked, icon: <AlertOutlined />, tone: "danger" },
    { label: "待验收", value: stats.review, icon: <EyeOutlined />, tone: "warning" },
  ];
  return (
    <div className="view-stack" data-testid="view-overview">
      <div className="metric-grid">
        {summary.map((metric) => (
          <Card key={metric.label} className={`metric-card metric-${metric.tone}`}>
            <div className="metric-icon">{metric.icon}</div>
            <div><Text type="secondary">{metric.label}</Text><strong>{metric.value}</strong></div>
          </Card>
        ))}
      </div>
      <div className="overview-grid">
        <Card title="状态分布" className="panel-card">
          <div className="status-distribution">
            {STATUSES.map((status) => {
              const count = stats.statusCounts[status];
              return (
                <div className="distribution-row" key={status}>
                  <StatusTag status={status} />
                  <Progress
                    percent={stats.total ? Math.round((count / stats.total) * 100) : 0}
                    showInfo={false}
                    strokeColor={`var(--status-${STATUS_META[status].tone})`}
                  />
                  <Text>{count}</Text>
                </div>
              );
            })}
          </div>
        </Card>
        <Card title="版本进度" className="panel-card">
          <div className="release-progress-list">
            {roadmap.releases.map((release) => {
              const progress = calculateReleaseProgress(release, items);
              return (
                <div key={release.id} className="release-progress-row">
                  <div><Text strong>{release.name}</Text><Text type="secondary">{progress.done}/{progress.total}</Text></div>
                  <Progress percent={progress.percent} size="small" />
                </div>
              );
            })}
          </div>
        </Card>
      </div>
      <Card title="需要关注" className="panel-card" extra={<Text type="secondary">{stats.attention.length} 项</Text>}>
        {stats.attention.length ? (
          <div className="attention-grid">
            {stats.attention.map((item) => (
              <TaskCard
                key={item.id}
                requirement={item}
                releaseName={roadmap.releases.find((release) => release.id === item.releaseId)?.name}
                hasMissingDependency={item.dependsOn.some(
                  (id) => !roadmap.requirements.some((candidate) => candidate.id === id),
                )}
                onOpen={onOpen}
              />
            ))}
          </div>
        ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前没有需要关注的任务" />}
      </Card>
    </div>
  );
}

export function TaskListView({ roadmap, items, usage, onOpen }: ViewProps) {
  const usageContext = useMemo(
    () => (usage ? createUsageContext(roadmap, usage) : undefined),
    [roadmap, usage],
  );
  if (!items.length) return <ViewEmpty />;
  return (
    <div data-testid="view-list">
    <Card className="panel-card task-list-card" title="任务列表" extra={<Text type="secondary">{items.length} 项</Text>}>
      <div className="task-table" role="list">
        <div className="task-row task-row-header">
          <span>任务</span><span>状态</span><span>优先级</span><span>负责人</span>
          <span>版本</span><span>标签 / 依赖</span><span>模型用量</span>
        </div>
        {items.map((item) => (
          <div
            key={item.id}
            className="task-row"
            role="button"
            tabIndex={0}
            aria-label={`打开任务 ${item.id} ${item.title}`}
            onClick={() => onOpen(item)}
            onKeyDown={(event) => openOnKeyboard(event, () => onOpen(item))}
          >
            <span className="task-main"><Text className="task-id">{item.id}</Text><Text strong>{item.title}</Text></span>
            <span><StatusTag status={item.status} /></span>
            <span><PriorityTag priority={item.priority} /></span>
            <span>{item.owner ?? "未分配"}</span>
            <span>{roadmap.releases.find((release) => release.id === item.releaseId)?.name ?? item.releaseId}</span>
            <span className="task-row-tags">
              {(item.tags ?? []).slice(0, 2).map((tag) => <Tag key={tag}>{tag}</Tag>)}
              {item.dependsOn.length > 0 && <Text type="secondary">{item.dependsOn.length} 依赖</Text>}
            </span>
            <span className="task-usage">
              {usageContext ? <TaskUsageCell context={usageContext} taskId={item.id} /> : "—"}
            </span>
          </div>
        ))}
      </div>
    </Card>
    </div>
  );
}

export function KanbanView({ roadmap, items, onOpen }: ViewProps) {
  return (
    <OverlayScroll className="kanban-frame" testId="view-board" label="状态看板">
    <div className="kanban">
      {STATUSES.map((status) => {
        const columnItems = items.filter((item) => item.status === status);
        const percent = items.length ? Math.round((columnItems.length / items.length) * 100) : 0;
        return (
          <section className="kanban-column" key={status}>
            <header>
              <div><span className={`status-dot tone-${STATUS_META[status].tone}`} /><Title level={5}>{STATUS_META[status].label}</Title></div>
              <Text type="secondary">{columnItems.length} · {percent}%</Text>
            </header>
            <div className="kanban-cards">
              {columnItems.map((item) => (
                <TaskCard
                  key={item.id}
                  requirement={item}
                  releaseName={roadmap.releases.find((release) => release.id === item.releaseId)?.name}
                  hasMissingDependency={item.dependsOn.some(
                    (id) => !roadmap.requirements.some((candidate) => candidate.id === id),
                  )}
                  onOpen={onOpen}
                />
              ))}
              {!columnItems.length && <div className="column-empty">暂无任务</div>}
            </div>
          </section>
        );
      })}
    </div>
    </OverlayScroll>
  );
}

export function ReleasesView({ roadmap, items, onOpen }: ViewProps) {
  return (
    <div className="release-list" data-testid="view-releases">
      {roadmap.releases.map((release) => (
        <ReleaseCard
          key={release.id}
          release={release}
          allItems={roadmap.requirements}
          items={items.filter((item) => item.releaseId === release.id)}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}

function ReleaseCard({
  release,
  allItems,
  items,
  onOpen,
}: {
  release: Release;
  allItems: Requirement[];
  items: Requirement[];
  onOpen: (item: Requirement) => void;
}) {
  const progress = calculateReleaseProgress(release, allItems);
  return (
    <Card className="release-card">
      <div className="release-card-head">
        <div><Text className="task-id">{release.id}</Text><Title level={4}>{release.name}</Title></div>
        <StatusTag status={release.status} />
      </div>
      <Paragraph type="secondary">{release.goal || "未填写版本目标"}</Paragraph>
      <div className="release-progress">
        <div><Text strong>版本进度</Text><Text type="secondary">{progress.done}/{progress.total} 已完成</Text></div>
        <Progress percent={progress.percent} />
      </div>
      <div className="exit-criteria">
        <Text strong>退出条件</Text>
        {(release.exitCriteria ?? []).length ? (
          <ul>{release.exitCriteria?.map((item) => <li key={item}>{item}</li>)}</ul>
        ) : <Text type="secondary">未填写退出条件</Text>}
      </div>
      <div className="release-tasks">
        {items.map((item) => (
          <button key={item.id} type="button" onClick={() => onOpen(item)}>
            <span><StatusTag status={item.status} /> <Text className="task-id">{item.id}</Text></span>
            <Text>{item.title}</Text>
          </button>
        ))}
        {!items.length && <ViewEmpty compact />}
      </div>
    </Card>
  );
}

export function ViewEmpty({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? "view-empty compact" : "view-empty"}>
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有符合条件的任务" />
    </div>
  );
}
