/**
 * Typed API fetch helper for v2.0 pages.
 * Returns a standard Response object so pages can call .json(), .ok, etc.
 */
import { getAuthToken } from './auth-storage';

const BASE = import.meta.env.BASE_URL || '/';

export async function apiFetch(path: string, opts?: RequestInit): Promise<Response> {
  const token = getAuthToken();
  return fetch(`${BASE}api${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts?.headers ?? {}),
    },
  });
}

export async function apiGet<T = unknown>(path: string): Promise<T> {
  const r = await apiFetch(path);
  if (!r.ok) throw new Error((await r.json() as { error?: string }).error || 'Request failed');
  return r.json() as Promise<T>;
}

export async function apiPost<T = unknown>(path: string, body?: unknown): Promise<T> {
  const r = await apiFetch(path, { method: 'POST', body: body !== undefined ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error((await r.json() as { error?: string }).error || 'Request failed');
  return r.json() as Promise<T>;
}

export async function apiPatch<T = unknown>(path: string, body?: unknown): Promise<T> {
  const r = await apiFetch(path, { method: 'PATCH', body: body !== undefined ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error((await r.json() as { error?: string }).error || 'Request failed');
  return r.json() as Promise<T>;
}

export async function apiDelete(path: string): Promise<void> {
  const r = await apiFetch(path, { method: 'DELETE' });
  if (!r.ok) throw new Error((await r.json() as { error?: string }).error || 'Request failed');
}
