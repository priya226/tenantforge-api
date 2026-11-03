import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import type { AccessTokenPayload, TokenSubject } from './auth.service.js';

//Passport is the most widely used auth library for Node. It handles many login methods through plug-in "strategies"
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      // ExtractJwt quickly extracts the JWT from the request header and verifies it using the secret key
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(), // 1. where to find it
      secretOrKey: config.getOrThrow('JWT_SECRET'), // 2. key to check the signature
      algorithms: ['HS256'], // 3. only this algorithm
      ignoreExpiration: false, // 4. reject expired tokens
    });
  }
  // 5. runs only if 1–4 passed
  validate(payload: AccessTokenPayload): TokenSubject {
    return {
      userId: payload.sub,
      companyId: payload.companyId,
      roles: payload.roles,
    };
  }
}
