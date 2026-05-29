const AUTH_TOKEN_KEY = 'token';

function migrateLegacySessionToken(): string | null {
  if (typeof window === 'undefined') return null;
  const localToken = window.localStorage.getItem(AUTH_TOKEN_KEY);
  if (localToken) return localToken;

  const sessionToken = window.sessionStorage.getItem(AUTH_TOKEN_KEY);
  if (!sessionToken) return null;

  window.localStorage.setItem(AUTH_TOKEN_KEY, sessionToken);
  window.sessionStorage.removeItem(AUTH_TOKEN_KEY);
  return sessionToken;
}

export function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(AUTH_TOKEN_KEY) || migrateLegacySessionToken();
}

export function setAuthToken(token: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(AUTH_TOKEN_KEY, token);
  window.sessionStorage.removeItem(AUTH_TOKEN_KEY);
}

export function clearAuthToken(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(AUTH_TOKEN_KEY);
  window.sessionStorage.removeItem(AUTH_TOKEN_KEY);
}
