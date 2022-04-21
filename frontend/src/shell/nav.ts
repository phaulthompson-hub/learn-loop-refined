import {
  Activity,
  BarChart3,
  BookOpen,
  CalendarDays,
  Home,
  Trello,
  Layers,
  FileEdit,
  Settings,
  Target,
  Users,
  type Icon as LucideIcon,
} from 'lucide-react';

export type NavItem = { to: string; label: string; icon: LucideIcon; end?: boolean };

export const PRIMARY_NAV: NavItem[] = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/courses', label: 'Courses', icon: BookOpen },
  { to: '/review', label: 'Review', icon: Layers },
  { to: '/planner', label: 'Planner', icon: CalendarDays },
  { to: '/board', label: 'Board', icon: Trello },
  { to: '/notes', label: 'Notes', icon: FileEdit },
];

export const INSIGHT_NAV: NavItem[] = [
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/goals', label: 'Goals', icon: Target },
  { to: '/activity', label: 'Activity', icon: Activity },
];

export const WORKSPACE_NAV: NavItem[] = [
  { to: '/members', label: 'Members', icon: Users },
  { to: '/settings', label: 'Settings', icon: Settings },
];
