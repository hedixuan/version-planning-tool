import {
  BranchesOutlined,
  ExclamationCircleOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { Card, Tag, Typography } from "antd";
import type { Requirement, Status } from "../../types";
import { openOnKeyboard } from "../lib/keyboard";
import { PRIORITY_META, STATUS_META, priorityLabel } from "../lib/meta";

const { Text } = Typography;

export function StatusTag({ status }: { status: Status }) {
  const meta = STATUS_META[status];
  return (
    <Tag className={`semantic-tag tone-${meta.tone}`} color={meta.color}>
      {meta.label}
    </Tag>
  );
}

export function PriorityTag({ priority }: { priority?: string }) {
  if (!priority) return null;
  const tone = PRIORITY_META[priority.toLocaleLowerCase()]?.tone ?? "neutral";
  return (
    <Tag className={`semantic-tag tone-${tone}`}>
      {priorityLabel(priority)}
    </Tag>
  );
}

export function TaskCard({
  requirement,
  releaseName,
  hasMissingDependency,
  onOpen,
}: {
  requirement: Requirement;
  releaseName?: string;
  hasMissingDependency?: boolean;
  onOpen: (item: Requirement) => void;
}) {
  const blocked = requirement.status === "blocked";
  return (
    <Card
      className="task-card"
      size="small"
      hoverable
      role="button"
      tabIndex={0}
      aria-label={`打开任务 ${requirement.id} ${requirement.title}`}
      onClick={() => onOpen(requirement)}
      onKeyDown={(event) => openOnKeyboard(event, () => onOpen(requirement))}
    >
      <div className="task-card-head">
        <Text className="task-id">{requirement.id}</Text>
        <PriorityTag priority={requirement.priority} />
      </div>
      <Text strong className="task-title">{requirement.title}</Text>
      <div className="task-meta">
        <span><UserOutlined /> {requirement.owner ?? "未分配"}</span>
        <span>{releaseName ?? requirement.releaseId}</span>
      </div>
      <div className="task-tags">
        {(requirement.tags ?? []).slice(0, 3).map((tag) => <Tag key={tag}>{tag}</Tag>)}
      </div>
      {(requirement.dependsOn.length > 0 || blocked || hasMissingDependency) && (
        <div className={`dependency-hint ${blocked || hasMissingDependency ? "is-danger" : ""}`}>
          {blocked || hasMissingDependency ? <ExclamationCircleOutlined /> : <BranchesOutlined />}
          {hasMissingDependency
            ? "存在缺失依赖"
            : blocked
              ? "任务已阻塞"
              : `${requirement.dependsOn.length} 项依赖`}
        </div>
      )}
    </Card>
  );
}
