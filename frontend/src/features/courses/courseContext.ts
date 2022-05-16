import { useOutletContext } from 'react-router-dom';
import type { Role } from '../../app/types';
import type { Course } from './types';

/** What the course layout shares with its tabs through `<Outlet context>`. */
export type CourseContext = {
  course: Course;
  /** Refetch the course (e.g. after answers changed the learner's mastery). */
  reload: () => void;
  /** Swap in a course returned by a mutation, without refetching. */
  replace: (course: Course) => void;
  role: Role | null;
  canEdit: boolean;
  canDelete: boolean;
};

export const useCourse = () => useOutletContext<CourseContext>();
