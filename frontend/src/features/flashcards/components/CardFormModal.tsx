import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { RotateCw } from 'lucide-react';
import { useToast } from '../../../app/toast';
import { Field } from '../../../components/Field';
import { Modal } from '../../../components/Modal';
import { flashcardsApi } from '../api';
import { hasErrors, validateCard } from '../decks';
import { BACK_MAX, FRONT_MAX, HINT_MAX } from '../importParser';
import type { Card, CardInput, ConceptBrief } from '../types';
import { FlipCard } from './FlipCard';

type CardFormModalProps = {
  deckId: number;
  concepts: ConceptBrief[];
  /** Cards already in the deck, for the duplicate check. */
  cards: Card[];
  /** Card to edit; omit to add a new one. */
  card?: Card;
  onSaved: (card: Card) => void;
  onClose: () => void;
};

const EMPTY: CardInput = { front: '', back: '', hint: '', concept_id: null };

/** Add or edit a card with a live preview of both sides. Ctrl+Enter saves; "Save & add another" keeps the dialog open. */
export function CardFormModal({ deckId, concepts, cards, card, onSaved, onClose }: CardFormModalProps) {
  const toast = useToast();
  const [input, setInput] = useState<CardInput>(card ? { front: card.front, back: card.back, hint: card.hint, concept_id: card.concept_id } : EMPTY);
  const [previewBack, setPreviewBack] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [added, setAdded] = useState<Card[]>([]);

  const siblings = [...cards, ...added];
  const errors = submitted ? validateCard(input, siblings, card?.id ?? null) : {};
  const set = <K extends keyof CardInput>(key: K, value: CardInput[K]) => setInput((current) => ({ ...current, [key]: value }));

  const save = async (addAnother: boolean) => {
    setSubmitted(true);
    if (hasErrors(validateCard(input, siblings, card?.id ?? null))) return;
    setSaving(true);
    setServerError(null);
    const payload: CardInput = { front: input.front.trim(), back: input.back.trim(), hint: input.hint.trim(), concept_id: input.concept_id };
    try {
      const saved = card ? await flashcardsApi.updateCard(card.id, payload) : await flashcardsApi.createCard(deckId, payload);
      onSaved(saved);
      if (addAnother) {
        toast.success('Card added. Keep going!');
        setAdded((list) => [...list, saved]);
        setInput({ ...EMPTY, concept_id: input.concept_id });
        setSubmitted(false);
        setPreviewBack(false);
      } else {
        toast.success(card ? 'Card updated' : 'Card added');
        onClose();
      }
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Could not save the card');
    } finally {
      setSaving(false);
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void save(false);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void save(false);
    }
  };

  return (
    <Modal
      title={card ? 'Edit card' : 'Add card'}
      description={added.length ? `${added.length} added in this batch` : 'Keep each card to one idea: a short prompt and a precise answer.'}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="secondary" onClick={onClose}>
            {added.length ? 'Done' : 'Cancel'}
          </button>
          {!card && (
            <button type="button" className="secondary" disabled={saving} onClick={() => void save(true)}>
              Save &amp; add another
            </button>
          )}
          <button type="submit" form="fc-card-form" className="primary" disabled={saving}>
            {saving ? 'Saving…' : card ? 'Save card' : 'Add card'}
          </button>
        </>
      }
    >
      <div className="fc-card-editor">
        <form id="fc-card-form" className="stack" onSubmit={onSubmit} onKeyDown={onKeyDown} noValidate>
          {serverError && (
            <p className="field-error" role="alert">
              {serverError}
            </p>
          )}
          <Field label="Front" error={errors.front} aside={`${input.front.trim().length}/${FRONT_MAX}`}>
            <textarea value={input.front} rows={3} onChange={(e) => set('front', e.target.value)} onFocus={() => setPreviewBack(false)} placeholder="What does a loss function measure?" data-autofocus />
          </Field>
          <Field label="Back" error={errors.back} aside={`${input.back.trim().length}/${BACK_MAX}`}>
            <textarea value={input.back} rows={4} onChange={(e) => set('back', e.target.value)} onFocus={() => setPreviewBack(true)} placeholder="The gap between predictions and the correct values." />
          </Field>
          <div className="form-row">
            <Field label="Hint" error={errors.hint} hint="Optional nudge shown before the answer.">
              <input value={input.hint} maxLength={HINT_MAX + 20} onChange={(e) => set('hint', e.target.value)} />
            </Field>
            <Field label="Concept" hint="Links the card to a course concept.">
              <select value={input.concept_id ?? ''} onChange={(e) => set('concept_id', e.target.value ? Number(e.target.value) : null)}>
                <option value="">Not linked</option>
                {concepts.map((concept) => (
                  <option key={concept.id} value={concept.id}>
                    {concept.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <p className="hint">
            <kbd>Ctrl</kbd> + <kbd>Enter</kbd> saves the card.
          </p>
        </form>
        <aside className="fc-card-preview" aria-label="Preview">
          <div className="row">
            <p className="eyebrow">Preview · {previewBack ? 'back' : 'front'}</p>
            <span className="spacer" />
            <button type="button" className="ghost small" onClick={() => setPreviewBack((b) => !b)}>
              <RotateCw /> Flip
            </button>
          </div>
          <FlipCard
            size="sm"
            front={input.front.trim()}
            back={input.back.trim()}
            hint={input.hint.trim()}
            flipped={previewBack}
            onFlip={() => setPreviewBack((b) => !b)}
            meta={input.concept_id ? <span className="tag">{concepts.find((c) => c.id === input.concept_id)?.name}</span> : undefined}
          />
        </aside>
      </div>
    </Modal>
  );
}
