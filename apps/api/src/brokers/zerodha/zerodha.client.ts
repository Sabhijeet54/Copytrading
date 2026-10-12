import { createHash } from 'node:crypto';
import { BrokerApiError, brokerFetch, nextIstTime } from '../broker-http';

const LOGIN_URL = 'https://kite.zerodha.com/connect/login';
const API_ROOT = 'https://api.kite.trade';

export interface ZerodhaConfig {
  apiKey: string;
  apiSecret: string;
  proxyUrl?: string;
}

export interface ZerodhaSession {
  userId: string;
  userName?: string;
  accessToken: string;
  refreshToken?: string;
  publicToken?: string;
  expiresAt: Date;
}

interface KiteEnvelope<T> {
  status: 'success' | 'error';
  data?: T;
  message?: string;
  error_type?: string;
}

/**
 * Kite Connect v3 login:
 *  1. Send the user to kite.zerodha.com/connect/login?v=3&api_key=…  (we pass our CSRF `state` via redirect_params)
 *  2. Kite redirects to the registered redirect URL with ?request_token=…&status=success&state=…
 *  3. Exchange request_token for an access_token: POST /session/token with checksum = sha256(api_key + request_token + api_secret)
 * Access tokens are invalidated daily at ~06:00 IST, so the user must log in once every trading day.
 */
export class ZerodhaClient {
  constructor(private readonly cfg: ZerodhaConfig) {}

  loginUrl(state: string): string {
    const params = new URLSearchParams({
      v: '3',
      api_key: this.cfg.apiKey,
      redirect_params: new URLSearchParams({ state }).toString(),
    });
    return `${LOGIN_URL}?${params.toString()}`;
  }

  private headers(accessToken?: string): Record<string, string> {
    return {
      'X-Kite-Version': '3',
      ...(accessToken ? { Authorization: `token ${this.cfg.apiKey}:${accessToken}` } : {}),
    };
  }

  async createSession(requestToken: string): Promise<ZerodhaSession> {
    const checksum = createHash('sha256').update(this.cfg.apiKey + requestToken + this.cfg.apiSecret).digest('hex');
    const { status, body } = await brokerFetch<KiteEnvelope<Record<string, string>>>(`${API_ROOT}/session/token`, {
      method: 'POST',
      headers: { ...this.headers(), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ api_key: this.cfg.apiKey, request_token: requestToken, checksum }).toString(),
      proxyUrl: this.cfg.proxyUrl,
    });
    if (status !== 200 || body?.status !== 'success' || !body.data?.access_token) {
      throw new BrokerApiError(body?.message ?? `Zerodha login failed (HTTP ${status}).`, status, body?.error_type);
    }
    const d = body.data;
    return {
      userId: d.user_id!,
      userName: d.user_name,
      accessToken: d.access_token!,
      refreshToken: d.refresh_token || undefined,
      publicToken: d.public_token || undefined,
      expiresAt: nextIstTime(6, 0),
    };
  }

  /** Invalidates the access token at Kite. Best effort. */
  async logout(accessToken: string): Promise<void> {
    const qs = new URLSearchParams({ api_key: this.cfg.apiKey, access_token: accessToken });
    await brokerFetch(`${API_ROOT}/session/token?${qs.toString()}`, {
      method: 'DELETE',
      headers: this.headers(accessToken),
      proxyUrl: this.cfg.proxyUrl,
    });
  }
}
