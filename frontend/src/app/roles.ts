import type { Role } from './types';

export const ROLES: Role[] = ['learner', 'instructor', 'admin', 'owner'];

/** Mirrors backend/app/deps.py: learner < instructor < admin < owner. */
export function roleAtLeast(role: Role | undefined | null, minimum: Role): boolean {
  if (!role) return false;
  return ROLES.indexOf(role) >= ROLES.indexOf(minimum);
}

export const ROLE_LABELS: Record<Role, string> = {
  learner: 'Learner',
  instructor: 'Instructor',
  admin: 'Admin',
  owner: 'Owner',
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  learner: 'Takes courses, reviews flashcards, keeps notes and works on assigned tasks.',
  instructor: 'Everything a learner can do, plus creating and editing courses and decks.',
  admin: 'Manages members, invitations, labels and workspace settings.',
  owner: 'Full control, including deleting the workspace and transferring ownership.',
};
