import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { FilePlus2, FileText, Trash2 } from 'lucide-react';
import { useNow } from '../../app/clock';
import { useToast } from '../../app/toast';
import { Field } from '../../components/Field';
import { ConfirmDialog, Modal } from '../../components/Modal';
import { ErrorBanner } from '../../components/ui';
import { formatNumber, plural, relativeTime } from '../../lib/format';
import { SOURCE_NAME_MAX, TEXT_MAX, TEXT_MIN, validateSourceName, validateText } from '../../lib/validation';
import { courseApi } from './api';
import { useCourse } from './courseContext';
import type { SourceRef } from './types';

function AddMaterialDialog({ onClose, onAdded }: { onClose: () => void; onAdded: (source: SourceRef) => void }) {
  const { course } = useCourse();
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [errors, setErrors] = useState<{ name?: string; text?: string }>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const length = text.trim().length;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const found = { name: validateSourceName(name), text: validateText(text) };
    setErrors(found);
    if (found.name || found.text) return;
    setBusy(true);
    setServerError(null);
    try {
      onAdded(await courseApi.addSource(course.id, name.trim(), text));
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Could not add the material');
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Add material"
      description="New concepts found in this text are appended to the end of the prerequisite chain."
      onClose={onClose}
      size="lg"
      footer={
        <>
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="add-material" className="primary" disabled={busy}>
            <FilePlus2 /> {busy ? 'Extracting concepts…' : 'Add material'}
          </button>
        </>
      }
    >
      <form id="add-material" className="stack" onSubmit={submit} noValidate>
        {serverError && <ErrorBanner message={serverError} />}
        <Field label="Name" error={errors.name} hint="Shown in citations, e.g. week-3-notes.md">
          <input value={name} maxLength={SOURCE_NAME_MAX} onChange={(e) => setName(e.target.value)} data-autofocus />
        </Field>
        <Field
          label="Text"
          error={errors.text}
          aside={
            <span className={length < TEXT_MIN || length > TEXT_MAX ? 'bad' : undefined}>
              {formatNumber(length)} / {formatNumber(TEXT_MIN)} min
            </span>
          }
        >
          <textarea rows={12} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste lecture notes, an article or a chapter…" />
        </Field>
      </form>
    </Modal>
  );
}

export function SourcesPage() {
  const { course, canEdit, reload } = useCourse();
  const now = useNow();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<SourceRef | null>(null);
  const [busy, setBusy] = useState(false);
  const totalWords = course.sources.reduce((sum, s) => sum + s.words, 0);

  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    try {
      await courseApi.removeSource(course.id, removing.id);
      toast.success(`Removed ${removing.name}`);
      setRemoving(null);
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not remove the source');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel" aria-labelledby="sources-title">
      <div className="panel-head">
        <div>
          <p className="eyebrow">Learning material</p>
          <h2 id="sources-title">
            {plural(course.sources.length, 'source')} · {plural(totalWords, 'word')}
          </h2>
        </div>
        {canEdit && (
          <button type="button" className="primary small" onClick={() => setAdding(true)}>
            <FilePlus2 /> Add material
          </button>
        )}
      </div>
      <ul className="source-rows">
        {course.sources.map((source) => (
          <li key={source.id}>
            <FileText className="source-icon" aria-hidden="true" />
            <div className="source-row-main">
              <Link to={`/courses/${course.id}/sources/${source.id}`}>{source.name}</Link>
              <small className="muted">
                {plural(source.words, 'word')} · {formatNumber(source.characters)} characters · added {relativeTime(source.created_at, now)}
              </small>
            </div>
            <Link className="secondary small" to={`/courses/${course.id}/sources/${source.id}`}>
              Read
            </Link>
            {canEdit && (
              <button
                type="button"
                className="icon-only"
                aria-label={`Remove ${source.name}`}
                title={course.sources.length === 1 ? 'A course needs at least one source' : 'Remove source'}
                disabled={course.sources.length === 1}
                onClick={() => setRemoving(source)}
              >
                <Trash2 />
              </button>
            )}
          </li>
        ))}
      </ul>
      {adding && (
        <AddMaterialDialog
          onClose={() => setAdding(false)}
          onAdded={(source) => {
            setAdding(false);
            toast.success(`Added ${source.name}`);
            reload();
          }}
        />
      )}
      {removing && (
        <ConfirmDialog
          title="Remove this source?"
          message={
            <>
              <b>{removing.name}</b> will no longer be used by the tutor. Concepts that came from it stay, together with everyone's progress.
            </>
          }
          confirmLabel="Remove source"
          busy={busy}
          onConfirm={remove}
          onCancel={() => setRemoving(null)}
        />
      )}
    </section>
  );
}
