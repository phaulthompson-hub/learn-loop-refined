// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/render';
import { invitationApi } from './api';
import { InvitePage } from './InvitePage';
import type { InvitationPreview } from './types';

const auth = {
  status: 'signed-out' as 'signed-out' | 'signed-in',
  me: null as null | { user: { id: number; email: string } },
  refresh: vi.fn(),
  switchWorkspace: vi.fn(),
  logout: vi.fn(),
};

vi.mock('../../app/auth', () => ({ useAuth: () => auth }));
vi.mock('./api', () => ({ invitationApi: { preview: vi.fn(), accept: vi.fn() } }));

const PREVIEW: InvitationPreview = {
  email: 'nora@learnloop.dev',
  role: 'learner',
  status: 'pending',
  expired: false,
  message: 'Welcome aboard!',
  expires_at: '2022-03-26T10:30:00',
  workspace: { name: 'Northwind Data Academy', color: '#1d6d45', description: 'Analytics guild', members: 5 },
  inviter: { name: 'Alex Rivera', avatar_color: '#1d6d45' },
  has_account: false,
  viewer_email_matches: null,
  viewer_is_member: null,
};

function show(preview: Partial<InvitationPreview> = {}) {
  vi.mocked(invitationApi.preview).mockResolvedValue({ ...PREVIEW, ...preview });
  renderWithProviders(
    <Routes>
      <Route path="/invite/:token" element={<InvitePage />} />
      <Route path="/" element={<p>Home page</p>} />
    </Routes>,
    { route: '/invite/demo-invite-northwind-nora' },
  );
}

describe('InvitePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.status = 'signed-out';
    auth.me = null;
  });

  it('shows the invitation and sign-up / sign-in links carrying the token and email when signed out', async () => {
    show();
    expect(await screen.findByRole('heading', { name: 'Northwind Data Academy' })).toBeTruthy();
    expect(screen.getByText('Welcome aboard!')).toBeTruthy();
    const signUp = screen.getByRole('link', { name: /Create an account/ });
    expect(signUp.getAttribute('href')).toBe('/register?invite=demo-invite-northwind-nora&email=nora%40learnloop.dev');
    expect(signUp.className).toContain('primary');
    expect(screen.getByRole('link', { name: /Sign in to accept/ }).getAttribute('href')).toContain('/login?invite=');
  });

  it('explains closed invitations instead of offering actions', async () => {
    show({ status: 'expired', expired: true });
    expect(await screen.findByText('This invitation has expired')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Create an account/ })).toBeNull();
  });

  it('warns when signed in with a different email', async () => {
    auth.status = 'signed-in';
    auth.me = { user: { id: 3, email: 'sam@learnloop.dev' } };
    show({ viewer_email_matches: false, viewer_is_member: false });
    expect(await screen.findByText(/but you are signed in as/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Join/ })).toBeNull();
  });

  it('accepts, refreshes the session, switches workspace and goes home', async () => {
    auth.status = 'signed-in';
    auth.me = { user: { id: 9, email: 'nora@learnloop.dev' } };
    vi.mocked(invitationApi.accept).mockResolvedValue({ workspace_id: 1 } as Awaited<ReturnType<typeof invitationApi.accept>>);
    show({ viewer_email_matches: true, viewer_is_member: false });
    fireEvent.click(await screen.findByRole('button', { name: 'Join Northwind Data Academy' }));
    await waitFor(() => expect(screen.getByText('Home page')).toBeTruthy());
    expect(invitationApi.accept).toHaveBeenCalledWith('demo-invite-northwind-nora');
    expect(auth.refresh).toHaveBeenCalled();
    expect(auth.switchWorkspace).toHaveBeenCalledWith(1);
  });
});
