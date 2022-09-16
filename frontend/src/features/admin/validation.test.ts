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

