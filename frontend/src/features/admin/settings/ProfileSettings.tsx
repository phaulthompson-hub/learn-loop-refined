import { useMemo, useState, type FormEvent } from 'react';
import { Clock } from 'lucide-react';
import { useAuth, useUser } from '../../../app/auth';
import { useNow } from '../../../app/clock';
import { useToast } from '../../../app/toast';
import type { User } from '../../../app/types';
import { Avatar } from '../../../components/Avatar';
import { Field } from '../../../components/Field';
import { ErrorBanner } from '../../../components/ui';
import { formatDate } from '../../../lib/format';
import { accountApi } from '../api';
import { ColorSwatches, SaveBar, SettingsSection } from '../components/bits';
import { TimezoneSelect } from '../components/TimezoneSelect';
import { timezoneList } from '../timezones';
import type { ProfileInput } from '../types';
import { AVATAR_COLORS, BIO_MAX, changedFields, hasErrors, HEADLINE_MAX, validateProfile } from '../validation';
import { useUnsavedChangesWarning } from './SettingsLayout';

const profileOf = (user: User): ProfileInput => ({
  name: user.name,
  headline: user.headline,
  bio: user.bio,
  timezone: user.timezone,
  avatar_color: user.avatar_color,
});

/** Local wall-clock time in a zone, e.g. "14:05", for the preview card. */
function localTime(zone: string, now: Date): string {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
  } catch {
    return '';
  }
}

export function ProfileSettings() {
  const user = useUser();
  const { updateUser } = useAuth();
  const toast = useToast();
  const now = useNow();
  const saved = profileOf(user);
  const [draft, setDraft] = useState<ProfileInput>(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const zones = useMemo(() => timezoneList(user.timezone), [user.timezone]);
  const colors = AVATAR_COLORS.includes(user.avatar_color) ? AVATAR_COLORS : [...AVATAR_COLORS, user.avatar_color];

  const changes = changedFields(saved, draft);
  const dirty = Object.keys(changes).length > 0;
  const errors = validateProfile(draft, zones);
  useUnsavedChangesWarning(dirty);

  const set = <K extends keyof ProfileInput>(key: K, value: ProfileInput[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!dirty || hasErrors(errors)) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await accountApi.updateProfile(changes);
      updateUser(updated);
      setDraft(profileOf(updated));
      toast.success('Profile saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your profile');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings-grid">
      <SettingsSection title="Profile" description="How other members see you in member lists, comments and the activity feed.">
        <form className="stack" onSubmit={submit} noValidate>
          {error && <ErrorBanner message={error} />}
          <div className="field">
            <span className="field-label">Avatar colour</span>
            <ColorSwatches label="Avatar colour" colors={colors} value={draft.avatar_color} onChange={(c) => set('avatar_color', c)} />
          </div>
          <div className="form-row">
            <Field label="Full name" error={errors.name}>
              <input autoComplete="name" value={draft.name} onChange={(e) => set('name', e.target.value)} />
            </Field>
            <Field label="Headline" error={errors.headline} aside={`${draft.headline.trim().length}/${HEADLINE_MAX}`}>
              <input value={draft.headline} placeholder="e.g. Data analyst learning ML" onChange={(e) => set('headline', e.target.value)} />
            </Field>
          </div>
          <Field
            label="Bio"
            error={errors.bio}
            hint="A few lines about what you are learning or teaching."
            aside={<span className={draft.bio.trim().length > BIO_MAX ? 'bad' : undefined}>{`${draft.bio.trim().length}/${BIO_MAX}`}</span>}
          >
            <textarea rows={4} value={draft.bio} onChange={(e) => set('bio', e.target.value)} />
          </Field>
          <Field label="Time zone" error={errors.timezone} hint="Used for reminders and your study calendar.">
            <TimezoneSelect value={draft.timezone} zones={zones} onChange={(zone) => set('timezone', zone)} />
          </Field>
          <SaveBar dirty={dirty} valid={!hasErrors(errors)} busy={busy} onDiscard={() => setDraft(saved)} />
        </form>
      </SettingsSection>

      <aside className="profile-preview" aria-label="Profile preview">
        <p className="eyebrow">Preview</p>
        <div className="preview-card" style={{ ['--preview-color' as string]: draft.avatar_color }}>
          <div className="preview-banner" />
          <Avatar name={draft.name.trim() || user.name} color={draft.avatar_color} size="lg" />
          <h3>{draft.name.trim() || 'Your name'}</h3>
          <p className="preview-headline">{draft.headline.trim() || <span className="muted">No headline yet</span>}</p>
          {draft.bio.trim() && <p className="preview-bio">{draft.bio.trim()}</p>}
          <dl>
            <div>
              <dt>Local time</dt>
              <dd>
                <Clock aria-hidden="true" /> {localTime(draft.timezone, now)} · {draft.timezone}
              </dd>
            </div>
            <div>
              <dt>Member since</dt>
              <dd>{formatDate(user.created_at)}</dd>
            </div>
          </dl>
        </div>
      </aside>
    </div>
  );
}
