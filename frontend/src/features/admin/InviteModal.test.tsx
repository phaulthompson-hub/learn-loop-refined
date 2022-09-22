// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/render';
import { invitationApi } from './api';
import { InviteModal } from './members/InviteModal';
import type { InviteSummary } from './types';

vi.mock('./api', () => ({ invitationApi: { create: vi.fn() } }));

const create = vi.mocked(invitationApi.create);

function open(actorRole: 'admin' | 'owner' = 'admin') {
  const onInvited = vi.fn();
  renderWithProviders(<InviteModal workspaceId={7} workspaceName="Northwind" actorRole={actorRole} onClose={vi.fn()} onInvited={onInvited} />);
  return { onInvited, box: screen.getByRole('textbox', { name: 'Email addresses' }) };
}

describe('InviteModal', () => {
  beforeEach(() => {
    create.mockReset();
  });

  it('turns pasted text into chips and flags invalid and duplicate addresses', () => {
    const { box } = open();
    fireEvent.change(box, { target: { value: 'ada@example.com, nope, ADA@example.com, ' } });
    const chips = [...document.querySelectorAll('.email-chip')];
    expect(chips.map((chip) => chip.className.replace('email-chip', '').trim())).toEqual(['', 'invalid', 'duplicate']);
    expect(chips[2].textContent).toContain('ada@example.com');
    expect(screen.getByText('1 valid')).toBeTruthy();
  });

  it('only offers the owner role to owners', () => {
    open('admin');
    expect(screen.queryByRole('radio', { name: /Owner/ })).toBeNull();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
  });

  it('removes a chip with its button', () => {
    const { box } = open();
    fireEvent.change(box, { target: { value: 'ada@example.com, grace@example.org,' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remove ada@example.com' }));
    expect(document.querySelectorAll('.email-chip')).toHaveLength(1);
  });

  it('refuses to send an empty list', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: /Send invitation/ }));
    expect(screen.getByText('Add at least one email address.')).toBeTruthy();
    expect(create).not.toHaveBeenCalled();
  });

  it('sends unique valid addresses with the chosen role and shows each outcome', async () => {
    const summary: InviteSummary = {
      invited: 1,
      skipped: 1,
      results: [
        { email: 'grace@example.org', outcome: 'invited', reason: '', invitation: null },
        { email: 'sam@learnloop.dev', outcome: 'skipped', reason: 'Already a member', invitation: null },
      ],
    };
    create.mockResolvedValue(summary);
    const { box, onInvited } = open();
    fireEvent.change(box, { target: { value: 'grace@example.org\nsam@learnloop.dev\ngrace@example.org' } });
    fireEvent.click(screen.getByRole('radio', { name: /Instructor/ }));
    fireEvent.change(screen.getByLabelText(/Personal message/), { target: { value: '  Welcome!  ' } });
    fireEvent.click(screen.getByRole('button', { name: /Send 2 invitations/ }));
    await waitFor(() => expect(screen.getByText('1 invitation sent')).toBeTruthy());
    expect(create).toHaveBeenCalledWith(7, { emails: ['grace@example.org', 'sam@learnloop.dev'], role: 'instructor', message: 'Welcome!' });
    expect(screen.getByText('Already a member')).toBeTruthy();
    expect(onInvited).toHaveBeenCalled();
  });
});
