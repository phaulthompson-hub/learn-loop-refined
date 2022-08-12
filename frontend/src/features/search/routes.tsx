import { Route } from 'react-router-dom';
import { SearchPage } from './SearchPage';

/** Routes rendered inside the signed-in app shell. */
export const searchRoutes = <Route path="search" element={<SearchPage />} />;
