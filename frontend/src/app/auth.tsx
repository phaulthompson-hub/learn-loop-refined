import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { http, onUnauthorized } from '../lib/http';
import { getToken, setToken } from '../lib/storage';
import { roleAtLeast } from './roles';
import type { Me, Role, User, WorkspaceBrief } from './types';

type RegisterInput = { name: string; email: string; password: string; workspace_name?: string; invitation_token?: string };

type AuthState = {
  status: 'loading' | 'signed-out' | 'signed-in';
  me: Me | null;
  login: (email: string, password: string) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
  /** Re-fetch /auth/me (after profile edits, joining a workspace, reading notifications…). */
  refresh: () => Promise<void>;
  /** Patch the cached user without a round trip (e.g. after saving preferences). */
  updateUser: (user: User) => void;
  setUnread: (count: number) => void;
  switchWorkspace: (workspaceId: number) => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [status, setStatus] = useState<AuthState['status']>(() => (getToken() ? 'loading' : 'signed-out'));

  const signOutLocally = useCallback(() => {
    setToken(null);
    setMe(null);
    setStatus('signed-out');
  }, []);

  const refresh = useCallback(async () => {
    if (!getToken()) return signOutLocally();
    try {
      setMe(await http.get<Me>('/auth/me'));
      setStatus('signed-in');
    } catch {
      signOutLocally();
    }
  }, [signOutLocally]);

  useEffect(() => {
    let cancelled = false;
    if (getToken()) {
      // Restore the session from the stored token; a rejected token signs the user out.
      http.get<Me>('/auth/me').then(
        (result) => {
          if (cancelled) return;
          setMe(result);
          setStatus('signed-in');
        },
        () => {
          if (!cancelled) signOutLocally();
        },
      );
    }
    const stop = onUnauthorized(signOutLocally);
    return () => {
      cancelled = true;
      stop();
    };
  }, [signOutLocally]);

  const value = useMemo<AuthState>(
    () => ({
      status,
      me,
      refresh,
      login: async (email, password) => {
        const result = await http.post<Me & { token: string }>('/auth/login', { email, password });
        setToken(result.token);
        setMe(result);
        setStatus('signed-in');
      },
      register: async (input) => {
        const result = await http.post<Me & { token: string }>('/auth/register', input);
        setToken(result.token);
        setMe(result);
        setStatus('signed-in');
      },
      logout: async () => {
        try {
          await http.post('/auth/logout');
        } finally {
          signOutLocally();
        }
      },
      updateUser: (user) => setMe((current) => (current ? { ...current, user } : current)),
      setUnread: (count) => setMe((current) => (current ? { ...current, unread_notifications: count } : current)),
      switchWorkspace: async (workspaceId) => {
        setMe(await http.put<Me>(`/auth/me/workspace/${workspaceId}`));
      },
    }),
    [me, refresh, signOutLocally, status],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}

/** The signed-in user. Only use inside routes rendered for signed-in users. */
export function useUser(): User {
  const { me } = useAuth();
  if (!me) throw new Error('useUser needs a signed-in user');
  return me.user;
}

export type CurrentWorkspace = WorkspaceBrief & { can: (minimum: Role) => boolean };

/** The workspace currently shown in the shell, with a role check helper. */
export function useWorkspace(): CurrentWorkspace {
  const { me } = useAuth();
  const workspace = me?.workspaces.find((w) => w.id === me.current_workspace_id) ?? me?.workspaces[0];
  if (!workspace) throw new Error('useWorkspace needs a workspace');
  return { ...workspace, can: (minimum: Role) => roleAtLeast(workspace.role, minimum) };
}
