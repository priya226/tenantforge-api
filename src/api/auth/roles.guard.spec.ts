import { type ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { RoleName } from '../../roles/role-name.js';
import type { CurrentUserInfo } from './current-user.decorator.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { Public } from './public.decorator.js';
import { Roles } from './roles.decorator.js';
import { RolesGuard } from './roles.guard.js';

function contextFor(
  target: { handler: () => void; cls: new () => unknown },
  user?: CurrentUserInfo,
): ExecutionContext {
  return {
    getHandler: () => target.handler,
    getClass: () => target.cls,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

function route(classRoles?: RoleName[], handlerRoles?: RoleName[]) {
  class Ctrl {
    handle(this: void) {}
  }
  if (classRoles) {
    Roles(...classRoles)(Ctrl);
  }
  const handler = Ctrl.prototype.handle;
  if (handlerRoles) {
    Roles(...handlerRoles)(Ctrl.prototype, 'handle', {
      value: handler,
    } as PropertyDescriptor);
  }
  return { handler, cls: Ctrl };
}

const userWith = (...roles: RoleName[]): CurrentUserInfo => ({
  userId: 'u1',
  companyId: 'c1',
  roles,
});

describe('RolesGuard', () => {
  const guard = new RolesGuard(new Reflector());

  it('allows any logged-in user when the route has no @Roles', () => {
    expect(guard.canActivate(contextFor(route(), userWith('VIEWER')))).toBe(
      true,
    );
  });

  it('allows a user holding one of the class-level roles', () => {
    const target = route(['COMPANY_ADMIN', 'PLATFORM_ADMIN']);
    expect(
      guard.canActivate(contextFor(target, userWith('COMPANY_ADMIN'))),
    ).toBe(true);
  });

  it('rejects a user without any required role with 403', () => {
    const target = route(['PLATFORM_ADMIN']);
    expect(() =>
      guard.canActivate(
        contextFor(target, userWith('COMPANY_ADMIN', 'VIEWER')),
      ),
    ).toThrow(ForbiddenException);
  });

  it('lets a method-level @Roles override the class-level one', () => {
    const target = route(['PLATFORM_ADMIN'], ['VIEWER']);
    expect(guard.canActivate(contextFor(target, userWith('VIEWER')))).toBe(
      true,
    );
  });

  it('rejects with 403 when there is no user on the request', () => {
    expect(() =>
      guard.canActivate(contextFor(route(['VIEWER']), undefined)),
    ).toThrow(ForbiddenException);
  });
});

describe('JwtAuthGuard', () => {
  it('skips token checks on a @Public() class', () => {
    class Open {
      handle(this: void) {}
    }
    Public()(Open);
    const guard = new JwtAuthGuard(new Reflector());

    expect(
      guard.canActivate(
        contextFor({ handler: Open.prototype.handle, cls: Open }),
      ),
    ).toBe(true);
  });
});
