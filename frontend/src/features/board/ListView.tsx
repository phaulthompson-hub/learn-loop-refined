import { useMemo } from 'react';
import { Avatar } from '../../components/Avatar';
import { DataTable, type Column } from '../../components/DataTable';
import { relativeTime } from '../../lib/format';
import { PRIORITY_RANK, STATUS_LABELS, STATUSES } from './board';
import { ChecklistMeter, DueBadge, LabelChip, PriorityIcon } from './TaskBits';
import type { Task } from './types';

type ListViewProps = { tasks: Task[]; now: Date; onOpen: (task: Task) => void };

/** Sortable table of the filtered tasks; rows open the task drawer. */
export function ListView({ tasks, now, onOpen }: ListViewProps) {
  const columns = useMemo<Column<Task>[]>(
    () => [
      { key: 'key', header: 'Key', width: '90px', render: (t) => <span className="task-key">{t.key}</span>, sortValue: (t) => t.number },
      {
        key: 'title',
        header: 'Task',
        render: (t) => (
          <div className="list-title">
            <button
              type="button"
              className="board-link-button"
              onClick={(event) => {
                event.stopPropagation();
                onOpen(t);
              }}
            >
              {t.title}
            </button>
            {t.labels.length > 0 && (
              <span className="task-labels">
                {t.labels.map((label) => (
                  <LabelChip key={label.id} label={label} />
                ))}
              </span>
            )}
          </div>
        ),
        sortValue: (t) => t.title,
      },
      {
        key: 'status',
        header: 'Status',
        render: (t) => <span className={`task-status-pill task-status-${t.status}`}>{STATUS_LABELS[t.status]}</span>,
        sortValue: (t) => STATUSES.indexOf(t.status) * 1e9 + t.position,
      },
      { key: 'priority', header: 'Priority', render: (t) => <PriorityIcon priority={t.priority} withLabel />, sortValue: (t) => -PRIORITY_RANK[t.priority] },
      {
        key: 'assignee',
        header: 'Assignee',
        render: (t) =>
          t.assignee ? (
            <span className="row">
              <Avatar name={t.assignee.name} color={t.assignee.avatar_color} size="xs" />
              <span className="board-hide-sm">{t.assignee.name}</span>
            </span>
          ) : (
            <span className="muted">Unassigned</span>
          ),
        sortValue: (t) => t.assignee?.name,
      },
      {
        key: 'due',
        header: 'Due',
        render: (t) => (t.due_date ? <DueBadge due={t.due_date} status={t.status} now={now} /> : <span className="muted">—</span>),
        sortValue: (t) => t.due_date,
      },
      { key: 'estimate', header: 'Pts', align: 'right', render: (t) => t.estimate ?? '—', sortValue: (t) => t.estimate },
      {
        key: 'checklist',
        header: 'Checklist',
        render: (t) => <ChecklistMeter done={t.checklist_done} total={t.checklist_total} />,
        sortValue: (t) => (t.checklist_total ? t.checklist_done / t.checklist_total : null),
      },
      { key: 'updated', header: 'Updated', render: (t) => relativeTime(t.updated_at, now), sortValue: (t) => t.updated_at },
    ],
    [now, onOpen],
  );

  return (
    <div className="panel board-list">
      <DataTable
        rows={tasks}
        columns={columns}
        rowKey={(t) => t.id}
        initialSort={{ key: 'status', direction: 'asc' }}
        pageSize={15}
        onRowClick={onOpen}
        caption="Study tasks"
        rowClassName={(t) => (t.overdue ? 'is-overdue' : undefined)}
        empty="No tasks match these filters."
      />
    </div>
  );
}
