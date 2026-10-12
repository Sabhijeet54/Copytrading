import { BrokerApiError, brokerFetch, nextIstTime } from '../broker-http';

const API_ROOT = 'https://apiconnect.angelone.in';
const PUBLISHER_LOGIN_URL = 'https://smartapi.angelone.in/publisher-login';

export interface AngelOneConfig {
  apiKey: string;
  publicIp?: string;
  localIp?: string;
  macAddress?: string;
  proxyUrl?: string;
}

export interface AngelOneSession {
  clientCode: string;
  name?: string;
  jwtToken: string;
  refreshToken?: string;
  feedToken?: string;
  expiresAt: Date;
}

interface SmartEnvelope<T> {
  status: boolean;
  message?: string;
  errorcode?: string;
  data?: T | null;
}

/**
 * Angel One SmartAPI login. Two supported flows:
 *  A) Direct (TOTP): POST loginByPassword with { clientcode, password: <4-digit PIN>, totp }.
 *     The PIN and TOTP are used once and never stored.
 *  B) Publisher redirect: send the user to smartapi.angelone.in/publisher-login?api_key=…&state=…;
 *     Angel redirects back with auth_token, feed_token and refresh_token.
 * Sessions are valid until midnight IST, so the user logs in once per trading day.
 */
export class AngelOneClient {
  constructor(private readonly cfg: AngelOneConfig) {}

  /** redirectUrl must exactly match the Redirect URL saved on the SmartAPI app. */
  publisherLoginUrl(state: string, redirectUrl: string): string {
    const qs = new URLSearchParams({ api_key: this.cfg.apiKey, redirect_url: redirectUrl, state });
    return `${PUBLISHER_LOGIN_URL}?${qs.toString()}`;
  }

  private headers(jwt?: string): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-UserType': 'USER',
      'X-SourceID': 'WEB',
      'X-ClientLocalIP': this.cfg.localIp ?? '127.0.0.1',
      'X-ClientPublicIP': this.cfg.publicIp ?? '127.0.0.1',
      'X-MACAddress': this.cfg.macAddress ?? '00:00:00:00:00:00',
      'X-PrivateKey': this.cfg.apiKey,
      ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
    };
  }

  private async call<T>(path: string, method: 'GET' | 'POST', payload?: object, jwt?: string): Promise<T> {
    const { status, body } = await brokerFetch<SmartEnvelope<T>>(`${API_ROOT}${path}`, {
      method,
      headers: this.headers(jwt),
      body: payload ? JSON.stringify(payload) : undefined,
      proxyUrl: this.cfg.proxyUrl,
    });
    if (status !== 200 || !body?.status || !body.data) {
      throw new BrokerApiError(body?.message || `Angel One request failed (HTTP ${status}).`, status, body?.errorcode);
    }
    return body.data;
  }

  async loginWithTotp(clientCode: string, pin: string, totp: string): Promise<AngelOneSession> {
    const d = await this.call<{ jwtToken: string; refreshToken: string; feedToken: string }>(
      '/rest/auth/angelbroking/user/v1/loginByPassword',
      'POST',
      { clientcode: clientCode, password: pin, totp },
    );
    return this.completeSession(d.jwtToken, d.refreshToken, d.feedToken);
  }

  /** Publisher-login callback: tokens come straight from Angel's redirect. */
  async sessionFromPublisherTokens(authToken: string, refreshToken?: string, feedToken?: string): Promise<AngelOneSession> {
    return this.completeSession(authToken, refreshToken, feedToken);
  }

  private async completeSession(jwt: string, refreshToken?: string, feedToken?: string): Promise<AngelOneSession> {
    const token = jwt.replace(/^Bearer\s+/i, '');
    // Verifies the token and gives us the client code to bind the account to.
    const profile = await this.call<{ clientcode: string; name?: string }>(
      `/rest/secure/angelbroking/user/v1/getProfile`,
      'GET',
      undefined,
      token,
    );
    return {
      clientCode: profile.clientcode,
      name: profile.name,
      jwtToken: token,
      refreshToken: refreshToken || undefined,
      feedToken: feedToken || undefined,
      expiresAt: nextIstTime(0, 0),
    };
  }

  /** Terminates the SmartAPI session. Best effort. */
  async logout(clientCode: string, jwt: string): Promise<void> {
    await this.call('/rest/secure/angelbroking/user/v1/logout', 'POST', { clientcode: clientCode }, jwt).catch(() => undefined);
  }
}
