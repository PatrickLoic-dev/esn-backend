import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { JwtPayload } from '../decorators/current-user.decorator';
import { isStaff } from '../roles.util';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }
    const { user } = context
      .switchToHttp()
      .getRequest<{ user: JwtPayload }>();

    // SUPER_ADMIN is a superset of every staff role.
    if (user?.role === Role.SUPER_ADMIN) {
      return true;
    }

    // The admin panel is role-gated on the CLIENT (modules are hidden per
    // permission). The API must not block staff by role — otherwise a
    // Moderator/Support can't load anything. So @Roles(ADMIN) means
    // "any staff member". Only non-ADMIN role requirements stay strict.
    if (requiredRoles.includes(Role.ADMIN) && user?.role && isStaff(user.role)) {
      return true;
    }

    return requiredRoles.some((role) => user?.role === role);
  }
}
