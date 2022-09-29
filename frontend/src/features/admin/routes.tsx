import { Navigate, Route } from 'react-router-dom';
import { MembersPage } from './MembersPage';
import { PreferencesSettings } from './settings/PreferencesSettings';
import { ProfileSettings } from './settings/ProfileSettings';
import { SecuritySettings } from './settings/SecuritySettings';
import { SettingsLayout } from './settings/SettingsLayout';
import { WorkspaceSettings } from './settings/WorkspaceSettings';

/** Routes rendered inside the signed-in app shell. (`/workspaces/new` lives in publicRoutes.) */
export const adminRoutes = (
  <>
    <Route path="members" element={<MembersPage />} />
    <Route path="settings" element={<SettingsLayout />}>
      <Route index element={<Navigate to="profile" replace />} />
      <Route path="profile" element={<ProfileSettings />} />
      <Route path="preferences" element={<PreferencesSettings />} />
      <Route path="security" element={<SecuritySettings />} />
      <Route path="workspace" element={<WorkspaceSettings />} />
      <Route path="*" element={<Navigate to="profile" replace />} />
    </Route>
  </>
);
