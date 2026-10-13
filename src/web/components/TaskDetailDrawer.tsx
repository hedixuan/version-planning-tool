import {
  BranchesOutlined,
  CheckSquareOutlined,
  FileTextOutlined,
  LinkOutlined,
} from "@ant-design/icons";
import { Alert, Descriptions, Drawer, List, Space, Tag, Typography } from "antd";
import type { ReactNode } from "react";
import type { Requirement, Roadmap } from "../../types";
import { priorityLabel } from "../lib/meta";
import { StatusTag } from "./TaskPrimitives";

const { Text, Title } = Typography;

export function TaskDetailDrawer({
  roadmap,
  requirement,
  onClose,
  onNavigate,
}: {
  roadmap: Roadmap;
  requirement?: Requirement;
  onClose: () => void;
  onNavigate: (id: string) => void;
}) {
  const release = requirement
    ? roadmap.releases.find((item) => item.id === requirement.releaseId)
    : undefined;
  return (
    <Drawer
      className="detail-drawer"
      title={requirement ? <><Text className="task-id">{requirement.id}</Text><Title level={4}>{requirement.title}</Title></> : "任务详情"}
      width={600}
      open={Boolean(requirement)}
      onClose={onClose}
      destroyOnHidden
    >
      {requirement && (
        <Space direction="vertical" size={20} className="detail-stack">
          <Descriptions column={1} bordered size="small" title="概要">
            <Descriptions.Item label="状态"><StatusTag status={requirement.status} /></Descriptions.Item>
            <Descriptions.Item label="版本">{release ? `${release.id} · ${release.name}` : requirement.releaseId}</Descriptions.Item>
            <Descriptions.Item label="优先级">{priorityLabel(requirement.priority)}</Descriptions.Item>
            <Descriptions.Item label="负责人">{requirement.owner ?? "未分配"}</Descriptions.Item>
            <Descriptions.Item label="标签">
              {(requirement.tags ?? []).length
                ? requirement.tags?.map((tag) => <Tag key={tag}>{tag}</Tag>)
                : "无标签"}
            </Descriptions.Item>
          </Descriptions>

          <DetailSection title="依赖" icon={<BranchesOutlined />}>
            <List
              size="small"
              dataSource={requirement.dependsOn}
              locale={{ emptyText: "无依赖" }}
              renderItem={(id) => {
                const dependency = roadmap.requirements.find((item) => item.id === id);
                return (
                  <List.Item>
                    {dependency ? (
                      <button className="dependency-link" type="button" onClick={() => onNavigate(id)}>
                        <StatusTag status={dependency.status} />
                        <span><Text className="task-id">{id}</Text><Text>{dependency.title}</Text></span>
                      </button>
                    ) : (
                      <Alert
                        className="missing-reference"
                        type="error"
                        showIcon
                        message={`缺失引用：${id}`}
                        description="路线数据中不存在该依赖任务。"
                      />
                    )}
                  </List.Item>
                );
              }}
            />
          </DetailSection>

          <DetailSection title="验收条件" icon={<CheckSquareOutlined />}>
            <List
              size="small"
              dataSource={requirement.acceptance}
              locale={{ emptyText: "未填写验收条件" }}
              renderItem={(item, index) => <List.Item><span className="list-index">{index + 1}</span>{item}</List.Item>}
            />
          </DetailSection>

          <DetailSection title="证据" icon={<LinkOutlined />}>
            <List
              size="small"
              dataSource={requirement.evidence}
              locale={{ emptyText: "暂无证据" }}
              renderItem={(item) => <List.Item><Text code>{item}</Text></List.Item>}
            />
          </DetailSection>

          <DetailSection title="来源与时间" icon={<FileTextOutlined />}>
            <Descriptions column={1} size="small">
              <Descriptions.Item label="来源">{requirement.sourcePath ?? "未记录"}</Descriptions.Item>
              <Descriptions.Item label="更新时间">{formatDate(requirement.updatedAt)}</Descriptions.Item>
            </Descriptions>
          </DetailSection>
        </Space>
      )}
    </Drawer>
  );
}

function DetailSection({
  title,
  icon,
  children,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="detail-section">
      <Title level={5}>{icon}{title}</Title>
      {children}
    </section>
  );
}

function formatDate(value?: string) {
  if (!value) return "未记录";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}
