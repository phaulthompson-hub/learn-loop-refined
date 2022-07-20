import type { Ref } from 'react';
import { Search, User, UserX, X } from 'lucide-react';
import { Avatar } from '../../components/Avatar';
import { cx } from '../../lib/cx';
import { activeFilterCount, DUE_FILTER_LABELS, EMPTY_FILTERS, PRIORITIES, PRIORITY_LABELS, toggleAssignee, type BoardFilters, type DueFilter } from './board';
import type { BoardMember, CourseBrief, Label, TaskPriority } from './types';

type FilterBarProps = {
  filters: BoardFilters;
  onChange: (filters: BoardFilters) => void;
  members: BoardMember[];
  labels: Label[];
  courses: CourseBrief[];
  meId: number;
  shown: number;
  total: number;
  searchRef: Ref<HTMLInputElement>;
};

const toId = (value: string) => (value ? Number(value) : null);

/** Search, people toggles and dropdown filters. Every change is written to the URL by the page. */
export function FilterBar({ filters, onChange, members, labels, courses, meId, shown, total, searchRef }: FilterBarProps) {
  const onlyMine = filters.assignees.length === 1 && filters.assignees[0] === meId;
  const active = activeFilterCount(filters);

  return (
    <section className="board-filters" aria-label="Filter tasks">
      <div className="search-input board-search">
        <Search aria-hidden />
        <input
          ref={searchRef}
          className="input"
          type="search"
          value={filters.q}
          maxLength={100}
          placeholder="Search tasks, keys, labels…"
          aria-label="Search tasks"
          onChange={(event) => onChange({ ...filters, q: event.target.value })}
        />
        <kbd className="board-hide-sm" aria-hidden>
          /
        </kbd>
      </div>

      <div className="people-filter" role="group" aria-label="Filter by assignee">
        <button
          type="button"
          className={cx('pill-toggle', onlyMine && 'active')}
          aria-pressed={onlyMine}
          onClick={() => onChange({ ...filters, assignees: onlyMine ? [] : [meId] })}
        >
          <User /> Only my tasks
        </button>
        <span className="avatar-toggles">
          {members.map((member) => {
            const pressed = filters.assignees.includes(member.id);
            return (
              <button
                key={member.id}
                type="button"
                className={cx('avatar-toggle', pressed && 'active')}
                aria-pressed={pressed}
                aria-label={`Tasks assigned to ${member.name}`}
                title={member.name}
                onClick={() => onChange(toggleAssignee(filters, member.id))}
              >
                <Avatar name={member.name} color={member.avatar_color} size="sm" />
              </button>
            );
          })}
          <button
            type="button"
            className={cx('avatar-toggle', 'unassigned-toggle', filters.assignees.includes('none') && 'active')}
            aria-pressed={filters.assignees.includes('none')}
            aria-label="Unassigned tasks"
            title="Unassigned"
            onClick={() => onChange(toggleAssignee(filters, 'none'))}
          >
            <UserX />
          </button>
        </span>
      </div>

      <div className="select-filters">
        <select className="input" aria-label="Label" value={filters.label ?? ''} onChange={(event) => onChange({ ...filters, label: toId(event.target.value) })}>
          <option value="">All labels</option>
          {labels.map((label) => (
            <option key={label.id} value={label.id}>
              {label.name}
            </option>
          ))}
        </select>
        <select
          className="input"
          aria-label="Priority"
          value={filters.priority ?? ''}
          onChange={(event) => onChange({ ...filters, priority: (event.target.value || null) as TaskPriority | null })}
        >
          <option value="">Any priority</option>
          {PRIORITIES.map((priority) => (
            <option key={priority} value={priority}>
              {PRIORITY_LABELS[priority]}
            </option>
          ))}
        </select>
        <select className="input" aria-label="Course" value={filters.course ?? ''} onChange={(event) => onChange({ ...filters, course: toId(event.target.value) })}>
          <option value="">All courses</option>
          {courses.map((course) => (
            <option key={course.id} value={course.id}>
              {course.title}
            </option>
          ))}
        </select>
        <select
          className="input"
          aria-label="Due date"
          value={filters.due ?? ''}
          onChange={(event) => onChange({ ...filters, due: (event.target.value || null) as DueFilter | null })}
        >
          <option value="">Any due date</option>
          {(Object.keys(DUE_FILTER_LABELS) as DueFilter[]).map((due) => (
            <option key={due} value={due}>
              {DUE_FILTER_LABELS[due]}
            </option>
          ))}
        </select>
      </div>

      <div className="filter-summary" aria-live="polite">
        {active > 0 ? (
          <>
            <span className="muted">
              {shown} of {total} tasks
            </span>
            <button type="button" className="ghost small" onClick={() => onChange(EMPTY_FILTERS)}>
              <X /> Clear {active === 1 ? 'filter' : `${active} filters`}
            </button>
          </>
        ) : (
          <span className="muted">{total} tasks</span>
        )}
      </div>
    </section>
  );
}
