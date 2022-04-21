import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Cpu, ChevronsUpDown, LogOut, Menu as MenuIcon, Plus, Search, Settings, User, X } from 'lucide-react';
import { useAuth, useUser, useWorkspace } from '../app/auth';
import { ROLE_LABELS } from '../app/roles';
import { useToast } from '../app/toast';
import { Avatar } from '../components/Avatar';
import { Menu } from '../components/Menu';
import { CommandPalette } from '../features/search/CommandPalette';
import { NotificationBell } from '../features/notifications/NotificationBell';
import { INSIGHT_NAV, PRIMARY_NAV, WORKSPACE_NAV, type NavItem } from './nav';

function NavGroup({ title, items }: { title?: string; items: NavItem[] }) {
  return (
    <div className="nav-group">
      {title && <p className="nav-title">{title}</p>}
      {items.map(({ to, label, icon: Icon, end }) => (
        <NavLink key={to} to={to} end={end}>
          <Icon />
          <span>{label}</span>
        </NavLink>
      ))}
    </div>
  );
}

function WorkspaceSwitcher() {
  const { me, switchWorkspace } = useAuth();
  const workspace = useWorkspace();
  const navigate = useNavigate();
  const toast = useToast();
  return (
    <Menu
      align="left"
      className="workspace-switcher"
      header={<span className="muted">Workspaces</span>}
      trigger={({ toggle, ref, open }) => (
        <button type="button" ref={ref} className="workspace-button" aria-haspopup="menu" aria-expanded={open} onClick={toggle}>
          <span className="workspace-mark" style={{ background: workspace.color }}>
            {workspace.name[0]}
          </span>
          <span className="workspace-name">
            <b>{workspace.name}</b>
            <small>{ROLE_LABELS[workspace.role]}</small>
          </span>
          <ChevronsUpDown />
        </button>
      )}
      items={[
        ...(me?.workspaces ?? []).map((w) => ({
          label: w.name,
          icon: (
            <span className="workspace-mark small" style={{ background: w.color }}>
              {w.name[0]}
            </span>
          ),
          hint: w.id === workspace.id ? 'Current' : ROLE_LABELS[w.role],
          onSelect: () => {
            if (w.id === workspace.id) return;
            switchWorkspace(w.id)
              .then(() => navigate('/'))
              .catch((err: Error) => toast.error(err.message));
          },
        })),
        'separator' as const,
        { label: 'Create workspace', icon: <Plus />, onSelect: () => navigate('/workspaces/new') },
      ]}
    />
  );
}

function UserMenu() {
  const user = useUser();
  const { logout } = useAuth();
  const navigate = useNavigate();
  return (
    <Menu
      header={
        <span className="user-menu-header">
          <b>{user.name}</b>
          <small>{user.email}</small>
        </span>
      }
      trigger={({ toggle, ref, open }) => (
        <button type="button" ref={ref} className="avatar-button" aria-label="Account menu" aria-haspopup="menu" aria-expanded={open} onClick={toggle}>
          <Avatar name={user.name} color={user.avatar_color} size="md" />
        </button>
      )}
      items={[
        { label: 'Profile', icon: <User />, onSelect: () => navigate('/settings/profile') },
        { label: 'Preferences', icon: <Settings />, onSelect: () => navigate('/settings/preferences') },
        'separator',
        { label: 'Sign out', icon: <LogOut />, danger: true, onSelect: () => void logout().then(() => navigate('/login')) },
      ]}
    />
  );
}

export function AppShell() {
  const user = useUser();
  const workspace = useWorkspace();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [lastPath, setLastPath] = useState(location.pathname);
  if (lastPath !== location.pathname) {
    // Close the mobile menu after navigating.
    setLastPath(location.pathname);
    setMenuOpen(false);
  }

  useEffect(() => {
    const root = document.documentElement;
    const dark = user.theme === 'dark' || (user.theme === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
    root.dataset.theme = dark ? 'dark' : 'light';
    root.dataset.motion = user.reduced_motion ? 'reduced' : 'full';
  }, [user.theme, user.reduced_motion]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="shell">
      <aside className={menuOpen ? 'sidebar open' : 'sidebar'} aria-label="Sidebar">
        <Link to="/" className="brand">
          <Cpu />
          <span>
            Learn<b>Loop</b>
          </span>
        </Link>
        <WorkspaceSwitcher />
        <nav className="side-nav" aria-label="Main">
          <NavGroup items={PRIMARY_NAV} />
          <NavGroup title="Insights" items={INSIGHT_NAV} />
          <NavGroup title={workspace.name} items={WORKSPACE_NAV} />
        </nav>
        <div className="sidebar-foot">
          <span className="role-chip">{ROLE_LABELS[workspace.role]}</span>
          <span className="muted">Signed in as {user.name.split(' ')[0]}</span>
        </div>
      </aside>
      <div className="shell-main">
        <header className="topbar">
          <button type="button" className="icon-only mobile-only" aria-label={menuOpen ? 'Close menu' : 'Open menu'} onClick={() => setMenuOpen(!menuOpen)}>
            {menuOpen ? <X /> : <MenuIcon />}
          </button>
          <Link to="/" className="brand mobile-only">
            <Cpu />
            <span>
              Learn<b>Loop</b>
            </span>
          </Link>
          <button type="button" className="search-trigger" onClick={() => setPaletteOpen(true)}>
            <Search />
            <span>Search courses, notes, tasks…</span>
            <kbd>Ctrl K</kbd>
          </button>
          <div className="topbar-actions">
            <NotificationBell />
            <UserMenu />
          </div>
        </header>
        <main className="content" id="main">
          <Outlet />
        </main>
      </div>
      {menuOpen && <div className="scrim" onClick={() => setMenuOpen(false)} />}
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
    </div>
  );
}
