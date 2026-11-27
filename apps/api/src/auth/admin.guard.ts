import {
  applyDecorators,
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
  SetMetadata,
  UseGuards,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ApiError } from "../common/api-error.js";
import type { ApiRequest } from "../common/request-context.js";
import { PrismaService } from "../database/prisma.service.js";
import type { AdminRoleName } from "../generated/prisma/client.js";

const ADMIN_ROLES = "auth:adminRoles";

/**
 * Restricts a route to admins holding one of the listed roles, with an MFA (aal2) session.
 * There is no implicit super_admin bypass: list it explicitly where it applies, and never on
 * financial dual-control routes (docs/10-security.md).
 */
export const RequireAdmin = (...roles: [AdminRoleName, ...AdminRoleName[]]) =>
  applyDecorators(SetMetadata(ADMIN_ROLES, roles), UseGuards(AdminGuard));

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const allowed = this.reflector.getAllAndOverride<AdminRoleName[] | undefined>(ADMIN_ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!allowed || allowed.length === 0) {
      throw new Error("AdminGuard used without @RequireAdmin roles");
    }
    const actor = context.switchToHttp().getRequest<ApiRequest>().actor;
    if (!actor) throw ApiError.unauthenticated();

    // Roles are read from the database on every request, so revocation is immediate.
    const held = await this.prisma.adminRole.findMany({
      where: { userId: actor.userId, role: { in: allowed } },
      select: { role: true },
    });
    if (held.length === 0) throw ApiError.forbidden();
    if (actor.aal !== "aal2") {
      throw new ApiError(
        HttpStatus.FORBIDDEN,
        "MFA_REQUIRED",
        "Complete multi-factor authentication to use the admin console",
      );
    }
    return true;
  }
}
