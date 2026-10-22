import type { InputRef } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Roadmap, UsageApiPayload } from "../../types";
import {
  EMPTY_FILTERS,
  calculateReleaseProgress,
  calculateStats,
  filterRequirements,
  sortRequirements,
  type Filters,
  type SortKey,
} from "../lib/view-model";
import { AppShell, type ViewName } from "./AppShell";
import { FilterBar } from "./FilterBar";
import { TaskDetailDrawer } from "./TaskDetailDrawer";
import { KanbanView, OverviewView, ReleasesView, TaskListView } from "./Views";
import { UsageView } from "./UsageView";

export function Workspace({
  roadmap,
  usage = null,
}: {
  roadmap: Roadmap;
  usage?: UsageApiPayload | null;
}) {
  const [view, setView] = useState<ViewName>("overview");
  const [filters, setFilters] = useState<Filters>({ ...EMPTY_FILTERS });
  const [sort, setSort] = useState<SortKey>("updatedAt");
  const [selectedId, setSelectedId] = useState<string>();
  const searchRef = useRef<InputRef>(null);
  const items = useMemo(
    () => sortRequirements(filterRequirements(roadmap.requirements, filters), sort),
    [filters, roadmap.requirements, sort],
  );
  const selected = roadmap.requirements.find((item) => item.id === selectedId);
  const stats = useMemo(() => calculateStats(roadmap.requirements), [roadmap.requirements]);
  const releaseProgress = useMemo(
    () =>
      roadmap.releases.map((release) => ({
        id: release.id,
        name: release.name,
        percent: calculateReleaseProgress(release, roadmap.requirements).percent,
      })),
    [roadmap.releases, roadmap.requirements],
  );
  // 账本未启用时不展示模型用量视图，避免虚构统计
  const effectiveView: ViewName = view === "usage" && !usage ? "overview" : view;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (event.key === "Escape" && !selectedId) {
        setFilters({ ...EMPTY_FILTERS });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedId]);

  const viewProps = { roadmap, items, usage, onOpen: (item: { id: string }) => setSelectedId(item.id) };
  return (
    <AppShell
      projectName={roadmap.project.name}
      description={roadmap.project.description}
      updatedAt={roadmap.updatedAt}
      view={effectiveView}
      onViewChange={setView}
      blocked={stats.blocked}
      review={stats.review}
      releases={releaseProgress}
      usageEnabled={Boolean(usage)}
    >
      <FilterBar
        roadmap={roadmap}
        filters={filters}
        sort={sort}
        resultCount={items.length}
        searchRef={searchRef}
        onFiltersChange={setFilters}
        onSortChange={setSort}
      />
      <main className="view-content">
        {effectiveView === "overview" && <OverviewView {...viewProps} />}
        {effectiveView === "list" && <TaskListView {...viewProps} />}
        {effectiveView === "board" && <KanbanView {...viewProps} />}
        {effectiveView === "releases" && <ReleasesView {...viewProps} />}
        {effectiveView === "usage" && usage && (
          <UsageView roadmap={roadmap} items={items} usage={usage} onOpen={viewProps.onOpen} />
        )}
      </main>
      <TaskDetailDrawer
        roadmap={roadmap}
        requirement={selected}
        usage={usage}
        onClose={() => setSelectedId(undefined)}
        onNavigate={setSelectedId}
      />
    </AppShell>
  );
}
