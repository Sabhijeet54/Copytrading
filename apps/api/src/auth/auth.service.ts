import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { PrismaClient, User } from '@ctp/database';
import { generateToken, getDummyHash, hashPassword, sha256, verifyPassword } from '@ctp/shared';
import { AuditService } from '../audit/audit.service';
import { PRISMA } from '../common/prisma/prisma.service';
import { API_CONFIG, ApiConfig } from '../config/config.module';
import { MailService } from '../notifications/mail.service';
import { LoginDto, RegisterDto } from './dto/auth.dto';
import { ClientInfo, IssuedTokens, TokenService } from './token.service';

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

export interface AuthResult {
  user: User;
  tokens: IssuedTokens | null;
  verificationRequired: boolean;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger('Auth');

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  async register(dto: RegisterDto, client: ClientInfo): Promise<AuthResult> {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email }, select: { id: true } });
    if (existing) throw new ConflictException('An account with this email already exists');

    const passwordHash = await hashPassword(dto.password);
    const verificationToken = generateToken(32);

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: dto.email,
          passwordHash,
          name: dto.name,
          mobile: dto.mobile ?? null,
          role: dto.role,
        },
      });
      await tx.emailVerificationToken.create({
        data: { userId: created.id, tokenHash: sha256(verificationToken), expiresAt: new Date(Date.now() + VERIFICATION_TTL_MS) },
      });
      await this.audit.logTx(tx, {
        action: 'USER_REGISTERED',
        actorUserId: created.id,
        targetType: 'User',
        targetId: created.id,
        metadata: { role: created.role },
        client,
      });
      return created;
    });

    await this.mail.sendEmailVerification(user.email, user.name, verificationToken).catch((err: Error) => {
      this.logger.error(`Could not send verification email: ${err.message}`);
    });

    if (this.config.REQUIRE_EMAIL_VERIFICATION) {
      return { user, tokens: null, verificationRequired: true };
    }
    const tokens = await this.tokens.issueForNewSession(user, client);
    return { user, tokens, verificationRequired: false };
  }

  async login(dto: LoginDto, client: ClientInfo): Promise<AuthResult> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    // Always run a hash verification so response timing does not reveal whether the email exists.
    const valid = await verifyPassword(user?.passwordHash ?? (await getDummyHash()), dto.password);

    if (!user || !valid) {
      await this.audit.log({
        action: 'USER_LOGIN_FAILED',
        actorUserId: user?.id ?? null,
        targetType: 'User',
        targetId: user?.id,
        metadata: { email: dto.email, reason: user ? 'bad_password' : 'unknown_email' },
        client,
      });
      throw new UnauthorizedException('Invalid email or password');
    }
    if (user.status !== 'ACTIVE') {
      await this.audit.log({ action: 'USER_LOGIN_FAILED', actorUserId: user.id, targetType: 'User', targetId: user.id, metadata: { reason: 'disabled' }, client });
      throw new ForbiddenException('This account has been disabled. Contact support.');
    }
    if (this.config.REQUIRE_EMAIL_VERIFICATION && !user.emailVerifiedAt) {
      throw new ForbiddenException('Please verify your email address before signing in.');
    }

    const tokens = await this.tokens.issueForNewSession(user, client);
    const updated = await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await this.audit.log({ action: 'USER_LOGIN', actorUserId: user.id, targetType: 'User', targetId: user.id, client });
    return { user: updated, tokens, verificationRequired: false };
  }

  async refresh(refreshToken: string | undefined, client: ClientInfo): Promise<{ user: User; tokens: IssuedTokens }> {
    if (!refreshToken) throw new UnauthorizedException('Not authenticated');
    const result = await this.tokens.rotate(refreshToken, client);
    switch (result.kind) {
      case 'ok':
        return { user: result.user, tokens: result.tokens };
      case 'reuse':
        await this.audit.log({
          action: 'REFRESH_TOKEN_REUSE_DETECTED',
          actorUserId: result.userId,
          targetType: 'User',
          targetId: result.userId,
          client,
        });
        throw new UnauthorizedException('Session revoked');
      case 'race':
        // Another tab rotated this token a moment ago; its new cookies are already in the browser.
        throw new UnauthorizedException({ statusCode: 401, error: 'Unauthorized', message: 'Session refreshed concurrently', code: 'REFRESH_RACE' });
      default:
        throw new UnauthorizedException('Session expired');
    }
  }

  async logout(refreshToken: string | undefined, client: ClientInfo): Promise<void> {
    if (!refreshToken) return;
    const userId = await this.tokens.revokeByRefreshToken(refreshToken);
    if (userId) {
      await this.audit.log({ action: 'USER_LOGOUT', actorUserId: userId, targetType: 'User', targetId: userId, client });
    }
  }

  async verifyEmail(token: string, client: ClientInfo): Promise<void> {
    const record = await this.prisma.emailVerificationToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (!record || record.usedAt || record.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('This verification link is invalid or has expired.');
    }
    await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.emailVerificationToken.updateMany({
        where: { id: record.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (consumed.count !== 1) throw new BadRequestException('This verification link has already been used.');
      await tx.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: new Date() } });
      await this.audit.logTx(tx, { action: 'EMAIL_VERIFIED', actorUserId: record.userId, targetType: 'User', targetId: record.userId, client });
    });
  }

  /** Always succeeds from the caller's perspective, so it cannot be used to probe which emails exist. */
  async resendVerification(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.emailVerifiedAt || user.status !== 'ACTIVE') return;
    const token = generateToken(32);
    await this.prisma.emailVerificationToken.create({
      data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + VERIFICATION_TTL_MS) },
    });
    await this.mail.sendEmailVerification(user.email, user.name, token).catch((err: Error) => {
      this.logger.error(`Could not send verification email: ${err.message}`);
    });
  }

  async getUser(userId: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('Not authenticated');
    return user;
  }
}
