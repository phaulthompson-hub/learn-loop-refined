import { Route } from 'react-router-dom';
import { InvitePage } from './InvitePage';
import { NewWorkspacePage } from './NewWorkspacePage';

/**
 * Routes outside the app shell: the invite landing page works signed out, and creating a
 * workspace must work for a signed-in user who has no workspace (the shell requires one).
 */
export const adminPublicRoutes = (
  <>
    <Route path="invite/:token" element={<InvitePage />} />
    <Route path="workspaces/new" element={<NewWorkspacePage />} />
  </>
);
