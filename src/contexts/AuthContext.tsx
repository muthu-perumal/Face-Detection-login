import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { PublicUser } from '@shared/types';
import { api, getToken, setToken } from '@/lib/api';

type AuthContextValue = {
  user: PublicUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<PublicUser>;
  acceptSession: (token: string, user: PublicUser) => void;
  signOut: () => Promise<void>;
  setUser: (user: PublicUser | null) => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getToken()) {
      setLoading(false);
      return;
    }
    api<{ user: PublicUser }>('/auth/me')
      .then((result) => setUser(result.user))
      .catch(() => {
        setToken(null);
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      setUser,
      async signIn(email, password) {
        const result = await api<{ token: string; user: PublicUser }>('/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, password }),
        });
        setToken(result.token);
        setUser(result.user);
        return result.user;
      },
      acceptSession(token, nextUser) {
        setToken(token);
        setUser(nextUser);
      },
      async signOut() {
        try {
          await api('/auth/logout', { method: 'POST' });
        } finally {
          setToken(null);
          setUser(null);
        }
      },
    }),
    [user, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used within AuthProvider');
  return value;
}
