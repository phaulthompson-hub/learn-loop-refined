import type { ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './app/auth';
import { ClockProvider } from './app/clock';
import { ToastProvider } from './app/toast';
import { Loading } from './components/ui';
import { adminPublicRoutes } from './features/admin/publicRoutes';
import { adminRoutes } from './features/admin/routes';
import { LoginPage } from './features/auth/LoginPage';
import { RegisterPage } from './features/auth/RegisterPage';
import { boardRoutes } from './features/board/routes';
import { courseRoutes } from './features/courses/routes';
import { flashcardRoutes } from './features/flashcards/routes';
import { HomePage } from './features/home/HomePage';
import { homeRoutes } from './features/home/routes';
import { noteRoutes } from './features/notes/routes';
import { plannerRoutes } from './features/planner/routes';
import { searchRoutes } from './features/search/routes';
import { AppShell } from './shell/AppShell';
import { NoWorkspacePage } from './shell/NoWorkspacePage';
import { NotFoundPage } from './shell/NotFoundPage';

function RequireAuth({ children }: { children: ReactNode }) {
  const { status, me } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <Loading label="Opening LearnLoop…" />;
  if (status === 'signed-out') return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (!me?.workspaces.length) return <NoWorkspacePage />;
  return <>{children}</>;
}

function GuestOnly({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  if (status === 'loading') return <Loading label="Opening LearnLoop…" />;
  if (status === 'signed-in') return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <ClockProvider>
          <AuthProvider>
            <Routes>
              <Route path="login" element={<GuestOnly><LoginPage /></GuestOnly>} />
              <Route path="register" element={<GuestOnly><RegisterPage /></GuestOnly>} />
              {adminPublicRoutes}
              <Route element={<RequireAuth><AppShell /></RequireAuth>}>
                <Route index element={<HomePage />} />
                {courseRoutes}
                {flashcardRoutes}
                {plannerRoutes}
                {boardRoutes}
                {noteRoutes}
                {searchRoutes}
                {homeRoutes}
                {adminRoutes}
                <Route path="*" element={<NotFoundPage />} />
              </Route>
            </Routes>
          </AuthProvider>
        </ClockProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
