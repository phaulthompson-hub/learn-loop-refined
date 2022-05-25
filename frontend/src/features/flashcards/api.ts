import { http, query } from '../../lib/http';
import type {
  Card,
  CardInput,
  CardPage,
  DeckDetail,
  DeckInput,
  DeckPage,
  GenerateResult,
  Grade,
  ImportResult,
  ReviewQueue,
  ReviewResult,
  ReviewStats,
  SessionInput,
  SessionResult,
} from './types';

/** The API caps page sizes at 100; decks can be larger, so card lists are fetched page by page. */
const CARD_PAGE_SIZE = 100;

type Scope = { deck_id?: number | null; course_id?: number | null };

export const flashcardsApi = {
  decks: (workspaceId: number) => http.get<DeckPage>(`/workspaces/${workspaceId}/decks${query({ page_size: 100 })}`),
  deck: (deckId: number) => http.get<DeckDetail>(`/decks/${deckId}`),
  createDeck: (workspaceId: number, input: DeckInput) => http.post<DeckDetail>(`/workspaces/${workspaceId}/decks`, input),
  updateDeck: (deckId: number, input: Partial<Omit<DeckInput, 'course_id'>>) => http.patch<DeckDetail>(`/decks/${deckId}`, input),
  deleteDeck: (deckId: number) => http.delete(`/decks/${deckId}`),

  async cards(deckId: number): Promise<Card[]> {
    const cards: Card[] = [];
    for (let page = 1; ; page += 1) {
      const result = await http.get<CardPage>(`/decks/${deckId}/cards${query({ page, page_size: CARD_PAGE_SIZE })}`);
      cards.push(...result.items);
      if (cards.length >= result.total || !result.items.length) return cards;
    }
  },
  createCard: (deckId: number, input: CardInput) => http.post<Card>(`/decks/${deckId}/cards`, input),
  updateCard: (cardId: number, input: Partial<CardInput>) => http.patch<Card>(`/cards/${cardId}`, input),
  deleteCard: (cardId: number) => http.delete(`/cards/${cardId}`),
  importCards: (deckId: number, text: string, dryRun = false) =>
    http.post<ImportResult>(`/decks/${deckId}/cards/import`, { text, dry_run: dryRun }),
  generateCards: (deckId: number) => http.post<GenerateResult>(`/decks/${deckId}/cards/generate`),

  queue: (workspaceId: number, scope: Scope = {}) => http.get<ReviewQueue>(`/workspaces/${workspaceId}/review/queue${query(scope)}`),
  review: (cardId: number, grade: Grade) => http.post<ReviewResult>(`/cards/${cardId}/review`, { grade }),
  finishSession: (workspaceId: number, input: SessionInput) => http.post<SessionResult>(`/workspaces/${workspaceId}/review/sessions`, input),
  stats: (workspaceId: number, scope: Scope = {}) => http.get<ReviewStats>(`/workspaces/${workspaceId}/review/stats${query(scope)}`),
};
