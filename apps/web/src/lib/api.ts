import type { ApiErrorBody } from '@ctp/types';

/**
 * Browser API client. All calls go to same-origin /api/* (proxied to the NestJS API by Next.js),
 * so the httpOnly auth cookies are attached automatically and never touched by JavaScript.
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: ApiErrorBody & { code?: string },
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const NO_REFRESH = ['/auth/login', '/auth/register', '/auth/refresh', '/auth/logout'];

let refreshing: Promise<boolean> | null = null;

/** Single-flight token refresh shared by all concurrent requests in this tab. */
function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'X-CTP-Client': 'web' },
      });
      if (res.ok) return true;
      // Another tab rotated the token at the same moment — its new cookies are already set.
      const body = (await res.json().catch(() => null)) as { code?: string; message?: string } | null;
      return body?.message === 'Session refreshed concurrently';
    } catch {
      return false;
    } finally {
      setTimeout(() => {
        refreshing = null;
      }, 0);
    }
  })();
  return refreshing;
}

function messageOf(body: unknown, fallback: string): string {
  const m = (body as ApiErrorBody | null)?.message;
  if (Array.isArray(m)) return m.join('. ');
  return typeof m === 'string' && m ? m : fallback;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | undefined | null>;
  signal?: AbortSignal;
}

export async function api<T>(path: string, options: RequestOptions = {}, retried = false): Promise<T> {
  const qs = options.query
    ? new URLSearchParams(
        Object.entries(options.query)
          .filter(([, v]) => v !== undefined && v !== null && v !== '')
          .map(([k, v]) => [k, String(v)]),
      ).toString()
    : '';
  const url = `/api${path}${qs ? `?${qs}` : ''}`;

  const res = await fetch(url, {
    method: options.method ?? 'GET',
    credentials: 'same-origin',
    headers: {
      'X-CTP-Client': 'web',
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  });

  if (res.status === 401 && !retried && !NO_REFRESH.includes(path)) {
    if (await refreshSession()) return api<T>(path, options, true);
  }

  if (res.status === 204) return undefined as T;

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, messageOf(body, `Request failed (${res.status})`), body ?? undefined);
  }
  return body as T;
}
