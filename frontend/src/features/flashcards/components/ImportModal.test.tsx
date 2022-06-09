// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../../test/render';
import { flashcardsApi } from '../api';
import { ImportModal } from './ImportModal';

vi.mock('../api', () => ({ flashcardsApi: { importCards: vi.fn() } }));

const importCards = vi.mocked(flashcardsApi.importCards);

const TEXT = ['ATP :: Energy currency', 'no separator here', 'What is ATP? :: duplicate of an existing card', 'Ribosome :: Builds proteins :: Think factory'].join('\n');

function renderModal() {
  const onImported = vi.fn();
  const onClose = vi.fn();
  renderWithProviders(<ImportModal deckId={5} deckName="Cell Biology" existingFronts={['What is ATP?']} onImported={onImported} onClose={onClose} />);
  return { onImported, onClose, textarea: screen.getByLabelText(/Cards/) };
}

describe('ImportModal', () => {
  it('starts with nothing to import', () => {
    renderModal();
    expect(screen.getByText('Paste or type lines to see a preview.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Import 0 cards' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('previews accepted and rejected lines with reasons before submitting', async () => {
    const callsBefore = importCards.mock.calls.length;
    const { textarea } = renderModal();
    fireEvent.change(textarea, { target: { value: TEXT } });
    await screen.findByText('2 ready');
    expect(screen.getByText('2 skipped')).toBeTruthy();
    expect(screen.getByText("Missing the ' :: ' separator between front and back")).toBeTruthy();
    expect(screen.getByText('A card with this front already exists')).toBeTruthy();
    expect(importCards.mock.calls.length).toBe(callsBefore);
  });

  it('imports the pasted text and reports back', async () => {
    importCards.mockResolvedValue({ accepted: [], rejected: [], created: 2 });
    const { textarea, onImported, onClose } = renderModal();
    fireEvent.change(textarea, { target: { value: TEXT } });
    const submit = await screen.findByRole('button', { name: 'Import 2 cards' });
    fireEvent.click(submit);
    await waitFor(() => expect(onImported).toHaveBeenCalledWith({ accepted: [], rejected: [], created: 2 }));
    expect(importCards).toHaveBeenCalledWith(5, TEXT);
    expect(onClose).toHaveBeenCalled();
  });

  it('shows the server error and stays open when the import fails', async () => {
    importCards.mockImplementation(async () => {
      throw new Error('Only instructors and the course owner can change this deck');
    });
    const { textarea, onClose } = renderModal();
    fireEvent.change(textarea, { target: { value: 'ATP :: Energy' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Import 1 card' }));
    await screen.findByText('Only instructors and the course owner can change this deck');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('blocks imports above the line limit', async () => {
    const { textarea } = renderModal();
    const lines = Array.from({ length: 501 }, (_, i) => `Card ${i} :: Answer`).join('\n');
    fireEvent.change(textarea, { target: { value: lines } });
    await screen.findByText(/Import at most 500 cards at a time \(501 lines\)/);
    expect((screen.getByRole('button', { name: /Import 501 cards/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
