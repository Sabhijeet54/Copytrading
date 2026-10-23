import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@ctp/database';
import { ADMIN_ONLY_KEY, AuthenticatedRequest, IS_PUBLIC_KEY, ROLES_KEY } from '../decorators/auth.decorators';

/** Role-based authorization. Runs after AuthGuard. Routes without @Roles() allow any authenticated user. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, targets);
    if (!required || required.length === 0) return true;

    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    // A sub-admin uses the admin panel, except routes marked @AdminOnly() (platform-critical actions).
    const subAdminOk =
      user?.role === 'SUB_ADMIN' && required.includes('ADMIN') && !this.reflector.getAllAndOverride<boolean>(ADMIN_ONLY_KEY, targets);
    if (!user || (!required.includes(user.role) && !subAdminOk)) {
      throw new ForbiddenException('You do not have permission to perform this action');
    }
    return true;
  }
}
