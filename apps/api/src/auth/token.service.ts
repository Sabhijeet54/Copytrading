import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { generateToken, sha256 } from '@ctp/shared';
import type { PrismaClient, Role, Session, User } from '@ctp/database';
import { randomUUID } from 'node:crypto';
import { API_CONFIG, ApiConfig } from '../config/config.module';
import { PRISMA } from '../common/prisma/prisma.service';

export const JWT_ISSUER = 'ctp-api';
export const JWT_AUDIENCE = 'ctp-web';

export interface AccessTokenPayload {
  sub: string;
  sid: string;
  role: Role;
}

export interface IssuedTokens {
  accessToken: string;
  accessTokenExpiresAt: number;
  refreshToken: string;
  refreshExpiresAt: Date;
  session: Session;
}

export interface ClientInfo {
  ip?: string | null;
  userAgent?: string | null;
}

export type RotateResult =
  | { kind: 'ok'; tokens: IssuedTokens; user: User }
  | { kind: 'invalid' }
  | { kind: 'expired' }
  | { kind: 'race' }
  | { kind: 'reuse'; userId: string };

/** Window in which presenting a just-rotated refresh token is treated as a concurrent-tab race, not theft. */
const ROTATION_GRACE_MS = 30_000;

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  private refreshExpiry(): Date {
    return new Date(Date.now() + this.config.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  }

  private async signAccess(user: Pick<User, 'id' | 'role'>, sessionId: string) {
    const payload: AccessTokenPayload = { sub: user.id, sid: sessionId, role: user.role };
    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.JWT_SECRET,
      expiresIn: this.config.JWT_ACCESS_TTL_SECONDS,
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      algorithm: 'HS256',
    });
    return { accessToken, accessTokenExpiresAt: Date.now() + this.config.JWT_ACCESS_TTL_SECONDS * 1000 };
  }

  async verifyAccess(token: string): Promise<AccessTokenPayload> {
    return this.jwt.verifyAsync<AccessTokenPayload>(token, {
      secret: this.config.JWT_SECRET,
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      algorithms: ['HS256'],
    });
  }

  /** Starts a brand-new session family (login / register). */
  async issueForNewSession(user: Pick<User, 'id' | 'role'>, client: ClientInfo): Promise<IssuedTokens> {
    const refreshToken = generateToken(48);
    const refreshExpiresAt = this.refreshExpiry();
    const session = await this.prisma.session.create({
      data: {
        userId: user.id,
        familyId: randomUUID(),
        tokenHash: sha256(refreshToken),
        expiresAt: refreshExpiresAt,
        ip: client.ip ?? null,
        userAgent: client.userAgent?.slice(0, 512) ?? null,
      },
    });
    const access = await this.signAccess(user, session.id);
    return { ...access, refreshToken, refreshExpiresAt, session };
  }

  /**
   * Refresh-token rotation with reuse detection.
   * The conditional `updateMany(... revokedAt: null)` makes rotation atomic: only one
   * concurrent request can consume a given refresh token.
   */
  async rotate(presentedToken: string, client: ClientInfo): Promise<RotateResult> {
    const tokenHash = sha256(presentedToken);
    const existing = await this.prisma.session.findUnique({ where: { tokenHash }, include: { user: true } });
    if (!existing) return { kind: 'invalid' };

    if (existing.revokedAt) {
      const recentlyRotated =
        existing.replacedById !== null && Date.now() - existing.revokedAt.getTime() < ROTATION_GRACE_MS;
      if (recentlyRotated) return { kind: 'race' };
      // A revoked token was replayed outside the grace window: assume theft, kill the whole family.
      await this.revokeFamily(existing.familyId);
      return { kind: 'reuse', userId: existing.userId };
    }
    if (existing.expiresAt.getTime() <= Date.now()) return { kind: 'expired' };
    if (existing.user.status !== 'ACTIVE') return { kind: 'invalid' };

    const refreshToken = generateToken(48);
    const refreshExpiresAt = this.refreshExpiry();
    const now = new Date();

    const result = await this.prisma.$transaction(async (tx) => {
      const next = await tx.session.create({
        data: {
          userId: existing.userId,
          familyId: existing.familyId,
          tokenHash: sha256(refreshToken),
          expiresAt: refreshExpiresAt,
          ip: client.ip ?? null,
          userAgent: client.userAgent?.slice(0, 512) ?? null,
        },
      });
      const consumed = await tx.session.updateMany({
        where: { id: existing.id, revokedAt: null },
        data: { revokedAt: now, replacedById: next.id, lastUsedAt: now },
      });
      if (consumed.count !== 1) {
        throw new RotationConflict();
      }
      return next;
    }).catch((err) => {
      if (err instanceof RotationConflict) return null;
      throw err;
    });

    if (!result) return { kind: 'race' };
    const access = await this.signAccess(existing.user, result.id);
    return { kind: 'ok', user: existing.user, tokens: { ...access, refreshToken, refreshExpiresAt, session: result } };
  }

  async revokeByRefreshToken(presentedToken: string): Promise<string | null> {
    const session = await this.prisma.session.findUnique({ where: { tokenHash: sha256(presentedToken) } });
    if (!session) return null;
    await this.revokeFamily(session.familyId);
    return session.userId;
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.session.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async revokeAllForUser(userId: string, exceptFamilyId?: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null, ...(exceptFamilyId ? { NOT: { familyId: exceptFamilyId } } : {}) },
      data: { revokedAt: new Date() },
    });
  }
}

class RotationConflict extends Error {}
