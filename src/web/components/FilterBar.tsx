import { FilterOutlined, SearchOutlined } from "@ant-design/icons";
import { Button, Input, Select, Tag, Typography, type InputRef } from "antd";
import type { RefObject } from "react";
import { STATUSES, type Roadmap, type Status } from "../../types";
import { STATUS_META, priorityLabel } from "../lib/meta";
import {
  EMPTY_FILTERS,
  getFilterOptions,
  hasActiveFilters,
  type Filters,
  type SortKey,
} from "../lib/view-model";

const { Text } = Typography;

export function FilterBar({
  roadmap,
  filters,
  sort,
  resultCount,
  searchRef,
  onFiltersChange,
  onSortChange,
}: {
  roadmap: Roadmap;
  filters: Filters;
  sort: SortKey;
  resultCount: number;
  searchRef: RefObject<InputRef | null>;
  onFiltersChange: (filters: Filters) => void;
  onSortChange: (sort: SortKey) => void;
}) {
  const options = getFilterOptions(roadmap);
  const update = <Key extends keyof Filters>(key: Key, value: Filters[Key]) =>
    onFiltersChange({ ...filters, [key]: value });
  const active = hasActiveFilters(filters);
  const chips = [
    ...filters.statuses.map((value) => ({
      key: `status-${value}`,
      label: STATUS_META[value].label,
      remove: () => update("statuses", filters.statuses.filter((item) => item !== value)),
    })),
    ...filters.releaseIds.map((value) => ({
      key: `release-${value}`,
      label: roadmap.releases.find((item) => item.id === value)?.name ?? value,
      remove: () => update("releaseIds", filters.releaseIds.filter((item) => item !== value)),
    })),
    ...filters.priorities.map((value) => ({
      key: `priority-${value}`,
      label: priorityLabel(value),
      remove: () => update("priorities", filters.priorities.filter((item) => item !== value)),
    })),
    ...(["owners", "tags"] as const).flatMap((key) =>
      filters[key].map((value) => ({
        key: `${key}-${value}`,
        label: value,
        remove: () => update(key, filters[key].filter((item) => item !== value)),
      })),
    ),
  ];

  return (
    <section className="filter-panel" aria-label="任务筛选">
      <div className="filter-controls">
        <Input
          ref={searchRef}
          className="search-input"
          prefix={<SearchOutlined />}
          allowClear
          placeholder="搜索 ID、标题、负责人或标签  Ctrl+K"
          value={filters.query}
          onChange={(event) => update("query", event.target.value)}
          aria-label="搜索任务"
        />
        <Select
          mode="multiple"
          maxTagCount="responsive"
          placeholder="状态"
          value={filters.statuses}
          onChange={(value) => update("statuses", value as Status[])}
          options={STATUSES.map((status) => ({ value: status, label: STATUS_META[status].label }))}
          aria-label="筛选状态"
        />
        <Select
          mode="multiple"
          maxTagCount="responsive"
          placeholder="版本"
          value={filters.releaseIds}
          onChange={(value) => update("releaseIds", value)}
          options={roadmap.releases.map((release) => ({
            value: release.id,
            label: release.name,
          }))}
          aria-label="筛选版本"
        />
        <Select
          mode="multiple"
          maxTagCount="responsive"
          placeholder="优先级"
          value={filters.priorities}
          onChange={(value) => update("priorities", value)}
          options={options.priorities.map((value) => ({
            value,
            label: priorityLabel(value),
          }))}
          aria-label="筛选优先级"
        />
        <Select
          mode="multiple"
          maxTagCount="responsive"
          placeholder="负责人"
          value={filters.owners}
          onChange={(value) => update("owners", value)}
          options={options.owners.map((value) => ({ value, label: value }))}
          aria-label="筛选负责人"
        />
        <Select
          mode="multiple"
          maxTagCount="responsive"
          placeholder="标签"
          value={filters.tags}
          onChange={(value) => update("tags", value)}
          options={options.tags.map((value) => ({ value, label: value }))}
          aria-label="筛选标签"
        />
        <Select<SortKey>
          className="sort-select"
          value={sort}
          onChange={onSortChange}
          aria-label="任务排序"
          options={[
            { value: "updatedAt", label: "最近更新" },
            { value: "priority", label: "优先级" },
            { value: "id", label: "任务 ID" },
            { value: "title", label: "标题" },
          ]}
        />
      </div>
      <div className="filter-summary">
        <div className="active-filters">
          <FilterOutlined />
          <Text type="secondary">{resultCount} 项结果</Text>
          {filters.query && (
            <Tag closable onClose={() => update("query", "")}>搜索：{filters.query}</Tag>
          )}
          {chips.map((chip) => (
            <Tag key={chip.key} closable onClose={chip.remove}>{chip.label}</Tag>
          ))}
        </div>
        <Button
          type="link"
          size="small"
          disabled={!active}
          onClick={() => onFiltersChange({ ...EMPTY_FILTERS })}
        >
          重置筛选
        </Button>
      </div>
    </section>
  );
}
