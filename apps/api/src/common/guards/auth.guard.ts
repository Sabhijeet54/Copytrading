import { CanActivate, ExecutionContext, Inject, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
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
      select: { revokedAt: true, expiresAt: true, userId: true, impersonatorUserId: true, user: { select: { id: true, email: true, role: true, status: true, parentUserId: true, licenceExpiresAt: true } } },
    });
    if (!session || session.userId !== payload.sub || session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Session expired');
    }
    if (session.user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Account disabled');
    }

    const u = session.user;
    if (u.role === 'SUB_ADMIN' && u.parentUserId) {
      // A master's sub-admin works as that master on master / market routes, and is a MASTER everywhere
      // (never reaches the platform admin panel). Own profile / password routes keep the sub-admin's own id.
      const path = (req.originalUrl ?? req.url ?? '').split('?')[0]!.replace(/^\/api/, '');
      const asMaster = path.startsWith('/master') || path.startsWith('/market');
      req.user = { id: asMaster ? u.parentUserId : u.id, email: u.email, role: 'MASTER', sessionId: payload.sid, actorId: u.id };
      return true;
    }
    // Expired licence: a client can still sign in and look, but can change nothing (no paper / live switch,
    // no strategy connect, no broker connect / API save). Profile, password and logout stay allowed.
    if (u.role === 'FOLLOWER' && u.licenceExpiresAt && u.licenceExpiresAt.getTime() <= Date.now() && req.method !== 'GET') {
      const path = (req.originalUrl ?? req.url ?? '').split('?')[0]!.replace(/^\/api/, '');
      if (!path.startsWith('/auth') && !path.startsWith('/users/me')) {
        throw new ForbiddenException('Your licence has expired — contact your master to renew it.');
      }
    }
    req.user = { id: u.id, email: u.email, role: u.role, sessionId: payload.sid, ...(session.impersonatorUserId ? { impersonatorId: session.impersonatorUserId } : {}) };
    return true;
  }
}
