import { describe, expect, it } from 'vitest';
import { ROLES } from '../../app/roles';
import type { Role } from '../../app/types';
import {
  activeOwnerCount,
  assignableRoles,
  changedFields,
  clamp,
  confirmationMatches,
  expiryCountdown,
  filterTimezones,
  inviteAuthSearch,
  inviteLink,
  inviteListProblem,
  invitableRoles,
  leaveProblem,
  parseEmailList,
  removalProblem,
  roleChangeProblem,
  splitAddresses,
  uniqueValidEmails,
  validatePasswordChange,
  validateProfile,
  validateWorkspace,
} from './validation';

const NOW = new Date('2022-03-14T09:00:00Z');

describe('role rules (mirror of services/membership.py)', () => {
  it('never lets learners or instructors change roles', () => {
    for (const actorRole of ['learner', 'instructor'] as Role[]) {
      for (const targetRole of ROLES) expect(assignableRoles(actorRole, targetRole, false, 2)).toEqual([]);
    }
  });

  it('lets admins move non-owners between non-owner roles only', () => {
    expect(assignableRoles('admin', 'learner', false, 1)).toEqual(['instructor', 'admin']);
    expect(assignableRoles('admin', 'admin', false, 1)).toEqual(['learner', 'instructor']);
    expect(assignableRoles('admin', 'owner', false, 2)).toEqual([]);
    expect(roleChangeProblem({ actorRole: 'admin', targetRole: 'learner', newRole: 'owner', isSelf: false, ownerCount: 1 })).toMatch(/grant the owner/);
  });

  it('lets owners grant and revoke ownership while keeping one owner', () => {
    expect(assignableRoles('owner', 'learner', false, 1)).toEqual(['instructor', 'admin', 'owner']);
    expect(assignableRoles('owner', 'owner', false, 2)).toEqual(['learner', 'instructor', 'admin']);
  });

  it('only allows an owner to step down when another owner exists', () => {
    expect(assignableRoles('owner', 'owner', true, 1)).toEqual([]);
    expect(roleChangeProblem({ actorRole: 'owner', targetRole: 'owner', newRole: 'admin', isSelf: true, ownerCount: 1 })).toMatch(/only owner/);
    expect(assignableRoles('owner', 'owner', true, 2)).toEqual(['learner', 'instructor', 'admin']);
    expect(assignableRoles('admin', 'admin', true, 1)).toEqual([]);
  });

  it('keeps at least one owner for every allowed change', () => {
    for (const actorRole of ROLES)
      for (const targetRole of ROLES)
        for (const ownerCount of [1, 2])
          for (const isSelf of [false, true]) {
            if (isSelf && actorRole !== targetRole) continue;
            for (const newRole of assignableRoles(actorRole, targetRole, isSelf, ownerCount)) {
              const after = ownerCount - (targetRole === 'owner' ? 1 : 0) + (newRole === 'owner' ? 1 : 0);
              expect(after).toBeGreaterThanOrEqual(1);
            }
          }
  });

  it('removal, leaving and inviting', () => {
    expect(removalProblem('admin', 'learner', false)).toBeNull();
    expect(removalProblem('admin', 'owner', false)).toMatch(/Only owners/);
    expect(removalProblem('owner', 'owner', false)).toBeNull();
    expect(removalProblem('owner', 'owner', true)).toMatch(/Leave/);
    expect(removalProblem('instructor', 'learner', false)).toMatch(/Only admins/);
    expect(leaveProblem('owner', 1)).toMatch(/only owner/);
    expect(leaveProblem('owner', 2)).toBeNull();
    expect(leaveProblem('learner', 1)).toBeNull();
    expect(invitableRoles('learner')).toEqual([]);
    expect(invitableRoles('admin')).toEqual(['learner', 'instructor', 'admin']);
    expect(invitableRoles('owner')).toEqual(ROLES);
  });

  it('counts only active owners', () => {
    const members = [
      { role: 'owner' as Role, is_active: true },
      { role: 'owner' as Role, is_active: false },
      { role: 'admin' as Role, is_active: true },
    ];
    expect(activeOwnerCount(members)).toBe(1);
  });
});

describe('email list parsing', () => {
  it('splits on commas, semicolons and new lines, and keeps only the address of "Name <email>"', () => {
    expect(splitAddresses('a@x.io, b@x.io;c@x.io\n Ada Lovelace <ada@x.io>')).toEqual(['a@x.io', 'b@x.io', 'c@x.io', 'ada@x.io']);
    expect(splitAddresses('d@x.io e@x.io')).toEqual(['d@x.io', 'e@x.io']);
    expect(splitAddresses(' ,; \n ')).toEqual([]);
  });

  it('normalises, validates and flags duplicates in typed order', () => {
    const chips = parseEmailList('Ada@Example.com, nope, ada@example.com, "grace@example.org"');
    expect(chips.map((c) => [c.email, Boolean(c.error), c.duplicate])).toEqual([
      ['ada@example.com', false, false],
      ['nope', true, false],
      ['ada@example.com', false, true],
      ['grace@example.org', false, false],
    ]);
    expect(uniqueValidEmails(chips)).toEqual(['ada@example.com', 'grace@example.org']);
  });

  it('explains why a list cannot be sent', () => {
    expect(inviteListProblem([])).toMatch(/at least one/);
    expect(inviteListProblem(parseEmailList('nope, still-nope'))).toMatch(/None of these/);
    const many = Array.from({ length: 51 }, (_, i) => `p${i}@example.com`).join(',');
    expect(inviteListProblem(parseEmailList(many))).toMatch(/at most 50.*51/);
    expect(inviteListProblem(parseEmailList('ok@example.com, bad'))).toBeNull();
  });
});

