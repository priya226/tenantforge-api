import { type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';

import { IS_PUBLIC_KEY } from './public.decorator.js';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(), // the method, e.g. login()
      context.getClass(), // the controller, e.g. AuthController
    ]);
    if (isPublic) {
      // public route → no token needed
      return true;
    }
    return super.canActivate(context); // otherwise → run Passport's 'jwt' strategy
  }
}
