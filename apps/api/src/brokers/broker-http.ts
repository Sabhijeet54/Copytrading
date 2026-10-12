import { ProxyAgent, fetch as undiciFetch, type Dispatcher } from 'undici';

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

/** One ProxyAgent per proxy URL (keeps connections pooled). */
function dispatcherFor(proxyUrl?: string): Dispatcher | undefined {
  if (!proxyUrl) return undefined;
  let d = dispatchers.get(proxyUrl);
  if (!d) {
    d = new ProxyAgent({ uri: proxyUrl });
    dispatchers.set(proxyUrl, d);
  }
  return d;
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
    throw new BrokerApiError(`Broker returned a non-JSON response (HTTP ${res.status}).`, res.status);
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
