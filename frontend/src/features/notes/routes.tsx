import { Route } from 'react-router-dom';
import { NotesPage } from './NotesPage';

/** Routes rendered inside the signed-in app shell. One optional-param route keeps the list mounted between notes. */
export const noteRoutes = <Route path="notes/:noteId?" element={<NotesPage />} />;
