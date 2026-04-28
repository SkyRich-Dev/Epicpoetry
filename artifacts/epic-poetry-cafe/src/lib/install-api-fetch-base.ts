const apiBase = import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/+$/, "") || "";
const basePath = (import.meta.env.BASE_URL || "/").replace(/\/+$/, "");

function shouldUseConfiguredBase() {
  return Boolean(apiBase) && !window.location.hostname.includes("replit");
}

function rewriteApiUrl(url: string): string {
  if (!shouldUseConfiguredBase()) return url;
  if (/^[a-z]+:/i.test(url)) return url;

  if (url.startsWith("/api/")) {
    return `${apiBase}${url}`;
  }

  if (url.startsWith("api/")) {
    return `${apiBase}/${url}`;
  }

  if (basePath && basePath !== "/" && url.startsWith(`${basePath}/api/`)) {
    return `${apiBase}${url.slice(basePath.length)}`;
  }

  return url;
}

export function installApiFetchBase() {
  if (typeof window === "undefined" || typeof window.fetch !== "function") return;
  if ((window as any).__platrApiFetchBaseInstalled) return;

  const nativeFetch = window.fetch.bind(window);

  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === "string") {
      return nativeFetch(rewriteApiUrl(input), init);
    }

    if (input instanceof URL) {
      const rewritten = rewriteApiUrl(input.toString());
      return nativeFetch(rewritten === input.toString() ? input : new URL(rewritten), init);
    }

    const rewritten = rewriteApiUrl(input.url);
    if (rewritten === input.url) {
      return nativeFetch(input, init);
    }

    return nativeFetch(new Request(rewritten, input), init);
  }) as typeof window.fetch;

  (window as any).__platrApiFetchBaseInstalled = true;
}
