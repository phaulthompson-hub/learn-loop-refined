import { useId, useState, type CSSProperties, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, ClipboardType, FileUp, Lock, Wand2 } from 'lucide-react';
import { useWorkspace } from '../../app/auth';
import { useToast } from '../../app/toast';
import { Field } from '../../components/Field';
import { Tabs } from '../../components/Tabs';
import { EmptyState, ErrorBanner, PageHeader } from '../../components/ui';
import { useLoader } from '../../hooks/useLoader';
import { cx } from '../../lib/cx';
import { formatNumber } from '../../lib/format';
import { DESCRIPTION_MAX, TEXT_MAX, TEXT_MIN, TITLE_MAX, formatBytes } from '../../lib/validation';
import { courseApi } from './api';
import { DIFFICULTIES, DIFFICULTY_LABELS } from './catalog';
import { ColorSwatches } from './components/ColorSwatches';
import { DifficultyBadge } from './components/CourseBadges';
import { FileDrop } from './components/FileDrop';
import { TagInput } from './components/TagInput';
import type { CourseDetails, Difficulty } from './types';
import { STEPS, firstInvalidStep, initialWizard, materialStats, validateStep, type MaterialMode, type WizardErrors, type WizardState, type WizardStep } from './wizard';

const DIFFICULTY_HINTS: Record<Difficulty, string> = {
  intro: 'No prior knowledge needed',
  intermediate: 'Builds on the basics',
  advanced: 'For experienced learners',
};

