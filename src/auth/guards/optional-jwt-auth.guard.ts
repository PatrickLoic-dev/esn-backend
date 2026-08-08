import { ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

// Same JWT verification as JwtAuthGuard, but never rejects the request: an
// absent or invalid token simply leaves `request.user` undefined instead of
// throwing 401. Used on routes that support both guest and signed-in access
// (e.g. checkout), where ownership/guest logic is decided in the service.
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  private readonly logger = new Logger(OptionalJwtAuthGuard.name);

  canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }

  handleRequest<TUser = unknown>(err: unknown, user: TUser): TUser {
    // No exception thrown for a missing/invalid token — `user` stays
    // undefined and the request proceeds as a guest. Logged (not thrown) so
    // a bearer token that a signed-in customer actually sent, but that
    // silently failed to validate, doesn't vanish without a trace — it would
    // otherwise surface only as "why did my order come through as a guest?".
    if (err || !user) {
      this.logger.warn(
        `Optional auth: token present but invalid — falling back to guest. ${
          err instanceof Error ? err.message : String(err ?? 'no user')
        }`,
      );
    }
    return user;
  }
}
