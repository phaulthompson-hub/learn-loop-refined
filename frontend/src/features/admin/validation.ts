// Pure rules and form checks for account settings, members and invitations.
// Role rules mirror backend/app/services/membership.py so the UI only offers actions the API allows.
import { ROLES } from '../../app/roles';
import type { Role } from '../../app/types';
import { daysBetween, parseDate } from '../../lib/dates';
import { validateEmail, validateNewPassword } from '../auth/validation';

export const NAME_MIN = 2;
export const NAME_MAX = 80;
export const HEADLINE_MAX = 120;
export const BIO_MAX = 600;
export const WORKSPACE_DESCRIPTION_MAX = 500;
export const INVITE_MESSAGE_MAX = 500;
export const MAX_INVITES = 50;
export const GOAL_MIN = 5;
export const GOAL_MAX = 480;
export const QUIZ_MIN = 3;
export const QUIZ_MAX = 10;

export const AVATAR_COLORS = ['#1d6d45', '#2563eb', '#9333ea', '#c2410c', '#0f766e', '#be123c', '#4d7c0f', '#a16207'];

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const rank = (role: Role) => ROLES.indexOf(role);

// ---------- Role rules ----------

type RoleChange = { actorRole: Role; targetRole: Role; newRole: Role; isSelf: boolean; ownerCount: number };

/** Why a role change would be refused, or null when it is allowed (same order as the API). */
export function roleChangeProblem({ actorRole, targetRole, newRole, isSelf, ownerCount }: RoleChange): string | null {
  if (rank(actorRole) < rank('admin')) return 'Only admins and owners can change roles.';
  if (newRole === targetRole) return 'This member already has that role.';
  if (isSelf) {
    if (actorRole !== 'owner') return 'You cannot change your own role.';
    if (ownerCount <= 1) return 'You are the only owner. Make someone else an owner first.';
    return null;
  }
  if (targetRole === 'owner' && actorRole !== 'owner') return "Only owners can change another owner's role.";
  if (newRole === 'owner' && actorRole !== 'owner') return 'Only owners can grant the owner role.';
  if (targetRole === 'owner' && ownerCount <= 1) return 'A workspace needs at least one owner.';
  return null;
}

/** Roles the actor can move this member to; an empty list means the role is locked for them. */
export function assignableRoles(actorRole: Role, targetRole: Role, isSelf: boolean, ownerCount: number): Role[] {
  return ROLES.filter((newRole) => newRole !== targetRole && !roleChangeProblem({ actorRole, targetRole, newRole, isSelf, ownerCount }));
}

export function removalProblem(actorRole: Role, targetRole: Role, isSelf: boolean): string | null {
  if (rank(actorRole) < rank('admin')) return 'Only admins and owners can remove members.';
  if (isSelf) return 'Use “Leave workspace” in settings to remove yourself.';
  if (targetRole === 'owner' && actorRole !== 'owner') return 'Only owners can remove another owner.';
  return null;
}

export function leaveProblem(role: Role, ownerCount: number): string | null {
  return role === 'owner' && ownerCount <= 1 ? 'You are the only owner. Transfer ownership or delete the workspace instead.' : null;
}

/** Roles an inviter may hand out: admins up to admin, owners any role. */
export function invitableRoles(actorRole: Role): Role[] {
  if (rank(actorRole) < rank('admin')) return [];
  return actorRole === 'owner' ? [...ROLES] : ROLES.filter((role) => role !== 'owner');
}

/** Owners that still count for the "at least one owner" rule (deactivated accounts do not). */
export function activeOwnerCount(members: { role: Role; is_active: boolean }[]): number {
  return members.filter((m) => m.role === 'owner' && m.is_active).length;
}

// ---------- Invitation email lists ----------

export type EmailChip = { raw: string; email: string; error?: string; duplicate: boolean };

/** Split pasted text into entries: commas, semicolons and new lines separate entries; "Name <email>" keeps only the address. */
export function splitAddresses(text: string): string[] {
  return text
    .split(/[,;\r\n]+/)
    .flatMap((segment) => {
      const named = [...segment.matchAll(/<([^<>]+)>/g)].map((m) => m[1]);
      return named.length ? named : segment.split(/\s+/);
    })
    .map((token) => token.trim())
    .filter(Boolean);
}

