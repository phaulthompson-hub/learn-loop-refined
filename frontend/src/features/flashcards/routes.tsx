import { Route } from 'react-router-dom';
import { DeckPage } from './DeckPage';
import { DecksPage } from './DecksPage';
import { ReviewPage } from './ReviewPage';

/** Routes rendered inside the signed-in app shell. */
export const flashcardRoutes = (
  <>
    <Route path="review" element={<ReviewPage />} />
    <Route path="review/:deckId" element={<ReviewPage />} />
    <Route path="decks" element={<DecksPage />} />
    <Route path="decks/:deckId" element={<DeckPage />} />
  </>
);
