import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Role } from '@ctp/database';
import type { Request } from 'express';

export const IS_PUBLIC_KEY = 'ctp:isPublic';
export const ROLES_KEY = 'ctp:roles';

/** Marks a route as reachable without authentication. Everything else requires a valid session. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Restricts a route (or controller) to the given roles. SUB_ADMIN passes ADMIN routes unless marked @AdminOnly(). */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export const ADMIN_ONLY_KEY = 'ctp:adminOnly';
/** Platform-critical admin routes: the full ADMIN only (never a SUB_ADMIN). */
export const AdminOnly = () => SetMetadata(ADMIN_ONLY_KEY, true);

/** ADMIN or SUB_ADMIN. */
export const isStaffAdmin = (role: Role | string) => role === 'ADMIN' || role === 'SUB_ADMIN';

export interface RequestUser {
  id: string;
  email: string;
  role: Role;
  sessionId: string;
}

export type AuthenticatedRequest = Request & { user?: RequestUser; requestId?: string };

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): RequestUser => {
  const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
  if (!req.user) throw new Error('CurrentUser used on a public route');
  return req.user;
});
