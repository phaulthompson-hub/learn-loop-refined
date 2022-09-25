import { useState, type FormEvent } from 'react';
import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { useAuth, useUser } from '../../../app/auth';
import { useToast } from '../../../app/toast';
import type { User } from '../../../app/types';
import { Switch } from '../../../components/Field';
import { ErrorBanner } from '../../../components/ui';
import { cx } from '../../../lib/cx';
import { formatDuration } from '../../../lib/format';
import { accountApi } from '../api';
import { SaveBar, SettingsSection } from '../components/bits';
import type { PreferencesInput } from '../types';
import { changedFields, clamp, GOAL_MAX, GOAL_MIN, QUIZ_MAX, QUIZ_MIN } from '../validation';
import { useUnsavedChangesWarning } from './SettingsLayout';

type Theme = User['theme'];
type StudyPrefs = Omit<PreferencesInput, 'theme'>;

const THEMES: { value: Theme; label: string; icon: typeof Sun; hint: string }[] = [
  { value: 'light', label: 'Light', icon: Sun, hint: 'Warm paper background' },
  { value: 'dark', label: 'Dark', icon: Moon, hint: 'Easy on the eyes at night' },
  { value: 'system', label: 'System', icon: Monitor, hint: 'Follow your device setting' },
];
const GOAL_PRESETS = [15, 30, 45, 60, 90];

const studyPrefsOf = (user: User): StudyPrefs => ({
  daily_goal_minutes: user.daily_goal_minutes,
  quiz_length: user.quiz_length,
  week_starts_on: user.week_starts_on,
  email_digest: user.email_digest,
  reduced_motion: user.reduced_motion,
});

/** Theme applies (and saves) the moment it is picked; study preferences are a form with an explicit save. */
export function PreferencesSettings() {
  const user = useUser();
  const { updateUser } = useAuth();
  const toast = useToast();
  const saved = studyPrefsOf(user);
  const [draft, setDraft] = useState<StudyPrefs>(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changes = changedFields(saved, draft);
  const dirty = Object.keys(changes).length > 0;
  useUnsavedChangesWarning(dirty);

  const set = <K extends keyof StudyPrefs>(key: K, value: StudyPrefs[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const pickTheme = async (theme: Theme) => {
    if (theme === user.theme) return;
    const previous = user;
    // Optimistic: the shell re-themes from the cached user immediately; roll back if the save fails.
    updateUser({ ...user, theme });
    try {
      updateUser(await accountApi.updatePreferences({ theme }));
    } catch (err) {
      updateUser(previous);
      toast.error(err instanceof Error ? err.message : 'Could not change the theme');
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!dirty) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await accountApi.updatePreferences(changes);
      updateUser(updated);
      setDraft(studyPrefsOf(updated));
      toast.success('Preferences saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your preferences');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <SettingsSection title="Appearance" description="Applied straight away on this and every other device you use.">
        <div className="theme-cards" role="radiogroup" aria-label="Theme">
          {THEMES.map(({ value, label, icon: Icon, hint }) => (
            <label key={value} className={cx('theme-card', `theme-${value}`, user.theme === value && 'selected')}>
              <input type="radio" name="theme" className="sr-only" checked={user.theme === value} onChange={() => void pickTheme(value)} />
              <span className="theme-sample" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <span className="theme-label">
                <Icon aria-hidden="true" />
                <b>{label}</b>
                {user.theme === value && <Check className="theme-check" aria-hidden="true" />}
              </span>
              <small>{hint}</small>
            </label>
          ))}
        </div>
      </SettingsSection>

      <SettingsSection title="Study habits" description="Shape your daily goal, quizzes and calendar.">
        <form className="stack" onSubmit={submit} noValidate>
          {error && <ErrorBanner message={error} />}
          <div className="field">
            <label htmlFor="daily-goal" className="field-label">
              <span>Daily study goal</span>
              <output htmlFor="daily-goal" className="goal-value">
                {formatDuration(draft.daily_goal_minutes)}
              </output>
            </label>
            <input
              id="daily-goal"
              type="range"
              className="goal-slider"
              min={GOAL_MIN}
              max={GOAL_MAX}
              step={5}
              value={draft.daily_goal_minutes}
              aria-valuetext={formatDuration(draft.daily_goal_minutes)}
              onChange={(e) => set('daily_goal_minutes', clamp(Number(e.target.value), GOAL_MIN, GOAL_MAX))}
            />
            <div className="goal-presets" role="group" aria-label="Quick picks">
              {GOAL_PRESETS.map((minutes) => (
                <button key={minutes} type="button" className={cx('chip', draft.daily_goal_minutes === minutes && 'active')} onClick={() => set('daily_goal_minutes', minutes)}>
                  {formatDuration(minutes)}
                </button>
              ))}
            </div>
          </div>

          <div className="form-row">
            <div className="field">
              <span className="field-label">Questions per quiz</span>
              <div className="stepper" role="group" aria-label="Questions per quiz">
                <button type="button" className="secondary small" aria-label="Fewer questions" disabled={draft.quiz_length <= QUIZ_MIN} onClick={() => set('quiz_length', draft.quiz_length - 1)}>
                  −
                </button>
                <b aria-live="polite">{draft.quiz_length}</b>
                <button type="button" className="secondary small" aria-label="More questions" disabled={draft.quiz_length >= QUIZ_MAX} onClick={() => set('quiz_length', draft.quiz_length + 1)}>
                  +
                </button>
              </div>
              <small className="hint">
                Between {QUIZ_MIN} and {QUIZ_MAX}.
              </small>
            </div>
            <fieldset className="field week-start">
              <legend className="field-label">Week starts on</legend>
              <div className="segmented">
                {[
                  { value: 0, label: 'Monday' },
                  { value: 6, label: 'Sunday' },
                ].map((option) => (
                  <label key={option.value} className={cx('segment', draft.week_starts_on === option.value && 'active')}>
                    <input type="radio" name="week-start" className="sr-only" checked={draft.week_starts_on === option.value} onChange={() => set('week_starts_on', option.value)} />
                    {option.label}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>

          <div>
            <Switch checked={draft.email_digest} onChange={(v) => set('email_digest', v)} label="Weekly email digest" description="A Monday summary of reviews due, goals and workspace activity." />
            <Switch checked={draft.reduced_motion} onChange={(v) => set('reduced_motion', v)} label="Reduce motion" description="Turn off animations and transitions across LearnLoop." />
          </div>
          <SaveBar dirty={dirty} valid busy={busy} onDiscard={() => setDraft(saved)} label="Save preferences" />
        </form>
      </SettingsSection>
    </div>
  );
}
