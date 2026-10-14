import { Agent, ProxyAgent, fetch as undiciFetch, type Dispatcher } from 'undici';

/** Thrown for any non-success response from a broker API. `message` is safe to show to the user. */
export class BrokerApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly brokerCode?: string,
  ) {
    super(message);
    this.name = 'BrokerApiError';
  }
}

const dispatchers = new Map<string, Dispatcher>();

/**
 * Shared keep-alive agent for direct (non-proxied) broker calls. Sockets + TLS sessions stay open between
 * orders, so a copy order never pays for a fresh TCP/TLS handshake.
 */
const directAgent = new Agent({
  keepAliveTimeout: 60_000,
  keepAliveMaxTimeout: 10 * 60_000,
  connections: 128,
  pipelining: 1,
  connect: { timeout: 5_000 },
});

/** One keep-alive ProxyAgent per proxy URL (keeps connections pooled). */
function dispatcherFor(proxyUrl?: string): Dispatcher {
  if (!proxyUrl) return directAgent;
  let d = dispatchers.get(proxyUrl);
  if (!d) {
    d = new ProxyAgent({ uri: proxyUrl, keepAliveTimeout: 60_000, keepAliveMaxTimeout: 10 * 60_000, connections: 128 });
    dispatchers.set(proxyUrl, d);
  }
  return d;
}

/**
 * Opens / refreshes pooled connections to a broker host so the first real order is already warm.
 * Errors are ignored (any HTTP response, even 4xx, means the socket is established).
 */
export async function warmConnection(origin: string, proxyUrl?: string): Promise<void> {
  try {
    const res = await undiciFetch(origin, { method: 'GET', dispatcher: dispatcherFor(proxyUrl), signal: AbortSignal.timeout(5_000) });
    await res.arrayBuffer().catch(() => undefined);
  } catch {
    /* ignore */
  }
}

/** True for failures where the order surely did not reach the broker, or the broker asked us to retry. */
export function isRetryable(err: unknown): boolean {
  if (!(err instanceof BrokerApiError)) return false;
  if (err.status === 429 || err.status === 502 || err.status === 503) return true;
  // Connection refused / reset before a response — "Could not reach broker (ECONNREFUSED)". Timeouts are NOT
  // retried: the order may already be live at the broker.
  return err.status === undefined && /ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|UND_ERR_SOCKET|UND_ERR_CONNECT/.test(err.message);
}

export interface BrokerRequest {
  method?: 'GET' | 'POST' | 'DELETE' | 'PUT';
  headers?: Record<string, string>;
  body?: string;
  /** Static-IP egress proxy; requests go direct when undefined. */
  proxyUrl?: string;
  timeoutMs?: number;
}

/** Minimal JSON HTTP client for broker REST APIs, optionally routed through a static-IP proxy. */
export async function brokerFetch<T = unknown>(url: string, req: BrokerRequest = {}): Promise<{ status: number; body: T }> {
  let res;
  try {
    res = await undiciFetch(url, {
      method: req.method ?? 'GET',
      headers: req.headers,
      body: req.body,
      dispatcher: dispatcherFor(req.proxyUrl),
      signal: AbortSignal.timeout(req.timeoutMs ?? 15_000),
    });
  } catch (err) {
    if ((err as Error).name === 'TimeoutError') throw new BrokerApiError('Broker did not respond in time (timeout).');
    // Never include the proxy URL (it carries credentials) in the message.
    const cause = (err as { cause?: { code?: string; message?: string } }).cause;
    const detail = cause?.code ?? cause?.message?.replace(/\/\/[^@\s]*@/g, '//***@').slice(0, 120) ?? (err as Error).name;
    throw new BrokerApiError(`Could not reach broker (${detail}).`);
  }
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // Angel One answers rate-limit breaches with a plain-text HTTP 403 "Access denied because of exceeding access rate".
    if (/exceeding access rate/i.test(text)) {
      throw new BrokerApiError('Broker rate limit hit (exceeding access rate) — retry shortly.', res.status, 'RATE_LIMIT');
    }
    const snippet = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
    throw new BrokerApiError(`Broker returned a non-JSON response (HTTP ${res.status})${snippet ? `: ${snippet}` : ''}.`, res.status);
  }
  return { status: res.status, body: body as T };
}

/** Next occurrence of HH:MM in India Standard Time (UTC+05:30), returned as a UTC Date. */
export function nextIstTime(hour: number, minute = 0, now = new Date()): Date {
  const IST_OFFSET_MS = 330 * 60_000;
  const istNow = new Date(now.getTime() + IST_OFFSET_MS);
  const target = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate(), hour, minute));
  if (target.getTime() <= istNow.getTime()) target.setUTCDate(target.getUTCDate() + 1);
  return new Date(target.getTime() - IST_OFFSET_MS);
}
