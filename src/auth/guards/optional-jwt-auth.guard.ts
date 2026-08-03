import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

// Same JWT verification as JwtAuthGuard, but never rejects the request: an
// absent or invalid token simply leaves `request.user` undefined instead of
// throwing 401. Used on routes that support both guest and signed-in access
// (e.g. checkout), where ownership/guest logic is decided in the service.
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }

  handleRequest<TUser = unknown>(_err: unknown, user: TUser): TUser {
    // No exception thrown for a missing/invalid token — `user` stays undefined.
    return user;
  }
}
