import React, { createContext, useContext, useState, useEffect } from 'react';
import { getGetMeQueryKey, useGetMe, User } from '@workspace/api-client-react';
import { setAuthTokenGetter, setBaseUrl } from '@workspace/api-client-react/custom-fetch';
import { useQueryClient } from '@tanstack/react-query';
import { clearAuthToken, getAuthToken, setAuthToken } from './auth-storage';

const AUTH_MESSAGE_KEY = 'epicpoetry.authMessage';

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  token: string | null;
  login: (token: string, user: User) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(getAuthToken());
  const [sessionUser, setSessionUser] = useState<User | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    const apiBase = import.meta.env.VITE_API_BASE_URL?.trim();
    setBaseUrl(apiBase && !window.location.hostname.includes('replit') ? apiBase : null);
    setAuthTokenGetter(() => getAuthToken());
  }, []);

  const { data: user, isLoading, refetch } = useGetMe({
    query: {
      enabled: !!token,
      retry: false,
    },
  });

  useEffect(() => {
    if (user) {
      setSessionUser(user);
    }
  }, [user]);

  useEffect(() => {
    if (!token) {
      setSessionUser(null);
    }
  }, [token]);

  useEffect(() => {
    const onAuthExpired = (event: Event) => {
      const detail = (event as CustomEvent<{ status?: number; data?: { reason?: string; error?: string } }>).detail;
      const message = detail?.data?.error || 'Your session ended. Please sign in again.';
      try {
        window.sessionStorage.setItem(AUTH_MESSAGE_KEY, message);
      } catch {}
      clearAuthToken();
      setSessionUser(null);
      setToken(null);
      queryClient.clear();
    };

    window.addEventListener('epicpoetry:auth-expired', onAuthExpired as EventListener);
    return () => window.removeEventListener('epicpoetry:auth-expired', onAuthExpired as EventListener);
  }, [queryClient]);

  const login = (newToken: string, newUser: User) => {
    setAuthToken(newToken);
    setSessionUser(newUser);
    queryClient.setQueryData(getGetMeQueryKey(), newUser);
    setToken(newToken);
    void refetch();
  };

  const logout = () => {
    clearAuthToken();
    setSessionUser(null);
    setToken(null);
    queryClient.clear();
  };

  const effectiveUser = token ? (sessionUser || user || null) : null;

  return (
    <AuthContext.Provider value={{ user: effectiveUser, isLoading: token ? isLoading : false, token, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}


