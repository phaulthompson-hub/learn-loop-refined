import { useEffect, useId, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Archive, ArchiveRestore, ArrowDown, ArrowUp, Check, Copy, Pencil, RotateCcw, Rocket, Save, ShieldAlert, Trash2, Undo2, X } from 'lucide-react';
import { useToast } from '../../app/toast';
import { Field } from '../../components/Field';
import { ConfirmDialog, Modal } from '../../components/Modal';
import { EmptyState, ErrorBanner, LevelBadge } from '../../components/ui';
import { useLoader } from '../../hooks/useLoader';
import { plural } from '../../lib/format';
import {
  CONCEPT_NAME_MAX,
  CONCEPT_SUMMARY_MAX,
  DESCRIPTION_MAX,
  SUBJECT_MAX,
  TITLE_MAX,
  validateConceptName,
  validateConceptSummary,
  validateDescription,
  validateSubject,
  validateTitle,
} from '../../lib/validation';
import { courseApi } from './api';
import { DIFFICULTIES, DIFFICULTY_LABELS } from './catalog';
import { ColorSwatches } from './components/ColorSwatches';
import { DuplicateDialog } from './components/DuplicateDialog';
import { TagInput } from './components/TagInput';
import { useCourse } from './courseContext';
import { changedDetails, confirmsTitle, detailsOf, moveItem } from './settings';
import type { Concept, Course, CourseDetails, CourseStatus } from './types';

type DetailErrors = Partial<Record<'title' | 'subject' | 'description', string>>;

