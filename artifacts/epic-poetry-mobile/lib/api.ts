import AsyncStorage from "@react-native-async-storage/async-storage";

const DOMAIN = process.env.EXPO_PUBLIC_DOMAIN;
const BASE_URL = DOMAIN ? `https://${DOMAIN}/api` : "/api";
const APP_ORIGIN = DOMAIN ? `https://${DOMAIN}` : undefined;

export const TOKEN_KEY = "epc:auth-token";

let cachedToken: string | null = null;

export async function getToken(): Promise<string | null> {
  if (cachedToken) return cachedToken;
  try {
    const t = await AsyncStorage.getItem(TOKEN_KEY);
    cachedToken = t;
    return t;
  } catch {
    return null;
  }
}

export async function setToken(token: string | null): Promise<void> {
  cachedToken = token;
  if (token) await AsyncStorage.setItem(TOKEN_KEY, token);
  else await AsyncStorage.removeItem(TOKEN_KEY);
}

type UnauthorizedHandler = () => void | Promise<void>;
let unauthorizedHandler: UnauthorizedHandler | null = null;
export function setUnauthorizedHandler(fn: UnauthorizedHandler | null): void {
  unauthorizedHandler = fn;
}

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export async function apiFetch<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = await getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    // Some production gateways/WAF rules require this on app-originated POSTs.
    "X-Requested-With": "XMLHttpRequest",
    ...((options.headers as Record<string, string>) ?? {}),
  };
  if (APP_ORIGIN) {
    headers["Origin"] = APP_ORIGIN;
    headers["Referer"] = `${APP_ORIGIN}/`;
  }
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, { ...options, headers });

  if (res.status === 204) return undefined as T;

  let body: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!res.ok) {
    const msg =
      (body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : null) ??
      (typeof body === "string" ? body : `Request failed (${res.status})`);
    if (res.status === 401 && path !== "/auth/login") {
      await setToken(null);
      if (unauthorizedHandler) {
        try {
          await unauthorizedHandler();
        } catch {
          // ignore handler errors
        }
      }
    }
    throw new ApiError(res.status, msg, body);
  }
  return body as T;
}

export const api = {
  get: <T>(path: string) => apiFetch<T>(path),
  post: <T>(path: string, data: unknown) =>
    apiFetch<T>(path, { method: "POST", body: JSON.stringify(data) }),
  patch: <T>(path: string, data: unknown) =>
    apiFetch<T>(path, { method: "PATCH", body: JSON.stringify(data) }),
  put: <T>(path: string, data: unknown) =>
    apiFetch<T>(path, { method: "PUT", body: JSON.stringify(data) }),
  del: <T>(path: string) => apiFetch<T>(path, { method: "DELETE" }),
};
