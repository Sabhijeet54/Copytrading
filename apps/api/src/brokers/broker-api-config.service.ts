import { BadRequestException, Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import type { BrokerApiConfig, BrokerName, PrismaClient } from '@ctp/database';
import type { ClientInfo } from '../auth/token.service';
import { PRISMA } from '../common/prisma/prisma.service';
import { API_CONFIG, ApiConfig } from '../config/config.module';
import { AngelOneClient } from './angel-one/angel-one.client';
import { BrokerApiError, brokerFetch } from './broker-http';
import { BrokerSessionService } from './broker-session.service';
import { extractTotpSecret, totp } from './totp';
import { ZerodhaClient } from './zerodha/zerodha.client';

/** Secrets kept encrypted; never sent back to the browser. */
interface Secrets {
  apiKey?: string;
  apiSecret?: string;
  pin?: string;
  totpSecret?: string;
  proxyUser?: string;
  proxyPass?: string;
}
const SECRET_KEYS: (keyof Secrets)[] = ['apiKey', 'apiSecret', 'pin', 'totpSecret', 'proxyUser', 'proxyPass'];

export interface SaveBrokerApiConfigInput extends Secrets {
  clientCode?: string;
  proxyHost?: string;
  proxyPort?: number;
  autoLogin?: boolean;
  consent?: boolean;
}

export interface BrokerApiConfigView {
  broker: BrokerName;
  clientCode: string | null;
  proxyHost: string | null;
  proxyPort: number | null;
  /** Which secrets are stored (values are never returned). */
  saved: Record<keyof Secrets, boolean>;
  autoLogin: boolean;
  consentAt: string | null;
  complete: boolean;
  missing: string[];
  lastTest: { at: string; ok: boolean; ip: string | null; error: string | null } | null;
  lastLogin: { at: string | null; error: string | null };
  redirectUrl: string;
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const HOST = /^(?=.{1,253}$)([a-zA-Z0-9-]{1,63}\.)*[a-zA-Z0-9-]{1,63}$/;

/**
 * The client's own broker API app and static-IP proxy (Angel One / Zerodha each separately):
 * save (encrypted) → test proxy health (which IP do we really leave from?) → connect.
 * Angel One connects server-side with PIN + TOTP (and again every trading morning when autoLogin is on);
 * Zerodha only allows its browser login, so connect returns the Kite login URL for the client's own app.
 * The session then carries { apiKey, proxyUrl } so every order for that account uses the client's app and IP.
 */
@Injectable()
export class BrokerApiConfigService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('BrokerApiConfig');
  private timer?: NodeJS.Timeout;
  private autoLoginDay = '';

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    private readonly sessions: BrokerSessionService,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.autoLoginTick(), 60_000);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  // ------------------------------------------------------------ helpers

  private redirectUrl(broker: BrokerName): string {
    const base = this.config.API_PUBLIC_URL?.replace(/\/$/, '') ?? '';
    return broker === 'ZERODHA'
      ? (this.config.ZERODHA_REDIRECT_URL ?? `${base}/brokers/zerodha/callback`)
      : (this.config.ANGEL_REDIRECT_URL ?? `${base}/brokers/angel-one/callback`);
  }

  private secretsOf(row: BrokerApiConfig | null): Secrets {
    return (row && this.sessions.openJson<Secrets>(row.encryptedSecrets, row.id)) ?? {};
  }

  private required(broker: BrokerName): (keyof Secrets | 'clientCode' | 'proxyHost' | 'proxyPort')[] {
    return broker === 'ANGEL_ONE'
      ? ['clientCode', 'apiKey', 'pin', 'totpSecret', 'proxyHost', 'proxyPort']
      : ['apiKey', 'apiSecret', 'proxyHost', 'proxyPort'];
  }

  private missing(row: BrokerApiConfig | null, broker: BrokerName): string[] {
    const s = this.secretsOf(row);
    return this.required(broker).filter((k) => {
      if (k === 'clientCode' || k === 'proxyHost' || k === 'proxyPort') return !row?.[k];
      return !s[k];
    });
  }

  /** http://user:pass@host:port — credentials URL-encoded. Never logged or returned. */
  proxyUrlOf(row: BrokerApiConfig, s: Secrets): string | undefined {
    if (!row.proxyHost || !row.proxyPort) return undefined;
    const auth = s.proxyUser ? `${encodeURIComponent(s.proxyUser)}:${encodeURIComponent(s.proxyPass ?? '')}@` : '';
    return `http://${auth}${row.proxyHost}:${row.proxyPort}`;
  }

  private view(row: BrokerApiConfig | null, broker: BrokerName): BrokerApiConfigView {
    const s = this.secretsOf(row);
    const missing = this.missing(row, broker);
    return {
      broker,
      clientCode: row?.clientCode ?? null,
      proxyHost: row?.proxyHost ?? null,
      proxyPort: row?.proxyPort ?? null,
      saved: Object.fromEntries(SECRET_KEYS.map((k) => [k, Boolean(s[k])])) as Record<keyof Secrets, boolean>,
      autoLogin: row?.autoLogin ?? true,
      consentAt: row?.consentAt?.toISOString() ?? null,
      complete: missing.length === 0,
      missing,
      lastTest: row?.lastTestAt ? { at: row.lastTestAt.toISOString(), ok: Boolean(row.lastTestOk), ip: row.lastTestIp, error: row.lastTestError } : null,
      lastLogin: { at: row?.lastLoginAt?.toISOString() ?? null, error: row?.lastLoginError ?? null },
      redirectUrl: this.redirectUrl(broker),
    };
  }

  private async row(userId: string, broker: BrokerName): Promise<BrokerApiConfig | null> {
    return this.prisma.brokerApiConfig.findUnique({ where: { userId_broker: { userId, broker } } });
  }

  // ------------------------------------------------------------ CRUD

  async get(userId: string, broker: BrokerName): Promise<BrokerApiConfigView> {
    return this.view(await this.row(userId, broker), broker);
  }

  /** Saves the form. Empty secret fields keep what is already stored (so the client never has to re-type them). */
  async save(userId: string, broker: BrokerName, dto: SaveBrokerApiConfigInput): Promise<BrokerApiConfigView> {
    if (dto.proxyHost && !IPV4.test(dto.proxyHost) && !HOST.test(dto.proxyHost)) throw new BadRequestException('Static IP / host is not valid');
    if (dto.totpSecret) {
      try {
        const secret = extractTotpSecret(dto.totpSecret);
        totp(secret); // validates base32
        dto.totpSecret = secret;
      } catch {
        throw new BadRequestException('TOTP secret is not valid — paste the key shown under the QR code (or the otpauth:// link)');
      }
    }
    const existing = await this.row(userId, broker);
    const row =
      existing ??
      (await this.prisma.brokerApiConfig.create({ data: { userId, broker } }));
    const current = this.secretsOf(existing);
    const next: Secrets = { ...current };
    for (const k of SECRET_KEYS) {
      const v = dto[k]?.trim();
      if (v) next[k] = v;
    }
    const proxyChanged = dto.proxyHost !== undefined && dto.proxyHost !== row.proxyHost;
    const saved = await this.prisma.brokerApiConfig.update({
      where: { id: row.id },
      data: {
        clientCode: dto.clientCode?.trim().toUpperCase() || row.clientCode,
        proxyHost: dto.proxyHost?.trim() || row.proxyHost,
        proxyPort: dto.proxyPort ?? row.proxyPort,
        autoLogin: dto.autoLogin ?? row.autoLogin,
        consentAt: dto.consent ? (row.consentAt ?? new Date()) : row.consentAt,
        encryptedSecrets: this.sessions.sealJson(next, row.id),
        // A different proxy has to be tested again.
        ...(proxyChanged ? { lastTestAt: null, lastTestOk: null, lastTestIp: null, lastTestError: null } : {}),
      },
    });
    return this.view(saved, broker);
  }

  // ------------------------------------------------------------ proxy health

  /** Calls an IP echo service THROUGH the client's proxy: proves it works and shows the IP brokers will see. */
  async test(userId: string, broker: BrokerName): Promise<BrokerApiConfigView & { latencyMs?: number }> {
    const row = await this.row(userId, broker);
    if (!row?.proxyHost || !row.proxyPort) throw new BadRequestException('Save the static IP and port first');
    const proxyUrl = this.proxyUrlOf(row, this.secretsOf(row))!;
    const t0 = Date.now();
    let ok = false;
    let ip: string | null = null;
    let error: string | null = null;
    try {
      const { status, body } = await brokerFetch<{ ip?: string }>('https://api.ipify.org?format=json', { proxyUrl, timeoutMs: 10_000 });
      if (status !== 200 || !body?.ip) throw new Error(`Proxy answered HTTP ${status}`);
      ip = body.ip;
      ok = !IPV4.test(row.proxyHost) || ip === row.proxyHost;
      if (!ok) error = `Traffic leaves from ${ip}, not ${row.proxyHost} — register ${ip} with the broker or fix the proxy`;
    } catch (err) {
      error = (err as Error).message.replace(/\/\/[^@\s]*@/g, '//***@').slice(0, 300);
    }
    const saved = await this.prisma.brokerApiConfig.update({
      where: { id: row.id },
      data: { lastTestAt: new Date(), lastTestOk: ok, lastTestIp: ip, lastTestError: error },
    });
    return { ...this.view(saved, broker), latencyMs: Date.now() - t0 };
  }

  // ------------------------------------------------------------ connect

  /** Angel One: server-side login with the client's own app + PIN + TOTP, through the client's proxy. */
  async connectAngel(userId: string, client?: ClientInfo) {
    const row = await this.row(userId, 'ANGEL_ONE');
    const missing = this.missing(row, 'ANGEL_ONE');
    if (!row || missing.length) throw new BadRequestException(`Fill and save: ${missing.join(', ')}`);
    const s = this.secretsOf(row);
    const proxyUrl = this.proxyUrlOf(row, s);
    const publicIp = IPV4.test(row.proxyHost!) ? row.proxyHost! : (row.lastTestIp ?? undefined);
    const c = this.config;
    const angel = new AngelOneClient({ apiKey: s.apiKey!, proxyUrl, publicIp, localIp: c.ANGEL_LOCAL_IP, macAddress: c.ANGEL_MAC_ADDRESS });
    try {
      const session = await angel.loginWithTotp(row.clientCode!, s.pin!, totp(s.totpSecret!));
      if (session.clientCode.toUpperCase() !== row.clientCode!.toUpperCase()) {
        throw new BrokerApiError(`Logged in as ${session.clientCode}, but the saved client code is ${row.clientCode}`);
      }
      const account = await this.sessions.saveSession(
        userId,
        'ANGEL_ONE',
        {
          brokerClientId: session.clientCode,
          accessToken: session.jwtToken,
          refreshToken: session.refreshToken,
          extra: { feedToken: session.feedToken, apiKey: s.apiKey, proxyUrl, publicIp },
          expiresAt: session.expiresAt,
        },
        client,
      );
      await this.prisma.brokerApiConfig.update({ where: { id: row.id }, data: { lastLoginAt: new Date(), lastLoginError: null } });
      return account;
    } catch (err) {
      const message = (err as Error).message.replace(/\/\/[^@\s]*@/g, '//***@').slice(0, 300);
      await this.prisma.brokerApiConfig.update({ where: { id: row.id }, data: { lastLoginError: message } });
      if (err instanceof BrokerApiError) throw new BadRequestException(await this.sessions.recordError(userId, 'ANGEL_ONE', err));
      throw err;
    }
  }

  /** Zerodha: Kite login URL for the client's own app (redirect URL in that app must point to our callback). */
  async zerodhaLoginUrl(userId: string): Promise<{ loginUrl: string }> {
    const row = await this.row(userId, 'ZERODHA');
    const missing = this.missing(row, 'ZERODHA');
    if (!row || missing.length) throw new BadRequestException(`Fill and save: ${missing.join(', ')}`);
    const s = this.secretsOf(row);
    const state = await this.sessions.createState(userId, 'ZERODHA');
    return { loginUrl: new ZerodhaClient({ apiKey: s.apiKey!, apiSecret: s.apiSecret!, proxyUrl: this.proxyUrlOf(row, s) }).loginUrl(state) };
  }

  /** Zerodha callback: the client's own app (key/secret/proxy) when configured, else null → server app. */
  async zerodhaClientFor(userId: string): Promise<{ client: ZerodhaClient; extra: Record<string, string | undefined> } | null> {
    const row = await this.row(userId, 'ZERODHA');
    const s = this.secretsOf(row);
    if (!row || !s.apiKey || !s.apiSecret) return null;
    const proxyUrl = this.proxyUrlOf(row, s);
    await this.prisma.brokerApiConfig.update({ where: { id: row.id }, data: { lastLoginAt: new Date(), lastLoginError: null } }).catch(() => undefined);
    return { client: new ZerodhaClient({ apiKey: s.apiKey, apiSecret: s.apiSecret, proxyUrl }), extra: { apiKey: s.apiKey, proxyUrl } };
  }

  // ------------------------------------------------------------ daily auto-login (Angel One)

  private async autoLoginTick(): Promise<void> {
    const t = this.config.ANGEL_AUTO_LOGIN_TIME;
    if (!t) return;
    const ist = new Date(Date.now() + 330 * 60_000);
    const day = ist.toISOString().slice(0, 10);
    const wd = ist.getUTCDay();
    const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
    const [h, m] = t.split(':').map(Number) as [number, number];
    if (wd === 0 || wd === 6 || mins < h * 60 + m || mins > 15 * 60 + 30 || this.autoLoginDay === day) return;
    this.autoLoginDay = day;
    const rows = await this.prisma.brokerApiConfig.findMany({ where: { broker: 'ANGEL_ONE', autoLogin: true, user: { status: 'ACTIVE' } } });
    let ok = 0;
    for (const r of rows) {
      if (this.missing(r, 'ANGEL_ONE').length) continue;
      try {
        await this.connectAngel(r.userId);
        ok++;
      } catch (err) {
        this.logger.warn(`Auto-login failed for user ${r.userId}: ${(err as Error).message}`);
      }
      await new Promise((res) => setTimeout(res, 1200)); // stay under Angel's login rate limit
    }
    this.logger.log(`Angel One auto-login: ${ok}/${rows.length} connected`);
  }
}