/** Chips for the invite box, in typed order, each validated and flagged if it repeats an earlier address. */
export function parseEmailList(text: string): EmailChip[] {
  const seen = new Set<string>();
  return splitAddresses(text).map((raw) => {
    const email = raw.replace(/^[<"']+|[>"']+$/g, '').toLowerCase();
    const error = validateEmail(email) ? 'Not a valid email address' : undefined;
    const duplicate = !error && seen.has(email);
    if (!error) seen.add(email);
    return { raw, email, error, duplicate };
  });
}

/** The unique, valid addresses to send, or a reason the list cannot be sent yet. */
export function inviteListProblem(chips: EmailChip[]): string | null {
  const valid = uniqueValidEmails(chips);
  if (!valid.length) return chips.length ? 'None of these addresses look valid yet.' : 'Add at least one email address.';
  if (valid.length > MAX_INVITES) return `Invite at most ${MAX_INVITES} people at a time (you have ${valid.length}).`;
  return null;
}

export function uniqueValidEmails(chips: EmailChip[]): string[] {
  return chips.filter((chip) => !chip.error && !chip.duplicate).map((chip) => chip.email);
}

// ---------- Invitation display ----------

export type Countdown = { label: string; tone: 'ok' | 'warn' | 'bad' };

/** "Expires in 5 days", "Expires tomorrow", "Expires today", "Expired 3 days ago" relative to server time. */
export function expiryCountdown(expiresAt: string, now: Date): Countdown {
  const expiry = parseDate(expiresAt);
  const days = daysBetween(now, expiry);
  if (expiry.getTime() <= now.getTime()) {
    const ago = -days;
    return { label: ago <= 0 ? 'Expired today' : ago === 1 ? 'Expired yesterday' : `Expired ${ago} days ago`, tone: 'bad' };
  }
  if (days === 0) return { label: 'Expires today', tone: 'warn' };
  if (days === 1) return { label: 'Expires tomorrow', tone: 'warn' };
  return { label: `Expires in ${days} days`, tone: days <= 3 ? 'warn' : 'ok' };
}

export function inviteLink(token: string, origin: string): string {
  return `${origin.replace(/\/$/, '')}/invite/${encodeURIComponent(token)}`;
}

/** Query string for the sign-in / sign-up links on the invite landing page. */
export function inviteAuthSearch(token: string, email: string): string {
  return `?${new URLSearchParams({ invite: token, email }).toString()}`;
}

// ---------- Forms ----------

export type Errors<K extends string> = Partial<Record<K, string>>;

export function hasErrors(errors: Record<string, string | undefined>): boolean {
  return Object.values(errors).some(Boolean);
}

/** Only the fields whose value differs from the saved one, i.e. what a PATCH should send. */
export function changedFields<T extends Record<string, unknown>>(saved: T, draft: T): Partial<T> {
  const changes: Partial<T> = {};
  for (const key of Object.keys(draft) as (keyof T)[]) {
    const next = typeof draft[key] === 'string' ? (draft[key] as string).trim() : draft[key];
    if (next !== saved[key]) changes[key] = next as T[keyof T];
  }
  return changes;
}

export function isHexColor(value: string): boolean {
  return HEX_COLOR.test(value);
}

function lengthProblem(label: string, value: string, min: number, max: number): string | undefined {
  const length = value.trim().length;
  if (length < min) return min <= 1 ? `${label} is required.` : `${label} must be at least ${min} characters.`;
  if (length > max) return `${label} must be at most ${max} characters (currently ${length}).`;
  return undefined;
}

type ProfileFields = { name: string; headline: string; bio: string; timezone: string; avatar_color: string };

export function validateProfile(input: ProfileFields, timezones: readonly string[]): Errors<keyof ProfileFields> {
  return {
    name: lengthProblem('Name', input.name, NAME_MIN, NAME_MAX),
    headline: lengthProblem('Headline', input.headline, 0, HEADLINE_MAX),
    bio: lengthProblem('Bio', input.bio, 0, BIO_MAX),
    timezone: timezones.includes(input.timezone) ? undefined : 'Pick a time zone from the list.',
    avatar_color: isHexColor(input.avatar_color) ? undefined : 'Pick one of the colours.',
  };
}

export type PasswordForm = { current: string; next: string; confirm: string };

export function validatePasswordChange(form: PasswordForm): Errors<keyof PasswordForm> {
  return {
    current: form.current ? undefined : 'Enter your current password.',
    next: validateNewPassword(form.next) ?? (form.next === form.current ? 'Choose a password different from the current one.' : undefined),
    confirm: form.confirm === form.next ? undefined : 'The passwords do not match.',
  };
}

type WorkspaceFields ={ name: string; description: string; color: string };

export function validateWorkspace(input: WorkspaceFields): Errors<keyof WorkspaceFields> {
  return {
    name: lengthProblem('Workspace name', input.name, NAME_MIN, NAME_MAX),
    description: lengthProblem('Description', input.description, 0, WORKSPACE_DESCRIPTION_MAX),
    color: isHexColor(input.color) ? undefined : 'Use a hex colour like #1d6d45.',
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** Type-to-confirm for destructive actions: exact text, ignoring surrounding spaces (same as the API). */
export function confirmationMatches(typed: string, expected: string): boolean {
  return typed.trim() === expected.trim();
}

/** Filter IANA zones by every typed word, matching "new york" to "America/New_York". */
export function filterTimezones(zones: readonly string[], search: string, limit = 60): string[] {
  const words = search.toLowerCase().replace(/[_/]/g, ' ').split(/\s+/).filter(Boolean);
  const matching = words.length ? zones.filter((zone) => words.every((word) => zone.toLowerCase().replace(/[_/]/g, ' ').includes(word))) : zones;
  return matching.slice(0, limit);
}
