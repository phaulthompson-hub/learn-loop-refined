import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Copy } from 'lucide-react';
import { useToast } from '../../../app/toast';
import { Field } from '../../../components/Field';
import { Modal } from '../../../components/Modal';
import { ErrorBanner } from '../../../components/ui';
import { TITLE_MAX, validateTitle } from '../../../lib/validation';
import { courseApi } from '../api';
import type { Course } from '../types';

/** Copy a course's sources and concepts into a new draft, then open the copy's settings. */
export function DuplicateDialog({ course, onClose }: { course: Course; onClose: () => void }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [title, setTitle] = useState(`Copy of ${course.title}`.slice(0, TITLE_MAX));
  const [error, setError] = useState<string | undefined>();
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const problem = validateTitle(title);
    setError(problem);
    if (problem) return;
    setBusy(true);
    setServerError(null);
    try {
      const copy = await courseApi.duplicate(course.id, title.trim());
      toast.success(`Created the draft “${copy.title}”`);
      onClose();
      navigate(`/courses/${copy.id}/settings`);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Could not duplicate the course');
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Duplicate course"
      description="Sources and concepts are copied into a new draft. Nobody's progress comes along."
      onClose={onClose}
      size="sm"
      footer={
        <>
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="duplicate-form" className="primary" disabled={busy}>
            <Copy /> {busy ? 'Copying…' : 'Duplicate'}
          </button>
        </>
      }
    >
      <form id="duplicate-form" className="stack" onSubmit={submit} noValidate>
        {serverError && <ErrorBanner message={serverError} />}
        <Field label="Title of the copy" error={error} aside={`${title.trim().length}/${TITLE_MAX}`}>
          <input value={title} maxLength={TITLE_MAX + 20} onChange={(e) => setTitle(e.target.value)} data-autofocus />
        </Field>
        <p className="hint">
          {course.concept_count} concepts and {course.source_count} source{course.source_count === 1 ? '' : 's'} will be copied.
        </p>
      </form>
    </Modal>
  );
}
