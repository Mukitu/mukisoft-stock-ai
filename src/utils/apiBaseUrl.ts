/**
 * Hard-guaranteed Render FastAPI backend base URL resolver.
 * Prevents accidental fallback to the Vercel frontend origin (stock.mukisoft.tech)
 * if VITE_API_BASE_URL is blank, "/", whitespace, or misconfigured.
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

export const API_BASE_URL = resolveBackendApiBaseUrl(import.meta.env.VITE_API_BASE_URL);
