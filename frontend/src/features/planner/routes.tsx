import { Route } from 'react-router-dom';
import { GoalsPage } from './GoalsPage';
import { PlannerPage } from './PlannerPage';

/** Routes rendered inside the signed-in app shell. */
export const plannerRoutes = (
  <>
    <Route path="planner" element={<PlannerPage />} />
    <Route path="goals" element={<GoalsPage />} />
  </>
);
