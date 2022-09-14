import type { Me, Person, Role } from '../../app/types';
import type { Page } from '../../lib/http';

export type WorkspaceStats = {
  members: number;
  members_by_role: Record<Role, number>;
  courses: number;
  active_courses: number;
  active_learners_7d: number;
  answers_7d: number;
  reviews_7d: number;
  pending_invitations: number;
};

export type WorkspaceDetail = {
  id: number;
  name: string;
  slug: string;
  description: string;
  color: string;
  created_at: string;
  owner: Person | null;
  your_role: Role;
  stats: WorkspaceStats;
};

export type WorkspaceInput = { name: string; description: string; color: string };

export type Member = {
  user_id: number;
  name: string;
  email: string;
  avatar_color: string;
  headline: string;
  role: Role;
  is_active: boolean;
  is_you: boolean;
  joined_at: string;
  last_active_at: string | null;
  courses: number;
  answers_30d: number;
};

export type MemberPage = Page<Member> & { counts: Record<Role, number> };

export type InvitationStatus = 'pending' | 'expired' | 'accepted' | 'revoked';
export type InvitationFilter = InvitationStatus | 'all';

export type Invitation = {
  id: number;
  email: string;
  role: Role;
  status: InvitationStatus;
  message: string;
  token: string;
  invited_by: Person | null;
  created_at: string;
  expires_at: string;
  has_account: boolean;
};

export type InvitationPage = Page<Invitation> & { counts: Record<InvitationFilter, number> };

export type InviteInput = { emails: string[]; role: Role; message: string };

export type InviteResult = {
  email: string;
  outcome: 'invited' | 'skipped' | 'invalid';
  reason: string;
  invitation: Invitation | null;
};

export type InviteSummary = { invited: number; skipped: number; results: InviteResult[] };

export type InvitationPreview = {
  email: string;
  role: Role;
  status: InvitationStatus;
  expired: boolean;
  message: string;
  expires_at: string;
  workspace: { name: string; color: string; description: string; members: number };
  inviter: { name: string; avatar_color: string } | null;
  has_account: boolean;
  viewer_email_matches: boolean | null;
  viewer_is_member: boolean | null;
};

export type InvitationAccepted = Me & { workspace_id: number };

export type SessionInfo = {
  id: number;
  device: string;
  user_agent: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  current: boolean;
};

export type ProfileInput = { name: string; headline: string; bio: string; timezone: string; avatar_color: string };

export type PreferencesInput = {
  theme: 'light' | 'dark' | 'system';
  daily_goal_minutes: number;
  quiz_length: number;
  week_starts_on: number;
  email_digest: boolean;
  reduced_motion: boolean;
};
