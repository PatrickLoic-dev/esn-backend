import { Role } from '@prisma/client';

// Any non-customer account is "staff" and may see cross-user data
// (all orders, all tickets, etc.). Keeps scoping correct now that we have
// SUPER_ADMIN / ADMIN / MODERATOR / SUPPORT instead of a single ADMIN role.
// Accepts a string since JwtPayload.role is a plain string.
export function isStaff(role: Role | string): boolean {
  return role !== Role.CUSTOMER;
}
