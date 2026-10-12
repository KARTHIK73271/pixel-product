import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { LoginInput, Role } from '@shared/schemas';
import { api } from './api';

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  studentId: string | null;
}

interface AuthState {
  user: SessionUser | null;
  loading: boolean;
  /** True after the server rejected a previously valid session (expired / revoked / disabled). */
  sessionExpired: boolean;
  login: (input: LoginInput) => Promise<SessionUser>;
  /** Full-page redirect into the server-side Google OAuth flow. */
  loginWithGoogle: (returnTo?: string) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);
const CHANNEL = 'exam-auth';

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [sessionExpired, setSessionExpired] = useState(false);
  const me = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: async () => (await api.get<{ user: SessionUser | null }>('/auth/me')).user,
    staleTime: Infinity,
    retry: false,
  });
  const signedIn = useRef(false);
  signedIn.current = !!me.data;

  // Drop every cached record from the previous identity, but keep the session query itself so the
  // AuthProvider's observer stays attached (clearing it would orphan the observer and lose the user).
  const resetDataCache = useCallback(() => qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'auth' }), [qc]);

  useEffect(() => {
    const onExpired = () => {
      if (signedIn.current) setSessionExpired(true);
      resetDataCache();
      qc.setQueryData(['auth', 'me'], null);
    };
    window.addEventListener('auth:expired', onExpired);
    // Signing out in one tab signs out every tab.
    const channel = 'BroadcastChannel' in window ? new BroadcastChannel(CHANNEL) : null;
    if (channel)
      channel.onmessage = (e) => {
        if (e.data === 'logout') {
          resetDataCache();
          qc.setQueryData(['auth', 'me'], null);
        }
      };
    return () => {
      window.removeEventListener('auth:expired', onExpired);
      channel?.close();
    };
  }, [qc, resetDataCache]);

  const login = useCallback(
    async (input: LoginInput) => {
      const { user } = await api.post<{ user: SessionUser }>('/auth/login', input);
      resetDataCache();
      setSessionExpired(false);
      qc.setQueryData(['auth', 'me'], user);
      return user;
    },
    [qc, resetDataCache],
  );

  const loginWithGoogle = useCallback((returnTo?: string) => {
    const qs = returnTo ? `?${new URLSearchParams({ returnTo })}` : '';
    window.location.assign(`/api/auth/google/start${qs}`);
  }, []);

  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => undefined);
    resetDataCache();
    setSessionExpired(false);
    qc.setQueryData(['auth', 'me'], null);
    if ('BroadcastChannel' in window) {
      const c = new BroadcastChannel(CHANNEL);
      c.postMessage('logout');
      c.close();
    }
  }, [qc, resetDataCache]);

  const value = useMemo(
    () => ({ user: me.data ?? null, loading: me.isLoading, sessionExpired, login, loginWithGoogle, logout }),
    [me.data, me.isLoading, sessionExpired, login, loginWithGoogle, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

export const homeFor = (role: Role) => (role === 'ADMIN' ? '/dashboard' : role === 'INCHARGE' ? '/duties' : '/my');
