import { Route } from 'react-router-dom';
import { BoardPage } from './BoardPage';

/** Routes rendered inside the signed-in app shell. `/board?task=<number>` opens a task's drawer. */
export const boardRoutes = <Route path="board" element={<BoardPage />} />;
