import { useState } from 'react';
import { ArrowDown, ArrowUp, ListChecks, Plus, Trash2 } from 'lucide-react';
import { useToast } from '../../app/toast';
import { cx } from '../../lib/cx';
import { boardApi } from './api';
import { ProgressBar } from './TaskBits';
import { CHECKLIST_TEXT_MAX } from './validation';
import type { ChecklistItem } from './types';

type ChecklistPanelProps = { taskId: number; items: ChecklistItem[]; onChange: (items: ChecklistItem[]) => void };

function swap<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

/** Checklist with optimistic toggles, inline rename, reordering and quick add. */
export function ChecklistPanel({ taskId, items, onChange }: ChecklistPanelProps) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<{ id: number; text: string } | null>(null);
  const done = items.filter((item) => item.done).length;

  /** Apply `next` immediately and restore the previous list if the request fails. */
  const optimistic = async (next: ChecklistItem[], request: () => Promise<unknown>) => {
    const previous = items;
    onChange(next);
    try {
      await request();
    } catch (err) {
      onChange(previous);
      toast.error((err as Error).message);
    }
  };

  const add = async () => {
    const value = text.trim();
    if (!value) return;
    setAdding(true);
    try {
      onChange([...items, await boardApi.addItem(taskId, value)]);
      setText('');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setAdding(false);
    }
  };

  const toggle = (item: ChecklistItem) =>
    optimistic(
      items.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)),
      () => boardApi.toggleItem(taskId, item.id),
    );

  const rename = () => {
    if (!editing) return;
    const value = editing.text.trim();
    const item = items.find((i) => i.id === editing.id);
    setEditing(null);
    if (!item || !value || value === item.text) return;
    void optimistic(
      items.map((i) => (i.id === item.id ? { ...i, text: value } : i)),
      () => boardApi.renameItem(taskId, item.id, value),
    );
  };

  const move = (index: number, offset: number) => {
    const next = swap(items, index, index + offset).map((item, position) => ({ ...item, position }));
    void optimistic(next, () => boardApi.reorderItems(taskId, next.map((i) => i.id)));
  };

  const remove = (item: ChecklistItem) =>
    optimistic(
      items.filter((i) => i.id !== item.id),
      () => boardApi.removeItem(taskId, item.id),
    );

  return (
    <section className="drawer-section" aria-labelledby="task-checklist-title">
      <h3 id="task-checklist-title">
        <ListChecks /> Checklist
        {items.length > 0 && (
          <span className="board-count">
            {done}/{items.length}
          </span>
        )}
      </h3>
      {items.length > 0 && <ProgressBar done={done} total={items.length} label="Checklist progress" />}
      <ul className="task-checklist">
        {items.map((item, index) => (
          <li key={item.id} className={cx(item.done && 'is-done')}>
            <input type="checkbox" checked={item.done} aria-label={`Mark "${item.text}" as ${item.done ? 'not done' : 'done'}`} onChange={() => void toggle(item)} />
            {editing?.id === item.id ? (
              <input
                className="input task-checklist-edit"
                autoFocus
                value={editing.text}
                maxLength={CHECKLIST_TEXT_MAX}
                aria-label="Checklist item text"
                onChange={(event) => setEditing({ id: item.id, text: event.target.value })}
                onBlur={rename}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') rename();
                  if (event.key === 'Escape') {
                    event.stopPropagation();
                    setEditing(null);
                  }
                }}
              />
            ) : (
              <button type="button" className="task-checklist-text" title="Click to rename" onClick={() => setEditing({ id: item.id, text: item.text })}>
                {item.text}
              </button>
            )}
            <span className="task-checklist-actions">
              <button type="button" className="icon-only" aria-label={`Move "${item.text}" up`} disabled={index === 0} onClick={() => move(index, -1)}>
                <ArrowUp />
              </button>
              <button type="button" className="icon-only" aria-label={`Move "${item.text}" down`} disabled={index === items.length - 1} onClick={() => move(index, 1)}>
                <ArrowDown />
              </button>
              <button type="button" className="icon-only" aria-label={`Delete "${item.text}"`} onClick={() => void remove(item)}>
                <Trash2 />
              </button>
            </span>
          </li>
        ))}
      </ul>
      <form
        className="task-checklist-add"
        onSubmit={(event) => {
          event.preventDefault();
          void add();
        }}
      >
        <input className="input" value={text} maxLength={CHECKLIST_TEXT_MAX} placeholder="Add an item…" aria-label="New checklist item" disabled={adding} onChange={(event) => setText(event.target.value)} />
        <button type="submit" className="secondary small" disabled={adding || !text.trim()}>
          <Plus /> Add
        </button>
      </form>
    </section>
  );
}
