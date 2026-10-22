import {
  ApiOutlined,
  DollarOutlined,
  FileTextOutlined,
  QuestionCircleOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { Card, Empty, Table, Tabs, Tag, Typography } from "antd";
import { useMemo, type ReactNode } from "react";
import type {
  Requirement,
  Roadmap,
  UsageApiPayload,
  UsageBucket,
  UsageEventCost,
} from "../../types";
import {
  CONFIDENCE_LABELS,
  COST_BASIS_LABELS,
  COST_STATE_LABELS,
  SOURCE_LABELS,
  assumptionLabel,
  createUsageContext,
  formatAmount,
  formatCosts,
  formatEventTime,
  formatLowConfidenceRatio,
  formatTokens,
  scopeUsageSummary,
  taskEventViews,
  type UsageContext,
} from "../lib/usage-view-model";

const { Text } = Typography;

interface UsageRow {
  key: string;
  name: string;
  secondary?: string;
  bucket: UsageBucket;
  requirement?: Requirement;
}

function bucketColumns(withTaskLink: boolean) {
  return [
    {
      title: "名称",
      key: "name",
      render: (_: unknown, row: UsageRow): ReactNode => (
        <span className="usage-row-name">
          <Text strong>{row.name}</Text>
          {row.secondary && <Text type="secondary"> {row.secondary}</Text>}
        </span>
      ),
    },
    { title: "事件数", key: "eventCount", render: (_: unknown, row: UsageRow) => row.bucket.eventCount },
    {
      title: "输入 Token",
      key: "input",
      render: (_: unknown, row: UsageRow) => formatTokens(row.bucket.tokens.input),
    },
    {
      title: "输出 Token",
      key: "output",
      render: (_: unknown, row: UsageRow) => formatTokens(row.bucket.tokens.output),
    },
    {
      title: "缓存输入",
      key: "cachedInput",
      render: (_: unknown, row: UsageRow) => formatTokens(row.bucket.tokens.cachedInput),
    },
    {
      title: "推理 Token",
      key: "reasoning",
      render: (_: unknown, row: UsageRow) => formatTokens(row.bucket.tokens.reasoning),
    },
    {
      title: "实际费用",
      key: "costActual",
      render: (_: unknown, row: UsageRow) => formatCosts(row.bucket.costActual),
    },
    {
      title: "估算费用",
      key: "costEstimated",
      render: (_: unknown, row: UsageRow) => formatCosts(row.bucket.costEstimated),
    },
    {
      title: "未知费用",
      key: "unknownCost",
      render: (_: unknown, row: UsageRow) =>
        row.bucket.unknownCostEventCount > 0 ? `${row.bucket.unknownCostEventCount} 次` : "—",
    },
    ...(withTaskLink
      ? [
          {
            title: "任务明细",
            key: "detail",
            render: (_: unknown, row: UsageRow) =>
              row.requirement ? <Tag color="blue">查看明细</Tag> : null,
          },
        ]
      : []),
  ];
}

function toRows(buckets: Record<string, UsageBucket>, requirementOf?: (id: string) => Requirement | undefined): UsageRow[] {
  return Object.entries(buckets)
    .map(([key, bucket]) => {
      const requirement = requirementOf?.(key);
      return {
        key,
        name: requirement?.title ?? key,
        secondary: requirement ? key : undefined,
        bucket,
        requirement,
      };
    })
    .sort((left, right) => right.bucket.eventCount - left.bucket.eventCount || left.key.localeCompare(right.key));
}

export function UsageView({
  roadmap,
  items,
  usage,
  onOpen,
}: {
  roadmap: Roadmap;
  items: Requirement[];
  usage: UsageApiPayload;
  onOpen: (item: Requirement) => void;
}) {
  const context = useMemo(() => createUsageContext(roadmap, usage), [roadmap, usage]);
  const taskIds = useMemo(() => new Set(items.map((item) => item.id)), [items]);
  const scoped = useMemo(() => scopeUsageSummary(context, taskIds), [context, taskIds]);
  const totals = scoped.totals;
  const isFiltered = items.length !== roadmap.requirements.length;
  const requirementOf = (id: string) => roadmap.requirements.find((item) => item.id === id);
  const releaseName = (id: string) => roadmap.releases.find((release) => release.id === id)?.name ?? id;

  const metrics = [
    { label: "调用事件", value: totals.eventCount, icon: <ThunderboltOutlined /> },
    { label: "涉及任务", value: totals.taskCount, icon: <ApiOutlined /> },
    { label: "涉及模型", value: totals.modelCount, icon: <ApiOutlined /> },
    { label: "输入 Token", value: formatTokens(totals.tokens.input), icon: <FileTextOutlined /> },
    { label: "输出 Token", value: formatTokens(totals.tokens.output), icon: <FileTextOutlined /> },
    { label: "实际费用", value: formatCosts(totals.costActual), icon: <DollarOutlined /> },
    { label: "估算费用", value: formatCosts(totals.costEstimated), icon: <DollarOutlined /> },
    { label: "未知费用事件", value: `${totals.unknownCostEventCount} 次`, icon: <QuestionCircleOutlined /> },
  ];

  const tabs = [
    {
      key: "provider",
      label: "按供应商",
      children: (
        <Table
          size="small"
          pagination={false}
          dataSource={toRows(scoped.byProvider)}
          columns={bucketColumns(false)}
        />
      ),
    },
    {
      key: "model",
      label: "按模型",
      children: (
        <Table
          size="small"
          pagination={false}
          dataSource={toRows(scoped.byModel)}
          columns={bucketColumns(false)}
        />
      ),
    },
    {
      key: "role",
      label: "按角色",
      children: (
        <Table
          size="small"
          pagination={false}
          dataSource={toRows(scoped.byRole)}
          columns={bucketColumns(false)}
        />
      ),
    },
    {
      key: "release",
      label: "按版本",
      children: (
        <Table
          size="small"
          pagination={false}
          dataSource={Object.entries(scoped.byRelease)
            .map(([id, bucket]) => ({ key: id, name: releaseName(id), secondary: id, bucket }))
            .sort((left, right) => right.bucket.eventCount - left.bucket.eventCount)}
          columns={bucketColumns(false)}
        />
      ),
    },
    {
      key: "task",
      label: "按任务",
      children: (
        <Table
          size="small"
          pagination={false}
          dataSource={toRows(scoped.byTask, requirementOf)}
          columns={bucketColumns(true)}
          onRow={(row) => ({
            onClick: () => row.requirement && onOpen(row.requirement),
            style: row.requirement ? { cursor: "pointer" } : undefined,
          })}
        />
      ),
    },
  ];

  return (
    <div className="view-stack" data-testid="view-usage">
      <div className="metric-grid">
        {metrics.map((metric) => (
          <Card key={metric.label} className="metric-card metric-progress">
            <div className="metric-icon">{metric.icon}</div>
            <div>
              <Text type="secondary">{metric.label}</Text>
              <strong>{metric.value}</strong>
            </div>
          </Card>
        ))}
      </div>

      <UsageStatisticsNotes bucket={totals} />

      <Card
        className="panel-card"
        title="用量汇总"
        extra={
          <Text type="secondary">
            {isFiltered ? `已筛选：${items.length}/${roadmap.requirements.length} 个任务` : "全部任务"}
          </Text>
        }
      >
        {totals.eventCount === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前范围没有用量记录" data-testid="usage-empty" />
        ) : (
          <Tabs items={tabs} />
        )}
      </Card>
    </div>
  );
}

