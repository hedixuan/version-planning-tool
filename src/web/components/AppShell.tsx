import {
  ApiOutlined,
  AppstoreOutlined,
  BarsOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  ProjectOutlined,
  RadarChartOutlined,
} from "@ant-design/icons";
import { Button, Layout, Menu, Progress, Typography } from "antd";
import { useState, type ReactNode } from "react";

const { Sider, Header, Content } = Layout;
const { Text, Title } = Typography;

export type ViewName = "overview" | "list" | "board" | "releases" | "usage";

const navigation = [
  { key: "overview", icon: <RadarChartOutlined />, label: "概览" },
  { key: "list", icon: <BarsOutlined />, label: "任务列表" },
  { key: "board", icon: <AppstoreOutlined />, label: "状态看板" },
  { key: "releases", icon: <ProjectOutlined />, label: "版本路线" },
];

const usageNavigation = { key: "usage", icon: <ApiOutlined />, label: "模型用量" };

export interface SidebarRelease {
  id: string;
  name: string;
  percent: number;
}

export function AppShell({
  projectName,
  description,
  updatedAt,
  view,
  onViewChange,
  blocked,
  review,
  releases,
  usageEnabled = false,
  children,
}: {
  projectName: string;
  description?: string;
  updatedAt?: string;
  view: ViewName;
  onViewChange: (view: ViewName) => void;
  blocked: number;
  review: number;
  releases: SidebarRelease[];
  /** 配置了 usageFile 时才显示模型用量入口；未启用时不出现该视图 */
  usageEnabled?: boolean;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const navigationItems = usageEnabled ? [...navigation, usageNavigation] : navigation;
  return (
    <Layout className="app-shell">
      <Sider
        className="sidebar"
        width={224}
        collapsedWidth={72}
        collapsed={collapsed}
        breakpoint="lg"
        onBreakpoint={setCollapsed}
      >
        <div className="brand">
          <div className="brand-mark">V</div>
          {!collapsed && (
            <div>
              <Text strong>Version Plan</Text>
              <span>只读工作台</span>
            </div>
          )}
        </div>
        <Menu
          mode="inline"
          selectedKeys={[view]}
          items={navigationItems}
          onClick={({ key }) => onViewChange(key as ViewName)}
        />
        <aside className="sidebar-stats" aria-label="关注事项">
          <div className="sidebar-stat">
            <span>阻塞</span>
            <strong className="tone-danger">{blocked}</strong>
          </div>
          <div className="sidebar-stat">
            <span>待验收</span>
            <strong className="tone-warning">{review}</strong>
          </div>
        </aside>
        {!collapsed && (
          <div className="sidebar-releases" aria-label="版本进度">
            {releases.map((release) => (
              <button
                key={release.id}
                type="button"
                className="sidebar-release"
                onClick={() => onViewChange("releases")}
              >
                <span>{release.name}</span>
                <Progress percent={release.percent} size="small" showInfo={false} />
              </button>
            ))}
          </div>
        )}
        <Button
          className="collapse-button"
          type="text"
          icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
          onClick={() => setCollapsed((value) => !value)}
          aria-label={collapsed ? "展开导航" : "折叠导航"}
        >
          {!collapsed && "折叠导航"}
        </Button>
      </Sider>
      <Layout>
        <Header className="topbar">
          <div>
            <Title level={3}>{projectName}</Title>
            <Text type="secondary">{description ?? "版本计划工作台"}</Text>
          </div>
          <div className="topbar-meta">
            <span className="readonly-badge">只读</span>
            {updatedAt && <Text type="secondary">数据更新于 {formatDate(updatedAt)}</Text>}
          </div>
        </Header>
        <Content className="content">{children}</Content>
      </Layout>
    </Layout>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).format(date);
}
