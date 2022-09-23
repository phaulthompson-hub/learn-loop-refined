// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { roleAtLeast } from '../../app/roles';
import type { Role } from '../../app/types';
import { renderWithProviders } from '../../test/render';
import { invitationApi, memberApi } from './api';
import { MembersPage } from './MembersPage';
import type { Member } from './types';

const viewer = { role: 'admin' as Role };

vi.mock('../../app/auth', () => ({
  useAuth: () => ({ refresh: vi.fn() }),
  useWorkspace: () => ({ id: 1, name: 'Northwind', slug: 'northwind', color: '#1d6d45', role: viewer.role, can: (min: Role) => roleAtLeast(viewer.role, min) }),
}));
vi.mock('./api', () => ({
  memberApi: { list: vi.fn(), changeRole: vi.fn(), remove: vi.fn() },
  invitationApi: { list: vi.fn(), revoke: vi.fn(), resend: vi.fn(), create: vi.fn() },
}));

const member = (overrides: Partial<Member>): Member => ({
  user_id: 1,
  name: 'Someone',
  email: 'someone@learnloop.dev',
  avatar_color: '#2563eb',
  headline: '',
  role: 'learner',
  is_active: true,
  is_you: false,
  joined_at: '2022-01-13T09:00:00',
  last_active_at: '2022-03-13T21:00:00',
  courses: 2,
  answers_30d: 10,
  ...overrides,
});

const MEMBERS = [
  member({ user_id: 1, name: 'Maya Chen', email: 'maya@learnloop.dev', role: 'owner' }),
  member({ user_id: 2, name: 'Alex Rivera', email: 'demo@learnloop.dev', role: 'admin', is_you: true }),
  member({ user_id: 3, name: 'Sam Okafor', email: 'sam@learnloop.dev', role: 'learner', last_active_at: null }),
];

function setup(role: Role) {
  viewer.role = role;
  vi.mocked(memberApi.list).mockResolvedValue({ items: MEMBERS, total: 3, page: 1, page_size: 100, counts: { learner: 1, instructor: 0, admin: 1, owner: 1 } });
  vi.mocked(invitationApi.list).mockResolvedValue({ items: [], total: 0, page: 1, page_size: 100, counts: { pending: 0, expired: 0, accepted: 0, revoked: 0, all: 0 } });
  renderWithProviders(<MembersPage />);
}

const row = (name: string) => screen.getByText(name).closest('tr') as HTMLElement;

describe('MembersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('gives admins role selects only where the rules allow it', async () => {
    setup('admin');
    await screen.findByText('Sam Okafor');
    const samSelect = within(row('Sam Okafor')).getByRole('combobox', { name: 'Role for Sam Okafor' });
    expect([...samSelect.querySelectorAll('option')].map((o) => o.value)).toEqual(['learner', 'instructor', 'admin']);
    // Admins cannot touch the owner or their own role.
    expect(within(row('Maya Chen')).queryByRole('combobox')).toBeNull();
    expect(within(row('Alex Rivera')).queryByRole('combobox')).toBeNull();
    expect(screen.getByRole('button', { name: /Invite people/ })).toBeTruthy();
    expect(screen.getByText('Never')).toBeTruthy();
  });

  it('changes a role straight away when no confirmation is needed', async () => {
    setup('admin');
    vi.mocked(memberApi.changeRole).mockResolvedValue(member({ user_id: 3, role: 'instructor' }));
    await screen.findByText('Sam Okafor');
    fireEvent.change(within(row('Sam Okafor')).getByRole('combobox'), { target: { value: 'instructor' } });
    await waitFor(() => expect(memberApi.changeRole).toHaveBeenCalledWith(1, 3, 'instructor'));
  });

  it('asks before granting ownership', async () => {
    setup('owner');
    await screen.findByText('Sam Okafor');
    fireEvent.change(within(row('Sam Okafor')).getByRole('combobox'), { target: { value: 'owner' } });
    expect(await screen.findByText('Make Sam Okafor an owner?')).toBeTruthy();
    expect(memberApi.changeRole).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Make owner' }));
    await waitFor(() => expect(memberApi.changeRole).toHaveBeenCalledWith(1, 3, 'owner'));
  });

  it('filters by search text and role tiles', async () => {
    setup('admin');
    await screen.findByText('Sam Okafor');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search members' }), { target: { value: 'okafor' } });
    expect(screen.queryByText('Maya Chen')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    fireEvent.click(screen.getByRole('button', { name: /1\s*Owner/ }));
    expect(screen.queryByText('Sam Okafor')).toBeNull();
    expect(screen.getByText('Maya Chen')).toBeTruthy();
  });

  it('shows learners a read-only directory', async () => {
    setup('learner');
    await screen.findByText('Sam Okafor');
    expect(screen.queryAllByRole('combobox', { name: /Role for/ })).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /Invite people/ })).toBeNull();
    expect(screen.queryByText('Invitations')).toBeNull();
    expect(invitationApi.list).not.toHaveBeenCalled();
  });
});
