import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { RoleName } from '../../roles/role-name.js';
import type { CurrentUserInfo } from './current-user.decorator.js';
import { ROLES_KEY } from './roles.decorator.js';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<RoleName[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) {
      // no @Roles → any logged-in user
      return true;
    }
    const { user } = context
      .switchToHttp()
      .getRequest<{ user?: CurrentUserInfo }>(); // put there by JwtStrategy
    if (!user?.roles.some((role) => required.includes(role))) {
      throw new ForbiddenException('You do not have permission to do this'); // 403
    }
    return true;
  }
}