describe('invitation display helpers', () => {
  it('counts down to expiry in days relative to server time', () => {
    expect(expiryCountdown('2022-03-26T10:30:00', NOW)).toEqual({ label: 'Expires in 12 days', tone: 'ok' });
    expect(expiryCountdown('2022-03-16T10:30:00', NOW)).toEqual({ label: 'Expires in 2 days', tone: 'warn' });
    expect(expiryCountdown('2022-03-15T08:00:00', NOW)).toEqual({ label: 'Expires tomorrow', tone: 'warn' });
    expect(expiryCountdown('2022-03-14T18:00:00', NOW)).toEqual({ label: 'Expires today', tone: 'warn' });
    expect(expiryCountdown('2022-03-14T08:00:00', NOW)).toEqual({ label: 'Expired today', tone: 'bad' });
    expect(expiryCountdown('2022-03-13T08:00:00', NOW).label).toBe('Expired yesterday');
    expect(expiryCountdown('2022-03-08T10:30:00', NOW).label).toBe('Expired 6 days ago');
  });

  it('builds invite links and auth query strings', () => {
    expect(inviteLink('demo-invite-northwind-nora', 'https://learnloop.dev/')).toBe('https://learnloop.dev/invite/demo-invite-northwind-nora');
    expect(inviteAuthSearch('tok_1', 'nora@learnloop.dev')).toBe('?invite=tok_1&email=nora%40learnloop.dev');
  });
});

describe('forms', () => {
  it('reports only changed, trimmed fields', () => {
    const saved = { name: 'Sam Okafor', headline: 'Backend engineer', quiz_length: 4 };
    expect(changedFields(saved, { ...saved, name: '  Sam Okafor ' })).toEqual({});
    expect(changedFields(saved, { ...saved, headline: ' Platform engineer ', quiz_length: 6 })).toEqual({ headline: 'Platform engineer', quiz_length: 6 });
  });

  it('validates the profile form like the API', () => {
    const zones = ['UTC', 'Europe/Berlin'];
    const valid = { name: 'Sam', headline: '', bio: '', timezone: 'UTC', avatar_color: '#1d6d45' };
    expect(Object.values(validateProfile(valid, zones)).filter(Boolean)).toEqual([]);
    const errors = validateProfile({ name: ' S ', headline: 'h'.repeat(121), bio: 'b'.repeat(601), timezone: 'Mars/Base', avatar_color: 'teal' }, zones);
    expect(errors.name).toMatch(/at least 2/);
    expect(errors.headline).toMatch(/at most 120 characters \(currently 121\)/);
    expect(errors.bio).toMatch(/at most 600/);
    expect(errors.timezone).toBeDefined();
    expect(errors.avatar_color).toBeDefined();
  });

  it('validates the workspace form', () => {
    expect(validateWorkspace({ name: 'Physics', description: '', color: '#2563eb' })).toEqual({ name: undefined, description: undefined, color: undefined });
    expect(validateWorkspace({ name: 'P', description: 'd'.repeat(501), color: '#2563e' })).toEqual({
      name: 'Workspace name must be at least 2 characters.',
      description: 'Description must be at most 500 characters (currently 501).',
      color: 'Use a hex colour like #1d6d45.',
    });
  });

  it('validates a password change', () => {
    expect(validatePasswordChange({ current: '', next: 'abc', confirm: 'abd' })).toEqual({
      current: 'Enter your current password.',
      next: 'Use at least 8 characters, a mix of letters and numbers or symbols.',
      confirm: 'The passwords do not match.',
    });
    expect(validatePasswordChange({ current: 'learnloop123', next: 'learnloop123', confirm: 'learnloop123' }).next).toMatch(/different/);
    expect(Object.values(validatePasswordChange({ current: 'learnloop123', next: 'fresh-pass-9', confirm: 'fresh-pass-9' })).filter(Boolean)).toEqual([]);
  });

  it('requires the exact workspace name to confirm deletion', () => {
    expect(confirmationMatches('  Northwind Data Academy ', 'Northwind Data Academy')).toBe(true);
    expect(confirmationMatches('northwind data academy', 'Northwind Data Academy')).toBe(false);
  });

  it('clamps slider values', () => {
    expect(clamp(2, 5, 480)).toBe(5);
    expect(clamp(500, 5, 480)).toBe(480);
    expect(clamp(42.6, 5, 480)).toBe(43);
  });

  it('filters time zones by every typed word', () => {
    const zones = ['UTC', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Asia/Tokyo'];
    expect(filterTimezones(zones, 'new york')).toEqual(['America/New_York']);
    expect(filterTimezones(zones, 'america')).toEqual(['America/New_York', 'America/Los_Angeles']);
    expect(filterTimezones(zones, '')).toEqual(zones);
    expect(filterTimezones(zones, '', 2)).toEqual(['UTC', 'America/New_York']);
  });
});
