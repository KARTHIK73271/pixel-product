import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
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
  login: (input: LoginInput) => Promise<SessionUser>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const me = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: async () => (await api.get<{ user: SessionUser | null }>('/auth/me')).user,
    staleTime: Infinity,
    retry: false,
  });

  useEffect(() => {
    const onExpired = () => {
      qc.setQueryData(['auth', 'me'], null);
    };
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, [qc]);

  // Drop every cached record from the previous identity, but keep the session query itself so the
  // AuthProvider's observer stays attached (clearing it would orphan the observer and lose the user).
  const resetDataCache = useCallback(() => qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'auth' }), [qc]);

  const login = useCallback(
    async (input: LoginInput) => {
      const { user } = await api.post<{ user: SessionUser }>('/auth/login', input);
      resetDataCache();
      qc.setQueryData(['auth', 'me'], user);
      return user;
    },
    [qc, resetDataCache],
  );

  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => undefined);
    resetDataCache();
    qc.setQueryData(['auth', 'me'], null);
  }, [qc, resetDataCache]);

  const value = useMemo(
    () => ({ user: me.data ?? null, loading: me.isLoading, login, logout }),
    [me.data, me.isLoading, login, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

export const homeFor = (role: Role) => (role === 'ADMIN' ? '/dashboard' : role === 'INCHARGE' ? '/duties' : '/my');
