import { useState, type FormEvent } from 'react';
import { useToast } from '../../../app/toast';
import { Field } from '../../../components/Field';
import { Modal } from '../../../components/Modal';
import { flashcardsApi } from '../api';
import { DECK_DESCRIPTION_MAX, DECK_NAME_MAX, hasErrors, validateDeck, type DeckFormErrors } from '../decks';
import type { DeckCourse, DeckDetail, DeckSummary } from '../types';

type DeckFormModalProps = {
  workspaceId: number;
  /** Courses the user may add decks to (create mode). */
  courses: DeckCourse[];
  /** Other decks, used to catch duplicate names before the server does. */
  decks: DeckSummary[];
  /** Existing deck to edit; omit to create one. */
  deck?: DeckSummary;
  initialCourseId?: number | null;
  onSaved: (deck: DeckDetail) => void;
  onClose: () => void;
};

export function DeckFormModal({ workspaceId, courses, decks, deck, initialCourseId = null, onSaved, onClose }: DeckFormModalProps) {
  const toast = useToast();
  const [courseId, setCourseId] = useState<number | null>(deck?.course_id ?? initialCourseId ?? (courses.length === 1 ? courses[0].id : null));
  const [name, setName] = useState(deck?.name ?? '');
  const [description, setDescription] = useState(deck?.description ?? '');
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const siblings = decks.filter((d) => d.course_id === courseId && d.id !== deck?.id).map((d) => d.name);
  const errors: DeckFormErrors = submitted ? validateDeck({ courseId, name, description }, siblings) : {};

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (hasErrors(validateDeck({ courseId, name, description }, siblings)) || courseId === null) return;
    setSaving(true);
    setServerError(null);
    try {
      const saved = deck
        ? await flashcardsApi.updateDeck(deck.id, { name: name.trim(), description: description.trim() })
        : await flashcardsApi.createDeck(workspaceId, { course_id: courseId, name: name.trim(), description: description.trim() });
      toast.success(deck ? 'Deck updated' : `Created ${saved.name}`);
      onSaved(saved);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Could not save the deck');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={deck ? 'Edit deck' : 'New deck'}
      description={deck ? deck.course_title : 'Decks group flashcards for one course. Every member studies them on their own schedule.'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="fc-deck-form" className="primary" disabled={saving}>
            {saving ? 'Saving…' : deck ? 'Save changes' : 'Create deck'}
          </button>
        </>
      }
    >
      <form id="fc-deck-form" className="stack" onSubmit={submit} noValidate>
        {serverError && <p className="field-error" role="alert">{serverError}</p>}
        {!deck && (
          <Field label="Course" error={errors.course}>
            <select value={courseId ?? ''} onChange={(e) => setCourseId(e.target.value ? Number(e.target.value) : null)} data-autofocus>
              <option value="">Choose a course…</option>
              {courses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.title}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Name" error={errors.name} aside={`${name.trim().length}/${DECK_NAME_MAX}`}>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={DECK_NAME_MAX + 20} placeholder="e.g. Exam 1 vocabulary" data-autofocus={deck ? true : undefined} />
        </Field>
        <Field label="Description" error={errors.description} hint="Optional. What the deck covers and when to use it." aside={`${description.trim().length}/${DECK_DESCRIPTION_MAX}`}>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
        </Field>
      </form>
    </Modal>
  );
}
