import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY, ROLES_KEY } from '../../src/common/decorators/auth.decorators';
import { RolesGuard } from '../../src/common/guards/roles.guard';

function ctx(user: { role: string } | undefined, meta: Record<string, unknown>): ExecutionContext {
  const handler = () => undefined;
  for (const [k, v] of Object.entries(meta)) Reflect.defineMetadata(k, v, handler);
  return {
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  const guard = new RolesGuard(new Reflector());

  it('allows any authenticated user when no roles are required', () => {
    expect(guard.canActivate(ctx({ role: 'FOLLOWER' }, {}))).toBe(true);
  });

  it('allows a matching role', () => {
    expect(guard.canActivate(ctx({ role: 'ADMIN' }, { [ROLES_KEY]: ['ADMIN'] }))).toBe(true);
  });

  it.each(['MASTER', 'FOLLOWER'])('forbids %s from admin-only routes', (role) => {
    expect(() => guard.canActivate(ctx({ role }, { [ROLES_KEY]: ['ADMIN'] }))).toThrow(ForbiddenException);
  });

  it('forbids when no user is attached', () => {
    expect(() => guard.canActivate(ctx(undefined, { [ROLES_KEY]: ['ADMIN'] }))).toThrow(ForbiddenException);
  });

  it('skips public routes', () => {
    expect(guard.canActivate(ctx(undefined, { [IS_PUBLIC_KEY]: true, [ROLES_KEY]: ['ADMIN'] }))).toBe(true);
  });
});