function DetailsForm({ course, onSaved }: { course: Course; onSaved: (course: Course) => void }) {
  const toast = useToast();
  const saved = detailsOf(course);
  const [draft, setDraft] = useState<CourseDetails>(saved);
  const [errors, setErrors] = useState<DetailErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const facets = useLoader(() => courseApi.facets(course.workspace_id), `facets:${course.workspace_id}`);
  const subjectsId = useId();
  const changes = changedDetails(saved, draft);
  const dirty = Object.keys(changes).length > 0;

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const set = <K extends keyof CourseDetails>(key: K, value: CourseDetails[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const found: DetailErrors = {
      title: validateTitle(draft.title),
      subject: validateSubject(draft.subject),
      description: validateDescription(draft.description),
    };
    setErrors(found);
    if (found.title || found.subject || found.description || !dirty) return;
    setBusy(true);
    setServerError(null);
    try {
      onSaved(await courseApi.update(course.id, changes));
      toast.success('Course details saved');
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Could not save the course');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="panel settings-form" onSubmit={submit} noValidate aria-labelledby="details-title">
      <div className="panel-head">
        <h2 id="details-title">Details</h2>
        {dirty && <span className="badge warn">Unsaved changes</span>}
      </div>
      {serverError && <ErrorBanner message={serverError} />}
      <Field label="Title" error={errors.title} aside={`${draft.title.trim().length}/${TITLE_MAX}`}>
        <input value={draft.title} onChange={(e) => set('title', e.target.value)} />
      </Field>
      <Field label="Description" error={errors.description} aside={`${draft.description.trim().length}/${DESCRIPTION_MAX}`}>
        <textarea rows={3} value={draft.description} onChange={(e) => set('description', e.target.value)} />
      </Field>
      <div className="form-row">
        <Field label="Subject" error={errors.subject}>
          <input value={draft.subject} maxLength={SUBJECT_MAX + 10} list={subjectsId} onChange={(e) => set('subject', e.target.value)} />
        </Field>
        <Field label="Difficulty">
          <select value={draft.difficulty} onChange={(e) => set('difficulty', e.target.value as CourseDetails['difficulty'])}>
            {DIFFICULTIES.map((d) => (
              <option key={d} value={d}>
                {DIFFICULTY_LABELS[d]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <datalist id={subjectsId}>
        {(facets.data?.subjects ?? []).map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <Field label="Tags" hint="Enter or comma to add · up to 10">
        <TagInput value={draft.tags} onChange={(tags) => set('tags', tags)} suggestions={facets.data?.tags} />
      </Field>
      <fieldset className="fieldset">
        <legend>Colour</legend>
        <ColorSwatches value={draft.color} onChange={(color) => set('color', color)} />
      </fieldset>
      <div className="form-actions">
        <button type="button" className="ghost" disabled={!dirty || busy} onClick={() => setDraft(saved)}>
          <Undo2 /> Discard
        </button>
        <button type="submit" className="primary" disabled={!dirty || busy}>
          <Save /> {busy ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </form>
  );
}

function ConceptRow({
  concept,
  index,
  count,
  busy,
  onMove,
  onSave,
}: {
  concept: Concept;
  index: number;
  count: number;
  busy: boolean;
  onMove: (delta: number) => void;
  onSave: (changes: { name?: string; summary?: string }) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(concept.name);
  const [summary, setSummary] = useState(concept.summary);
  const [errors, setErrors] = useState<{ name?: string; summary?: string }>({});

  const cancel = () => {
    setEditing(false);
    setName(concept.name);
    setSummary(concept.summary);
    setErrors({});
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const found = { name: validateConceptName(name), summary: validateConceptSummary(summary) };
    setErrors(found);
    if (found.name || found.summary) return;
    const changes: { name?: string; summary?: string } = {};
    if (name.trim() !== concept.name) changes.name = name.trim();
    if (summary.trim() !== concept.summary) changes.summary = summary.trim();
    if (!Object.keys(changes).length || (await onSave(changes))) setEditing(false);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      cancel();
    }
  };

  return (
    <li className="concept-row">
      <span className="concept-order" aria-hidden="true">
        {index + 1}
      </span>
      {editing ? (
        <form className="concept-edit" onSubmit={save} onKeyDown={onKeyDown} noValidate>
          <Field label="Name" error={errors.name} aside={`${name.trim().length}/${CONCEPT_NAME_MAX}`}>
            <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </Field>
          <Field label="Summary" error={errors.summary} hint="Used as the correct answer in quizzes" aside={`${summary.trim().length}/${CONCEPT_SUMMARY_MAX}`}>
            <textarea rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} />
          </Field>
          <div className="actions">
            <button type="submit" className="primary small" disabled={busy}>
              <Check /> Save
            </button>
            <button type="button" className="ghost small" onClick={cancel}>
              <X /> Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="concept-row-main">
          <div className="row">
            <b>{concept.name}</b>
            <LevelBadge value={concept.mastery} />
          </div>
          <p className="muted">{concept.summary}</p>
        </div>
      )}
      {!editing && (
        <div className="concept-row-actions">
          <button type="button" className="icon-only" aria-label={`Move ${concept.name} up`} disabled={busy || index === 0} onClick={() => onMove(-1)}>
            <ArrowUp />
          </button>
          <button type="button" className="icon-only" aria-label={`Move ${concept.name} down`} disabled={busy || index === count - 1} onClick={() => onMove(1)}>
            <ArrowDown />
          </button>
          <button type="button" className="icon-only" aria-label={`Edit ${concept.name}`} onClick={() => setEditing(true)}>
            <Pencil />
          </button>
        </div>
      )}
    </li>
  );
}

function ConceptEditor() {
  const { course, reload, replace } = useCourse();
  const toast = useToast();
  // Optimistic order while a reorder request is in flight.
  const [pending, setPending] = useState<Concept[] | null>(null);
  const [busy, setBusy] = useState(false);
  const concepts = pending ?? course.concepts;

  const move = async (index: number, delta: number) => {
    const next = moveItem(concepts, index, delta);
    setPending(next);
    setBusy(true);
    try {
      const saved = await courseApi.reorderConcepts(course.id, next.map((c) => c.id));
      replace({ ...course, concepts: saved });
      // Unlocks and the recommendation depend on the new chain.
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not reorder the concepts');
    } finally {
      setPending(null);
      setBusy(false);
    }
  };

  const save = async (concept: Concept, changes: { name?: string; summary?: string }) => {
    setBusy(true);
    try {
      const saved = await courseApi.updateConcept(course.id, concept.id, changes);
      replace({ ...course, concepts: course.concepts.map((c) => (c.id === saved.id ? saved : c)) });
      toast.success(`Saved ${saved.name}`);
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the concept');
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel" aria-labelledby="concepts-title">
      <div className="panel-head">
        <div>
          <h2 id="concepts-title">Concepts</h2>
          <p className="hint">The order is the learning path: each concept unlocks once the one above it reaches 60%.</p>
        </div>
      </div>
      {concepts.length === 0 ? (
        <p className="muted">No concepts yet. Add material on the Sources tab.</p>
      ) : (
        <ol className="concept-rows">
          {concepts.map((concept, index) => (
            <ConceptRow
              key={`${concept.id}:${concept.name}:${concept.summary}`}
              concept={concept}
              index={index}
              count={concepts.length}
              busy={busy}
              onMove={(delta) => void move(index, delta)}
              onSave={(changes) => save(concept, changes)}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

