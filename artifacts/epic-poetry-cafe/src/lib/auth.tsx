import React, { createContext, useContext, useState, useEffect } from 'react';
import { getGetMeQueryKey, useGetMe, User } from '@workspace/api-client-react';
import { setAuthTokenGetter, setBaseUrl } from '@workspace/api-client-react/custom-fetch';
import { useQueryClient } from '@tanstack/react-query';

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  token: string | null;
  login: (token: string, user: User) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
  const [sessionUser, setSessionUser] = useState<User | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    const apiBase = import.meta.env.VITE_API_BASE_URL?.trim();
    setBaseUrl(apiBase && !window.location.hostname.includes('replit') ? apiBase : null);
    setAuthTokenGetter(() => localStorage.getItem('token'));
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

  const login = (newToken: string, newUser: User) => {
    localStorage.setItem('token', newToken);
    setSessionUser(newUser);
    queryClient.setQueryData(getGetMeQueryKey(), newUser);
    setToken(newToken);
    void refetch();
  };

  const logout = () => {
    localStorage.removeItem('token');
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
