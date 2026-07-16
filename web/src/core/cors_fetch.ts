// ============================================================
// vibeAgentGo — global CORS fetch helper
// Routes external requests through the app's own proxy so
// generated mini-apps never need third-party CORS workarounds.
// ============================================================

export const PROXY_BASE = '/api/proxy/';

/**
 * Build a proxied URL for an external target.
 * If the target is already same-origin or already a proxy URL, return it unchanged.
 */
export function proxiedUrl(target: string): string {
  try {
    const url = new URL(target, window.location.href);
    if (url.origin === window.location.origin) return target;
    if (url.href.startsWith(window.location.origin + PROXY_BASE)) return target;
    return `${window.location.origin}${PROXY_BASE}?url=${encodeURIComponent(url.href)}`;
  } catch {
    return target;
  }
}

/**
 * Drop-in fetch replacement that automatically uses the app's CORS proxy
 * for cross-origin requests. Keeps same-origin requests untouched.
 */
export function corsFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input.toString();
  return fetch(proxiedUrl(url), init);
}

/** True if the given URL would be routed through the proxy. */
export function isProxiedUrl(url: string): boolean {
  return proxiedUrl(url) !== url;
}

// Expose to generated mini-apps running in the same origin
declare global {
  interface Window {
    corsFetch: typeof corsFetch;
    proxiedUrl: typeof proxiedUrl;
    isProxiedUrl: typeof isProxiedUrl;
  }
}
window.corsFetch = corsFetch;
window.proxiedUrl = proxiedUrl;
window.isProxiedUrl = isProxiedUrl;
