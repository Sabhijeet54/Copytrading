import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PrismaClient } from '@ctp/database';
import { ACCESS_COOKIE } from '../../auth/auth-cookies';
import { TokenService } from '../../auth/token.service';
import { AuthenticatedRequest, IS_PUBLIC_KEY } from '../decorators/auth.decorators';
import { PRISMA } from '../prisma/prisma.service';

/**
 * Global authentication guard. Every route requires a valid access token unless marked @Public().
 * Besides verifying the JWT it checks that the session has not been revoked (logout, password
 * change, admin disable) and that the user is still ACTIVE — so revocation takes effect immediately.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token: string | undefined = req.cookies?.[ACCESS_COOKIE];
    if (!token) throw new UnauthorizedException('Not authenticated');

    let payload;
    try {
      payload = await this.tokens.verifyAccess(token);
    } catch {
      throw new UnauthorizedException('Session expired');
    }

    const session = await this.prisma.session.findUnique({
      where: { id: payload.sid },
      select: { revokedAt: true, expiresAt: true, userId: true, user: { select: { id: true, email: true, role: true, status: true } } },
    });
    if (!session || session.userId !== payload.sub || session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Session expired');
    }
    if (session.user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Account disabled');
    }

    req.user = { id: session.user.id, email: session.user.email, role: session.user.role, sessionId: payload.sid };
    return true;
  }
}
