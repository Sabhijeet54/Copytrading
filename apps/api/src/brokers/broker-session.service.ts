import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type Redis from 'ioredis';
import type { BrokerAccount, BrokerName, PrismaClient } from '@ctp/database';
import { generateToken, SecretBox } from '@ctp/shared';
import { AuditService } from '../audit/audit.service';
import type { ClientInfo } from '../auth/token.service';
import { PRISMA } from '../common/prisma/prisma.service';
import { REDIS } from '../common/redis/redis.module';
import { API_CONFIG, ApiConfig } from '../config/config.module';
import { AngelOneClient } from './angel-one/angel-one.client';
import { BrokerApiError } from './broker-http';
import { ZerodhaClient } from './zerodha/zerodha.client';

const STATE_TTL_SECONDS = 600;
const stateKey = (state: string) => `broker:oauth-state:${state}`;

interface SessionMaterial {
  brokerClientId: string;
  accessToken: string;
  refreshToken?: string;
  extra?: Record<string, string | undefined>;
  expiresAt: Date;
}

/**
 * Owns broker login state (CSRF `state` in Redis), token exchange and encrypted persistence.
 * Raw tokens only ever exist in memory here and in BrokerCredential as AES-256-GCM ciphertext.
 */
@Injectable()
export class BrokerSessionService {
  private readonly logger = new Logger('BrokerSession');
  private readonly box: SecretBox;

  constructor(
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly audit: AuditService,
  ) {
    this.box = new SecretBox(config.ENCRYPTION_KEY);
  }

  // ------------------------------------------------------------- clients

  zerodha(): ZerodhaClient {
    const { ZERODHA_API_KEY, ZERODHA_API_SECRET, ZERODHA_PROXY_URL } = this.config;
    if (!ZERODHA_API_KEY || !ZERODHA_API_SECRET) {
      throw new ServiceUnavailableException('Zerodha is not configured (ZERODHA_API_KEY / ZERODHA_API_SECRET).');
    }
    return new ZerodhaClient({ apiKey: ZERODHA_API_KEY, apiSecret: ZERODHA_API_SECRET, proxyUrl: ZERODHA_PROXY_URL });
  }

  angelOne(): AngelOneClient {
    const c = this.config;
    if (!c.ANGEL_API_KEY) throw new ServiceUnavailableException('Angel One is not configured (ANGEL_API_KEY).');
    return new AngelOneClient({
      apiKey: c.ANGEL_API_KEY,
      publicIp: c.ANGEL_PUBLIC_IP,
      localIp: c.ANGEL_LOCAL_IP,
      macAddress: c.ANGEL_MAC_ADDRESS,
      proxyUrl: c.ANGEL_PROXY_URL,
    });
  }

  // --------------------------------------------------------------- state

  async createState(userId: string, broker: BrokerName): Promise<string> {
    const state = generateToken(24);
    await this.redis.set(stateKey(state), JSON.stringify({ userId, broker }), 'EX', STATE_TTL_SECONDS);
    return state;
  }

  /** One-time use: the state is deleted as it is read. */
  async consumeState(state: string | undefined, broker: BrokerName): Promise<string> {
    if (!state || state.length > 128) throw new BadRequestException('Missing login state. Please start the broker login again.');
    const raw = await this.redis.getdel(stateKey(state));
    if (!raw) throw new BadRequestException('Broker login expired. Please start again.');
    const parsed = JSON.parse(raw) as { userId: string; broker: BrokerName };
    if (parsed.broker !== broker) throw new BadRequestException('Broker login state mismatch.');
    return parsed.userId;
  }

  // ------------------------------------------------------------- persist