function Stepper({ current, completed, onSelect }: { current: WizardStep; completed: Set<WizardStep>; onSelect: (step: WizardStep) => void }) {
  const currentIndex = STEPS.findIndex((s) => s.key === current);
  return (
    <ol className="course-stepper" aria-label="Steps">
      {STEPS.map((step, index) => {
        const done = completed.has(step.key) && index < currentIndex;
        const reachable = index <= currentIndex || STEPS.slice(0, index).every((s) => completed.has(s.key));
        return (
          <li key={step.key} className={cx(step.key === current && 'current', done && 'done')}>
            <button type="button" disabled={!reachable} aria-current={step.key === current ? 'step' : undefined} onClick={() => onSelect(step.key)}>
              <span className="step-index">{done ? <Check /> : index + 1}</span>
              <span className="step-text">
                <b>{step.label}</b>
                <small>{step.hint}</small>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function DetailsStep({ details, errors, onChange }: { details: CourseDetails; errors: WizardErrors; onChange: (details: CourseDetails) => void }) {
  const workspace = useWorkspace();
  const facets = useLoader(() => courseApi.facets(workspace.id), `facets:${workspace.id}`);
  const subjectsId = useId();
  const set = <K extends keyof CourseDetails>(key: K, value: CourseDetails[K]) => onChange({ ...details, [key]: value });

  return (
    <div className="stack">
      <Field label="Course title" error={errors.title} aside={`${details.title.trim().length}/${TITLE_MAX}`}>
        <input value={details.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Cell Biology Basics" autoFocus />
      </Field>
      <Field label="Description" error={errors.description} hint="Optional: one or two sentences shown on the course card." aside={`${details.description.trim().length}/${DESCRIPTION_MAX}`}>
        <textarea rows={3} value={details.description} onChange={(e) => set('description', e.target.value)} />
      </Field>
      <Field label="Subject" error={errors.subject} hint="Pick an existing subject to group courses together.">
        <input value={details.subject} list={subjectsId} onChange={(e) => set('subject', e.target.value)} placeholder="e.g. Biology" />
      </Field>
      <datalist id={subjectsId}>
        {(facets.data?.subjects ?? []).map((subject) => (
          <option key={subject} value={subject} />
        ))}
      </datalist>
      <fieldset className="fieldset">
        <legend>Difficulty</legend>
        <div className="choice-cards" role="radiogroup" aria-label="Difficulty">
          {DIFFICULTIES.map((difficulty) => (
            <label key={difficulty} className={cx('choice-card', details.difficulty === difficulty && 'selected')}>
              <input type="radio" name="difficulty" value={difficulty} checked={details.difficulty === difficulty} onChange={() => set('difficulty', difficulty)} />
              <b>{DIFFICULTY_LABELS[difficulty]}</b>
              <small>{DIFFICULTY_HINTS[difficulty]}</small>
            </label>
          ))}
        </div>
      </fieldset>
      <Field label="Tags" hint="Press Enter or comma to add a tag · up to 10">
        <TagInput value={details.tags} onChange={(tags) => set('tags', tags)} suggestions={facets.data?.tags} />
      </Field>
      <fieldset className="fieldset">
        <legend>Colour</legend>
        <ColorSwatches value={details.color} onChange={(color) => set('color', color)} />
      </fieldset>
    </div>
  );
}

function MaterialStep({ state, errors, onChange }: { state: WizardState; errors: WizardErrors; onChange: (patch: Partial<WizardState>) => void }) {
  const stats = materialStats(state.text);
  const tooShort = stats.characters < TEXT_MIN;
  return (
    <div className="stack">
      <Tabs<MaterialMode>
        label="Material source"
        value={state.mode}
        onChange={(mode) => onChange({ mode })}
        items={[
          { key: 'paste', label: 'Paste text', icon: <ClipboardType /> },
          { key: 'upload', label: 'Upload a file', icon: <FileUp /> },
        ]}
      />
      {state.mode === 'paste' ? (
        <Field
          label="Learning material"
          error={errors.text}
          aside={
            <span className={tooShort || stats.characters > TEXT_MAX ? 'bad' : 'ok'}>
              {formatNumber(stats.characters)} characters{tooShort ? ` · ${TEXT_MIN - stats.characters} more needed` : ` · ${formatNumber(stats.words)} words`}
            </span>
          }
        >
          <textarea rows={14} value={state.text} onChange={(e) => onChange({ text: e.target.value })} placeholder="Paste lecture notes, an article or a chapter…" />
        </Field>
      ) : (
        <div className="field">
          <span className="course-field-label">File</span>
          <FileDrop file={state.file} onChange={(file) => onChange({ file })} error={errors.file} />
          {errors.file && (
            <small className="field-error" role="alert">
              {errors.file}
            </small>
          )}
        </div>
      )}
      <p className="hint">
        LearnLoop reads the material, picks out up to six key concepts in the order they are introduced, and chains them into prerequisites.
      </p>
    </div>
  );
}

function ReviewStep({ state, onStatus }: { state: WizardState; onStatus: (status: WizardState['status']) => void }) {
  const { details } = state;
  const stats = materialStats(state.text);
  return (
    <div className="stack">
      <div className="review-card" style={{ '--course-color': details.color } as CSSProperties}>
        <div className="course-card-band" aria-hidden="true" />
        <p className="eyebrow">{details.subject}</p>
        <h3>{details.title.trim()}</h3>
        {details.description.trim() && <p className="muted">{details.description.trim()}</p>}
        <div className="course-card-badges">
          <DifficultyBadge difficulty={details.difficulty} />
          {details.tags.map((tag) => (
            <span key={tag} className="tag">
              #{tag}
            </span>
          ))}
        </div>
      </div>
      <dl className="review-list">
        <div>
          <dt>Material</dt>
          <dd>
            {state.mode === 'paste'
              ? `${formatNumber(stats.characters)} characters of pasted text · ${formatNumber(stats.words)} words · ${stats.sentences} sentences`
              : state.file
                ? `${state.file.name} (${formatBytes(state.file.size)})`
                : 'No file chosen'}
          </dd>
        </div>
        <div>
          <dt>What happens next</dt>
          <dd>
            <Wand2 className="inline-icon" /> Up to six concepts are extracted and ordered into a learning path. Each one unlocks when the previous reaches
            60%, and quizzes adapt to every learner's weakest concept.
          </dd>
        </div>
      </dl>
      <fieldset className="fieldset">
        <legend>Visibility</legend>
        <div className="choice-cards">
          <label className={cx('choice-card', state.status === 'active' && 'selected')}>
            <input type="radio" name="status" checked={state.status === 'active'} onChange={() => onStatus('active')} />
            <b>Publish now</b>
            <small>Every member of the workspace can find and follow it.</small>
          </label>
          <label className={cx('choice-card', state.status === 'draft' && 'selected')}>
            <input type="radio" name="status" checked={state.status === 'draft'} onChange={() => onStatus('draft')} />
            <b>
              <Lock className="inline-icon" /> Save as draft
            </b>
            <small>Only instructors see it until you publish it from Settings.</small>
          </label>
        </div>
      </fieldset>
    </div>
  );
}

export function NewCoursePage() {
  const workspace = useWorkspace();
  const navigate = useNavigate();
  const toast = useToast();
  const [state, setState] = useState<WizardState>(() => initialWizard());
  const [step, setStep] = useState<WizardStep>('details');
  const [completed, setCompleted] = useState<Set<WizardStep>>(new Set());
  const [errors, setErrors] = useState<WizardErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!workspace.can('instructor')) {
    return (
      <EmptyState icon={<Lock />} title="Only instructors can create courses">
        <p>Ask an instructor or admin of {workspace.name} to add the material, or to give you the instructor role.</p>
        <Link className="secondary" to="/courses">
          <ArrowLeft /> Back to courses
        </Link>
      </EmptyState>
    );
  }

  const index = STEPS.findIndex((s) => s.key === step);
  const update = (patch: Partial<WizardState>) => {
    setState((current) => ({ ...current, ...patch }));
    setErrors({});
  };

  const goTo = (target: WizardStep) => {
    setErrors({});
    setServerError(null);
    setStep(target);
  };

  const next = () => {
    const found = validateStep(step, state);
    setErrors(found);
    if (Object.keys(found).length) return;
    setCompleted((done) => new Set(done).add(step));
    goTo(STEPS[index + 1].key);
  };

  const create = async () => {
    const invalid = firstInvalidStep(state);
    if (invalid) {
      goTo(invalid);
      setErrors(validateStep(invalid, state));
      return;
    }
    setBusy(true);
    setServerError(null);
    const input = { ...state.details, title: state.details.title.trim(), subject: state.details.subject.trim(), status: state.status };
    try {
      const course = state.mode === 'paste' ? await courseApi.create(workspace.id, { ...input, text: state.text }) : await courseApi.upload(workspace.id, input, state.file!);
      toast.success(`Created ${course.title} with ${course.concept_count} concepts`);
      navigate(`/courses/${course.id}`);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Could not create the course');
      setBusy(false);
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (step === 'review') void create();
    else next();
  };

  return (
    <>
      <PageHeader
        eyebrow="New course"
        title="Turn material into a learning path"
        subtitle={`In ${workspace.name}. Concepts, prerequisites and adaptive quizzes are generated from your text.`}
        aside={
          <Link className="ghost" to="/courses">
            Cancel
          </Link>
        }
      />
      <div className="wizard">
        <Stepper current={step} completed={completed} onSelect={goTo} />
        <form className="panel wizard-panel" onSubmit={onSubmit} noValidate aria-labelledby="wizard-step-title">
          <h2 id="wizard-step-title">
            Step {index + 1} of {STEPS.length}: {STEPS[index].label}
          </h2>
          {serverError && <ErrorBanner message={serverError} />}
          {step === 'details' && <DetailsStep details={state.details} errors={errors} onChange={(details) => update({ details })} />}
          {step === 'material' && <MaterialStep state={state} errors={errors} onChange={update} />}
          {step === 'review' && <ReviewStep state={state} onStatus={(status) => update({ status })} />}
          <div className="wizard-actions">
            {index > 0 && (
              <button type="button" className="secondary" onClick={() => goTo(STEPS[index - 1].key)} disabled={busy}>
                <ArrowLeft /> Back
              </button>
            )}
            <span className="spacer" />
            {step === 'review' ? (
              <button type="submit" className="primary" disabled={busy}>
                <Wand2 /> {busy ? 'Building your course…' : state.status === 'draft' ? 'Create draft' : 'Create course'}
              </button>
            ) : (
              <button type="submit" className="primary">
                Next <ArrowRight />
              </button>
            )}
          </div>
        </form>
      </div>
    </>
  );
}
