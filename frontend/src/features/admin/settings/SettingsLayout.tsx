import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { Building2, Palette, ShieldCheck, User } from 'lucide-react';
import { useWorkspace } from '../../../app/auth';
import { RouteTabs } from '../../../components/Tabs';
import { PageHeader } from '../../../components/ui';
import '../admin.css';

const TABS = [
  { to: 'profile', label: 'Profile', icon: <User /> },
  { to: 'preferences', label: 'Preferences', icon: <Palette /> },
  { to: 'security', label: 'Security', icon: <ShieldCheck /> },
  { to: 'workspace', label: 'Workspace', icon: <Building2 /> },
];

export function SettingsLayout() {
  const workspace = useWorkspace();
  return (
    <div className="admin-page settings-page">
      <PageHeader eyebrow="Settings" title="Your account" subtitle={`Profile, preferences and security are yours everywhere; workspace settings apply to ${workspace.name}.`} />
      <RouteTabs label="Settings sections" items={TABS} />
      <Outlet />
    </div>
  );
}

/** Ask for confirmation before the tab is closed or reloaded while a form has unsaved changes. */
export function useUnsavedChangesWarning(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
}
