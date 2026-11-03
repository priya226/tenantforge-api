import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import type { TokenSubject } from '../../auth/auth.service.js';

export type CurrentUserInfo = TokenSubject;
// @CurrentUser(): "give me the caller"
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CurrentUserInfo =>
    ctx.switchToHttp().getRequest<{ user: CurrentUserInfo }>().user,
);