export function UsageStatisticsNotes({ bucket }: { bucket: UsageBucket }) {
  return (
    <Card title="统计口径说明" className="panel-card" data-testid="usage-notes">
      <ul className="usage-notes-list">
        <li>实际费用与估算费用按币种分列展示，永不相加；未知费用只计数、不计价，也不按 0 元计入任何合计。</li>
        <li>估算费用按价格版本与公式计算；订阅、免费额度与本地部署模型的货币成本记为未知，Token 照常统计。</li>
        <li>Token 口径：输入/输出为总量，缓存输入/推理 Token 为细分项，汇总不重复累计。</li>
        <li>多币种分列展示，未做汇率换算。</li>
      </ul>
      <div className="usage-confidence" data-testid="usage-confidence">
        <Text strong>
          可信度分组（互斥完备，低可信占比 {formatLowConfidenceRatio(bucket)}）
        </Text>
        <table className="usage-confidence-table">
          <thead>
            <tr>
              <th>分组</th>
              <th>事件数</th>
              <th>输入 Token</th>
              <th>输出 Token</th>
              <th>缓存输入</th>
              <th>推理 Token</th>
            </tr>
          </thead>
          <tbody>
            {(["measured", "estimated", "unknown"] as const).map((group) => (
              <tr key={group} data-testid={`usage-confidence-${group}`}>
                <td>{CONFIDENCE_LABELS[group]}</td>
                <td>{bucket.confidence[group].eventCount}</td>
                <td>{formatTokens(bucket.confidence[group].tokens.input)}</td>
                <td>{formatTokens(bucket.confidence[group].tokens.output)}</td>
                <td>{formatTokens(bucket.confidence[group].tokens.cachedInput)}</td>
                <td>{formatTokens(bucket.confidence[group].tokens.reasoning)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="usage-assumptions" data-testid="usage-assumptions">
        <Text strong>估算假设</Text>
        {bucket.assumptions.length > 0 ? (
          <ul>
            {bucket.assumptions.map((assumption) => (
              <li key={assumption}>
                {assumptionLabel(assumption)}（{assumption}）
              </li>
            ))}
          </ul>
        ) : (
          <Text type="secondary">当前范围未使用回退假设</Text>
        )}
      </div>
    </Card>
  );
}

/** 任务列表中的单任务用量摘要；账本未启用时由调用方渲染占位符 */
export function TaskUsageCell({ context, taskId }: { context: UsageContext; taskId: string }) {
  const bucket = context.summary.byTask[taskId];
  if (!bucket) {
    return (
      <span className="task-usage-none" data-testid={`task-usage-${taskId}`}>
        无用量记录
      </span>
    );
  }
  const costParts: string[] = [];
  for (const [currency, amount] of Object.entries(bucket.costActual)) {
    costParts.push(`实际 ${currency} ${formatAmount(amount)}`);
  }
  for (const [currency, amount] of Object.entries(bucket.costEstimated)) {
    costParts.push(`估算 ${currency} ${formatAmount(amount)}`);
  }
  if (bucket.unknownCostEventCount > 0) {
    costParts.push(`未知 ${bucket.unknownCostEventCount} 次`);
  }
  return (
    <div className="task-usage-cell" data-testid={`task-usage-${taskId}`}>
      <span>
        {bucket.modelCount} 模型 · {bucket.eventCount} 次调用
      </span>
      <span>
        入 {formatTokens(bucket.tokens.input)} · 出 {formatTokens(bucket.tokens.output)}
      </span>
      <span className={costParts.length ? undefined : "task-usage-unknown"}>
        {costParts.length > 0 ? costParts.join(" · ") : "费用未知"}
      </span>
    </div>
  );
}

/** 任务详情中的模型调用明细 */
export function TaskUsageDetail({ context, taskId }: { context: UsageContext; taskId: string }) {
  const views = taskEventViews(context, taskId);
  if (views.length === 0) {
    return <Text type="secondary">该任务暂无用量记录</Text>;
  }
  return (
    <div className="usage-events">
      {views.map((view) => {
        const { event, cost } = view;
        return (
          <div className="usage-event" key={event.id} data-testid={`usage-event-${event.id}`}>
            <div className="usage-event-head">
              <Text className="task-id">{event.id}</Text>
              <Text type="secondary">{formatEventTime(event.occurredAt)}</Text>
              <Tag>{event.role}</Tag>
              <Text code>
                {event.provider}/{event.modelId}
              </Text>
            </div>
            <div className="usage-event-meta">
              来源：{SOURCE_LABELS[event.source]} · 可信：{CONFIDENCE_LABELS[event.confidence]}
              {event.agent ? ` · ${event.agent}` : ""}
            </div>
            <div className="usage-event-tokens">
              Token：入 {formatTokens(event.usage.inputTokens)}（缓存{" "}
              {formatTokens(event.usage.cachedInputTokens ?? 0)}）· 出{" "}
              {formatTokens(event.usage.outputTokens)}（推理{" "}
              {formatTokens(event.usage.reasoningTokens ?? 0)}）
            </div>
            <div className="usage-event-cost">{formatEventCostText(cost)}</div>
            {event.note ? <div className="usage-event-note">备注：{event.note}</div> : null}
          </div>
        );
      })}
    </div>
  );
}

function formatEventCostText(cost: UsageEventCost): string {
  if (cost.state === "unknown" || cost.amount === undefined || cost.currency === undefined) {
    return `费用：未知费用（${COST_BASIS_LABELS[cost.basis]}）`;
  }
  const parts = [
    `费用：${cost.currency} ${formatAmount(cost.amount, 4)}（${COST_BASIS_LABELS[cost.basis]} · ${COST_STATE_LABELS[cost.state]}）`,
  ];
  if (cost.priceId) parts.push(`价格版本 ${cost.priceId}`);
  if (cost.assumptions.length > 0) {
    parts.push(`估算假设：${cost.assumptions.map(assumptionLabel).join("；")}`);
  }
  return parts.join("，");
}
