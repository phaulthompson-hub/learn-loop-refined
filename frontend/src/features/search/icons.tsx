import {
  Activity,
  BarChart3,
  BookOpen,
  CalendarDays,
  FilePlus2,
  GraduationCap,
  Home,
  Trello,
  Layers,
  Lightbulb,
  ListPlus,
  FileEdit,
  Search,
  Settings,
  CheckSquare,
  Target,
  Users,
  type Icon as LucideIcon,
} from 'lucide-react';
import type { CommandIcon } from './commands';
import type { SearchType } from './types';

export const COMMAND_ICONS: Record<CommandIcon, LucideIcon> = {
  home: Home,
  courses: BookOpen,
  review: Layers,
  planner: CalendarDays,
  board: Trello,
  notes: FileEdit,
  analytics: BarChart3,
  goals: Target,
  activity: Activity,
  members: Users,
  settings: Settings,
  'new-note': FilePlus2,
  'new-task': ListPlus,
  search: Search,
};

export const TYPE_ICONS: Record<SearchType, LucideIcon> = {
  course: GraduationCap,
  concept: Lightbulb,
  note: FileEdit,
  task: CheckSquare,
  card: Layers,
  event: CalendarDays,
};
