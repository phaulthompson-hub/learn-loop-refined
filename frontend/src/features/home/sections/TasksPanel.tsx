import { Link } from 'react-router-dom';
import { ListChecks } from 'lucide-react';
import { cx } from '../../../lib/cx';
import { humanize, plural } from '../../../lib/format';
import { dueBadge, PRIORITY_TONE } from '../homeLogic';
import type { Home } from '../types';

/** Open board tasks assigned to me, soonest due first, with due and priority badges. */
export function TasksPanel({ tasks }: { tasks: Home['tasks'] }) {
  return (
    <section className="panel home-panel" aria-labelledby="tasks-title">
      <header className="panel-head">
        <h2 id="tasks-title">
          <ListChecks /> My tasks
        </h2>
        {tasks.total_open > 0 && (
          <span className="panel-count">
            {plural(tasks.total_open, 'open task')}
            {tasks.overdue > 0 && <b className="bad"> · {tasks.overdue} overdue</b>}
          </span>
        )}
      </header>
      {tasks.items.length === 0 ? (
        <div className="section-empty">
          <p>
            <b>Nothing assigned to you.</b> Tasks from the study board show up here when they land on your plate.
          </p>
          <Link className="secondary small" to="/board">
            Open board
          </Link>
        </div>
      ) : (
        <ul className="task-list">
          {tasks.items.map((task) => {
            const due = dueBadge(task);
            return (
              <li key={task.id} className={cx(task.overdue && 'overdue')}>
                <Link to={`/board?task=${task.id}`} className="task-row">
                  <span className="home-task-key">{task.key}</span>
                  <span className="home-task-title">
                    <b>{task.title}</b>
                    <small>
                      {task.course && (
                        <>
                          <span className="color-dot" style={{ background: task.course.color }} /> {task.course.title} ·{' '}
                        </>
                      )}
                      {humanize(task.status)}
                    </small>
                  </span>
                  <span className="task-badges">
                    <span className={cx('badge', due.tone)}>{due.text}</span>
                    <span className={cx('badge priority', PRIORITY_TONE[task.priority] ?? 'muted')}>{task.priority}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {tasks.total_open > tasks.items.length && (
        <Link className="panel-more" to="/board">
          View all {tasks.total_open} tasks
        </Link>
      )}
    </section>
  );
}
