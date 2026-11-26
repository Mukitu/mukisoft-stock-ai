/**
 * Vercel Edge Rewrite + Direct Render FastAPI Backend URL Resolver.
 * - On Vercel production (stock.mukisoft.tech / *.vercel.app) and AI Studio preview (*.run.app),
 *   primary requests use same-origin `/api/...` (proxied at the edge via vercel.json / vite.config.ts
 *   with zero browser CORS preflight overhead).
 * - Automatically provides direct fallback to `https://mukisoft-stock-ai.onrender.com/api/...`
 *   if a custom domain or local environment does not have the edge proxy active.
 */

export const DEFAULT_RENDER_API_BASE_URL = 'https://mukisoft-stock-ai.onrender.com';

const BLOCKED_FRONTEND_HOSTS = new Set([
  'stock.mukisoft.tech',
  'www.stock.mukisoft.tech',
]);

export function resolveBackendApiBaseUrl(rawEnvUrl?: string): string {
  const candidate = String(rawEnvUrl ?? '').trim().replace(/\/+$/, '');
  if (!candidate || candidate === '/') {
    return DEFAULT_RENDER_API_BASE_URL;
  }

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return DEFAULT_RENDER_API_BASE_URL;
    }
    const hostname = parsed.hostname.toLowerCase();
    if (BLOCKED_FRONTEND_HOSTS.has(hostname)) {
      return DEFAULT_RENDER_API_BASE_URL;
    }
    return parsed.origin + parsed.pathname.replace(/\/+$/, '');
  } catch {
    return DEFAULT_RENDER_API_BASE_URL;
  }
}

export const DIRECT_RENDER_API_BASE_URL = resolveBackendApiBaseUrl(
  import.meta.env.VITE_API_BASE_URL
);

function shouldUseSameOriginEdgeProxy(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  const host = window.location.hostname.toLowerCase();
  if (
    host === 'stock.mukisoft.tech' ||
    host === 'www.stock.mukisoft.tech' ||
    host.endsWith('.vercel.app') ||
    host.endsWith('.run.app')
  ) {
    return true;
  }
  return Boolean(import.meta.env.DEV);
}

/**
 * Primary API base URL:
 * - '' (same-origin `/api/...` edge rewrite proxy on Vercel production & AI Studio preview)
 * - Direct Render URL (`https://mukisoft-stock-ai.onrender.com`) on other hosts
 */
export const API_BASE_URL = shouldUseSameOriginEdgeProxy()
  ? ''
  : DIRECT_RENDER_API_BASE_URL;

/**
 * Returns ordered candidate URLs for any `/api/...` path:
 * 1. Same-origin `/api/...` via Vercel Edge Rewrite / Vite proxy (0ms CORS preflight)
 * 2. Direct `https://mukisoft-stock-ai.onrender.com/api/...` fallback
 */
export function getApiCandidateUrls(apiPath: string): string[] {
  const normalizedPath = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
  const primary = `${API_BASE_URL}${normalizedPath}`;
  const direct = `${DIRECT_RENDER_API_BASE_URL}${normalizedPath}`;
  return primary === direct ? [direct] : [primary, direct];
}

export const getCandidateApiUrls = getApiCandidateUrls;
