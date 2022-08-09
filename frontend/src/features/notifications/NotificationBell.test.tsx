// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { renderWithProviders } from '../../test/render';
import type { AppNotification, NotificationPage } from './types';

const auth = { unread: 3, setUnread: vi.fn() };

vi.mock('../../app/auth', () => ({
  useAuth: () => ({ me: { unread_notifications: auth.unread }, setUnread: auth.setUnread }),
}));
vi.mock('./api', () => ({ notificationsApi: { list: vi.fn(), setRead: vi.fn(), markAllRead: vi.fn() } }));

const { NotificationBell } = await import('./NotificationBell');
const api = (await import('./api')).notificationsApi as unknown as { list: Mock; setRead: Mock; markAllRead: Mock };

const item = (id: number, read: boolean, title: string, link = '/board?task=5'): AppNotification => ({
  id,
  kind: 'task_assigned',
  title,
  body: '',
  link,
  created_at: '2022-03-14T08:00:00',
  read_at: read ? '2022-03-14T08:10:00' : null,
  read,
  actor: null,
  workspace: { id: 1, name: 'Northwind', color: '#1d6d45' },
});

const page = (items: AppNotification[], unread: number): NotificationPage => ({
  items,
  total: items.length,
  unread,
  has_more: false,
  next_before_id: null,
  kinds: { review_due: 0, task_assigned: items.length, comment: 0, invite: 0, goal: 0, mastery: 0, event: 0, system: 0 },
});

function Where() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}

function renderBell() {
  return renderWithProviders(
    <>
      <NotificationBell />
      <Routes>
        <Route path="*" element={<Where />} />
      </Routes>
    </>,
  );
}

describe('NotificationBell', () => {
  beforeEach(() => {
    auth.unread = 3;
    auth.setUnread.mockReset();
    api.list.mockReset().mockResolvedValue(page([item(1, false, 'Maya assigned you LL-5'), item(2, true, 'Welcome')], 3));
    api.setRead.mockReset().mockResolvedValue(item(1, true, 'Maya assigned you LL-5'));
    api.markAllRead.mockReset().mockResolvedValue({ changed: 3, unread: 0 });
  });

  it('shows the unread count from the signed-in user', () => {
    renderBell();
    expect(screen.getByRole('button', { name: 'Notifications, 3 unread' }).textContent).toBe('3');
  });

  it('hides the badge when everything is read', () => {
    auth.unread = 0;
    renderBell();
    expect(screen.getByRole('button', { name: 'Notifications, all caught up' }).textContent).toBe('');
  });

  it('loads the latest notifications when opened', async () => {
    const user = userEvent.setup();
    renderBell();
    await user.click(screen.getByRole('button', { name: /Notifications/ }));
    expect(api.list).toHaveBeenCalledWith({ limit: 8 });
    expect(await screen.findByText('Maya assigned you LL-5')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Notifications' })).toBeTruthy();
    expect(auth.setUnread).toHaveBeenCalledWith(3);
  });

  it('marks an unread notification read and follows its link', async () => {
    const user = userEvent.setup();
    renderBell();
    await user.click(screen.getByRole('button', { name: /Notifications/ }));
    await user.click(await screen.findByText('Maya assigned you LL-5'));
    expect(api.setRead).toHaveBeenCalledWith(1, true);
    expect(auth.setUnread).toHaveBeenLastCalledWith(2);
    expect(screen.getByTestId('location').textContent).toBe('/board?task=5');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not call the API again for an already-read notification', async () => {
    const user = userEvent.setup();
    renderBell();
    await user.click(screen.getByRole('button', { name: /Notifications/ }));
    await user.click(await screen.findByText('Welcome'));
    expect(api.setRead).not.toHaveBeenCalled();
  });

  it('marks everything read', async () => {
    const user = userEvent.setup();
    renderBell();
    await user.click(screen.getByRole('button', { name: /Notifications/ }));
    await screen.findByText('Welcome');
    await user.click(screen.getByRole('button', { name: /Mark all read/ }));
    await waitFor(() => expect(auth.setUnread).toHaveBeenLastCalledWith(0));
    expect(api.markAllRead).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape and returns focus to the bell', async () => {
    const user = userEvent.setup();
    renderBell();
    const bell = screen.getByRole('button', { name: /Notifications/ });
    await user.click(bell);
    await screen.findByText('Welcome');
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement?.textContent).toContain('Maya assigned you LL-5');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(bell);
  });

  it('shows an error with a retry', async () => {
    api.list.mockRejectedValueOnce(new Error('Cannot reach the LearnLoop API'));
    const user = userEvent.setup();
    renderBell();
    await user.click(screen.getByRole('button', { name: /Notifications/ }));
    expect(await screen.findByText('Cannot reach the LearnLoop API')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Welcome')).toBeTruthy();
  });
});
