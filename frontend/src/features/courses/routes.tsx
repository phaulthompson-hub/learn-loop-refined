import { Route } from 'react-router-dom';
import { CatalogPage } from './CatalogPage';
import { CourseLayout } from './CourseLayout';
import { LearnersPage } from './LearnersPage';
import { NewCoursePage } from './NewCoursePage';
import { OverviewPage } from './OverviewPage';
import { QuizPage } from './QuizPage';
import { SettingsPage } from './SettingsPage';
import { SourceViewPage } from './SourceViewPage';
import { SourcesPage } from './SourcesPage';
import { TutorPage } from './TutorPage';
import './courses.css';

/** Routes rendered inside the signed-in app shell. */
export const courseRoutes = (
  <>
    <Route path="courses" element={<CatalogPage />} />
    <Route path="courses/new" element={<NewCoursePage />} />
    <Route path="courses/:courseId" element={<CourseLayout />}>
      <Route index element={<OverviewPage />} />
      <Route path="quiz" element={<QuizPage />} />
      <Route path="tutor" element={<TutorPage />} />
      <Route path="sources" element={<SourcesPage />} />
      <Route path="sources/:sourceId" element={<SourceViewPage />} />
      <Route path="learners" element={<LearnersPage />} />
      <Route path="settings" element={<SettingsPage />} />
    </Route>
  </>
);
