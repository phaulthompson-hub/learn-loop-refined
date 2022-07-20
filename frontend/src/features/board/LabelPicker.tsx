import { useEffect, useRef, useState } from 'react';
import { Check, Plus, Tags } from 'lucide-react';
import { useToast } from '../../app/toast';
import { cx } from '../../lib/cx';
import { boardApi } from './api';
import { LabelChip } from './TaskBits';
import { LABEL_NAME_MAX, validateLabelName } from './validation';
import type { Label } from './types';

export const LABEL_COLORS = ['#2563eb', '#1d6d45', '#c2410c', '#9333ea', '#be123c', '#0f766e', '#a16207', '#475569'];

type LabelPickerProps = {
  workspaceId: number;
  labels: Label[];
  selected: Label[];
  canCreate: boolean;
  onChange: (labelIds: number[]) => void;
  onCreated: (label: Label) => void;
};

/** Popover to toggle a task's labels; admins can create a new label from the search text. */
export function LabelPicker({ workspaceId, labels, selected, canCreate, onChange, onCreated }: LabelPickerProps) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [color, setColor] = useState(LABEL_COLORS[0]);
  const [creating, setCreating] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const selectedIds = selected.map((label) => label.id);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => !root.current?.contains(event.target as Node) && setOpen(false);
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const visible = labels.filter((label) => label.name.toLowerCase().includes(query.trim().toLowerCase()));
  const nameError = query.trim() ? validateLabelName(query, labels) : undefined;
  const offerCreate = canCreate && query.trim() !== '' && !nameError;

  const toggle = (id: number) => onChange(selectedIds.includes(id) ? selectedIds.filter((l) => l !== id) : [...selectedIds, id]);

  const create = async () => {
    setCreating(true);
    try {
      const label = await boardApi.createLabel(workspaceId, query.trim(), color);
      onCreated(label);
      onChange([...selectedIds, label.id]);
      setQuery('');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };

  return (
    <div className="label-picker" ref={root}>
      <div className="label-picker-value">
        {selected.length ? selected.map((label) => <LabelChip key={label.id} label={label} />) : <span className="muted">No labels</span>}
        <button type="button" ref={trigger} className="ghost small" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <Tags /> Edit
        </button>
      </div>
      {open && (
        <div
          className="label-popover"
          role="dialog"
          aria-label="Choose labels"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              close();
            }
          }}
        >
          <input
            className="input"
            autoFocus
            value={query}
            maxLength={LABEL_NAME_MAX}
            placeholder={canCreate ? 'Find or create a label…' : 'Find a label…'}
            aria-label="Find a label"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                if (visible.length === 1) toggle(visible[0].id);
                else if (offerCreate) void create();
              }
            }}
          />
          <ul className="label-options-list" aria-label="Labels">
            {visible.map((label) => {
              const on = selectedIds.includes(label.id);
              return (
                <li key={label.id}>
                  <button type="button" className={cx('label-row', on && 'active')} aria-pressed={on} onClick={() => toggle(label.id)}>
                    <span className="color-dot" style={{ background: label.color }} />
                    <span>{label.name}</span>
                    {on && <Check aria-hidden />}
                  </button>
                </li>
              );
            })}
            {!visible.length && !offerCreate && <li className="muted label-empty">{labels.length ? 'No matching labels.' : 'This workspace has no labels yet.'}</li>}
          </ul>
          {offerCreate && (
            <div className="label-create">
              <div className="label-swatches" role="radiogroup" aria-label="Label colour">
                {LABEL_COLORS.map((swatch) => (
                  <button
                    key={swatch}
                    type="button"
                    role="radio"
                    aria-checked={color === swatch}
                    aria-label={swatch}
                    className={cx('label-swatch', color === swatch && 'active')}
                    style={{ background: swatch }}
                    onClick={() => setColor(swatch)}
                  />
                ))}
              </div>
              <button type="button" className="secondary small wide" disabled={creating} onClick={() => void create()}>
                <Plus /> Create “{query.trim()}”
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
