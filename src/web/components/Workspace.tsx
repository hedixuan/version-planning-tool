import type { InputRef } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Roadmap } from "../../types";
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

export function Workspace({ roadmap }: { roadmap: Roadmap }) {
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

  const viewProps = { roadmap, items, onOpen: (item: { id: string }) => setSelectedId(item.id) };
  return (
    <AppShell
      projectName={roadmap.project.name}
      description={roadmap.project.description}
      updatedAt={roadmap.updatedAt}
      view={view}
      onViewChange={setView}
      blocked={stats.blocked}
      review={stats.review}
      releases={releaseProgress}
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
        {view === "overview" && <OverviewView {...viewProps} />}
        {view === "list" && <TaskListView {...viewProps} />}
        {view === "board" && <KanbanView {...viewProps} />}
        {view === "releases" && <ReleasesView {...viewProps} />}
      </main>
      <TaskDetailDrawer
        roadmap={roadmap}
        requirement={selected}
        onClose={() => setSelectedId(undefined)}
        onNavigate={setSelectedId}
      />
    </AppShell>
  );
}
