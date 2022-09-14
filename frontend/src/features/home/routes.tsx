import { Route } from 'react-router-dom';
import { NotificationsPage } from '../notifications/NotificationsPage';
import { ActivityPage } from './ActivityPage';
import { AnalyticsPage } from './AnalyticsPage';

/** Routes rendered inside the signed-in app shell (the home page itself is the shell's index route). */
export const homeRoutes = (
  <>
    <Route path="analytics" element={<AnalyticsPage />} />
    <Route path="activity" element={<ActivityPage />} />
    <Route path="notifications" element={<NotificationsPage />} />
  </>
);
