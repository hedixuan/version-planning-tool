import { Alert, App as AntApp, Button, Skeleton } from "antd";
import { useEffect, useState } from "react";
import type { Roadmap } from "../types";
import { Workspace } from "./components/Workspace";
import { loadRoadmap, type RoadmapPayload } from "./lib/api";

function readSessionToken(): string | null {
  return new URLSearchParams(window.location.search).get("token");
}

export function App() {
  const token = readSessionToken();
  const [payload, setPayload] = useState<RoadmapPayload>();
  const [error, setError] = useState<string | undefined>(
    token ? undefined : "缺少会话令牌，请使用 CLI 输出的完整地址重新打开看板",
  );
  const [loading, setLoading] = useState(Boolean(token));
  const [requestId, setRequestId] = useState(0);

  useEffect(() => {
    const sessionToken = readSessionToken();
    if (!sessionToken) return;
    let cancelled = false;
    void loadRoadmap(sessionToken)
      .then((data) => {
        if (cancelled) return;
        setPayload(data);
        setError(undefined);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setPayload(undefined);
        setError(reason instanceof Error ? reason.message : "无法读取版本计划");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [requestId]);

  const roadmap: Roadmap | undefined = payload?.roadmap;

  if (loading) {
    return (
      <div className="state-panel loading-panel" aria-label="正在加载版本计划">
        <Skeleton active paragraph={{ rows: 10 }} />
      </div>
    );
  }
  if (error || !roadmap) {
    return (
      <Alert
        className="state-panel"
        type="error"
        showIcon
        message="版本计划加载失败"
        description={error ?? "服务未返回数据"}
        action={
          token ? (
            <Button
              size="small"
              type="primary"
              onClick={() => {
                setLoading(true);
                setError(undefined);
                setRequestId((value) => value + 1);
              }}
            >
              重新加载
            </Button>
          ) : undefined
        }
      />
    );
  }

  return (
    <AntApp>
      <Workspace roadmap={roadmap} usage={payload?.usage ?? null} />
    </AntApp>
  );
}
