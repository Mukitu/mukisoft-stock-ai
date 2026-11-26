/**
 * Direct Render FastAPI Backend URL Resolver.
 * - On Vercel production (stock.mukisoft.tech / www.stock.mukisoft.tech / *.vercel.app),
 *   ALL API requests go directly to `https://mukisoft-stock-ai.onrender.com/api/...` with
 *   full 35s timeout (bypassing Vercel Hobby's 10s edge rewrite cap and SPA HTML fallback).
 * - In local Vite dev / AI Studio preview (*.run.app), uses Vite's same-origin `/api/...`
 *   proxy first with automatic fallback to `https://mukisoft-stock-ai.onrender.com/api/...`.
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

function shouldUseLocalDevProxy(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  const host = window.location.hostname.toLowerCase();
  if (
    host === 'stock.mukisoft.tech' ||
    host === 'www.stock.mukisoft.tech' ||
    host.endsWith('.vercel.app')
  ) {
    return false;
  }
  if (host.endsWith('.run.app')) {
    return true;
  }
  return Boolean(import.meta.env.DEV);
}

/**
 * Primary API base URL:
 * - `https://mukisoft-stock-ai.onrender.com` directly on Vercel production (stock.mukisoft.tech)
 * - `''` (same-origin Vite proxy `/api/...`) in local dev & AI Studio preview
 */
export const API_BASE_URL = shouldUseLocalDevProxy()
  ? ''
  : DIRECT_RENDER_API_BASE_URL;

/**
 * Returns ordered candidate URLs for any `/api/...` path:
 * - On Vercel production (`stock.mukisoft.tech`): `[https://mukisoft-stock-ai.onrender.com/api/...]`
 * - On local dev / AI Studio preview: `[/api/..., https://mukisoft-stock-ai.onrender.com/api/...]`
 */
export function getApiCandidateUrls(apiPath: string): string[] {
  const normalizedPath = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
  const direct = `${DIRECT_RENDER_API_BASE_URL}${normalizedPath}`;
  if (!API_BASE_URL) {
    return [normalizedPath, direct];
  }
  const primary = `${API_BASE_URL}${normalizedPath}`;
  return primary === direct ? [direct] : [primary, direct];
}

export const getCandidateApiUrls = getApiCandidateUrls;