  async saveSession(userId: string, broker: BrokerName, s: SessionMaterial, client?: ClientInfo): Promise<BrokerAccount> {
    const linked = await this.prisma.brokerAccount.findUnique({
      where: { broker_brokerClientId: { broker, brokerClientId: s.brokerClientId } },
    });
    if (linked && linked.userId !== userId) {
      throw new ConflictException('This broker account is already linked to another user.');
    }

    return this.prisma.$transaction(async (tx) => {
      const account = await tx.brokerAccount.upsert({
        where: { userId_broker: { userId, broker } },
        create: { userId, broker, brokerClientId: s.brokerClientId, status: 'PENDING' },
        update: {},
      });
      if (account.brokerClientId && account.brokerClientId !== s.brokerClientId) {
        throw new ConflictException(
          `You logged in as ${s.brokerClientId}, but this profile is linked to ${account.brokerClientId}. Disconnect it first to switch accounts.`,
        );
      }
      const aad = account.id;
      const extra = s.extra && Object.values(s.extra).some(Boolean) ? JSON.stringify(s.extra) : undefined;
      const data = {
        encryptedAccessToken: this.box.encrypt(s.accessToken, aad),
        encryptedRefreshToken: s.refreshToken ? this.box.encrypt(s.refreshToken, aad) : null,
        encryptedExtra: extra ? this.box.encrypt(extra, aad) : null,
        keyId: 'k1',
      };
      await tx.brokerCredential.upsert({
        where: { brokerAccountId: account.id },
        create: { brokerAccountId: account.id, ...data },
        update: data,
      });
      const updated = await tx.brokerAccount.update({
        where: { id: account.id },
        data: {
          brokerClientId: s.brokerClientId,
          status: 'CONNECTED',
          isPaper: false,
          tokenExpiresAt: s.expiresAt,
          lastConnectedAt: new Date(),
          lastError: null,
        },
      });
      await this.audit.logTx(tx, {
        action: 'BROKER_CONNECTED',
        actorUserId: userId,
        targetType: 'BrokerAccount',
        targetId: account.id,
        metadata: { broker, brokerClientId: s.brokerClientId, expiresAt: s.expiresAt.toISOString() },
        client,
      });
      return updated;
    });
  }

  /** Records a failed login on the account (if one exists) without touching credentials. */
  async recordError(userId: string, broker: BrokerName, err: unknown): Promise<string> {
    const message = err instanceof BrokerApiError || err instanceof Error ? err.message : 'Broker login failed.';
    this.logger.warn(`${broker} login failed for user ${userId}: ${message}`);
    await this.prisma.brokerAccount
      .updateMany({ where: { userId, broker }, data: { lastError: message.slice(0, 500) } })
      .catch(() => undefined);
    return message;
  }

  async decryptAccess(account: BrokerAccount): Promise<string | null> {
    const cred = await this.prisma.brokerCredential.findUnique({ where: { brokerAccountId: account.id } });
    return cred ? this.box.decrypt(cred.encryptedAccessToken, account.id) : null;
  }

  async disconnect(userId: string, accountId: string, client?: ClientInfo): Promise<BrokerAccount> {
    const account = await this.prisma.brokerAccount.findFirst({ where: { id: accountId, userId } });
    if (!account) throw new NotFoundException('Broker account not found');

    // Best-effort logout at the broker so the token is useless even if it leaked.
    try {
      const token = await this.decryptAccess(account);
      if (token && account.broker === 'ZERODHA') await this.zerodha().logout(token);
      if (token && account.broker === 'ANGEL_ONE' && account.brokerClientId) await this.angelOne().logout(account.brokerClientId, token);
    } catch (err) {
      this.logger.warn(`Broker logout failed for account ${account.id}: ${(err as Error).message}`);
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.brokerCredential.deleteMany({ where: { brokerAccountId: account.id } });
      const updated = await tx.brokerAccount.update({
        where: { id: account.id },
        data: { status: 'DISCONNECTED', tokenExpiresAt: null },
      });
      await this.audit.logTx(tx, {
        action: 'BROKER_DISCONNECTED',
        actorUserId: userId,
        targetType: 'BrokerAccount',
        targetId: account.id,
        metadata: { broker: account.broker, by: 'user' },
        client,
      });
      return updated;
    });
  }
}
