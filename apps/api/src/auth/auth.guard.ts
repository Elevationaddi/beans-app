import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ApiError } from "../common/api-error.js";
import type { ApiRequest } from "../common/request-context.js";
import { IS_PUBLIC } from "./public.decorator.js";
import { TokenRejectedError, TokenVerifier } from "./token-verifier.js";
import { UsersService } from "./users.service.js";

/**
 * Global guard: deny by default. Every route needs a valid bearer token unless marked
 * @Public(). The user's status is read from the database on every request, so suspension
 * takes effect immediately.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(TokenVerifier) private readonly verifier: TokenVerifier,
    @Inject(UsersService) private readonly users: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<ApiRequest>();
    const header = req.headers["authorization"];
    const value = Array.isArray(header) ? header[0] : header;
    const match = value?.match(/^Bearer ([A-Za-z0-9._~+/=-]+)$/);
    if (!match?.[1]) throw ApiError.unauthenticated();

    let token;
    try {
      token = await this.verifier.verify(match[1]);
    } catch (error) {
      if (error instanceof TokenRejectedError) throw ApiError.unauthenticated();
      throw error;
    }

    const user = await this.users.resolve(token);
    if (user.status !== "active") {
      throw new ApiError(HttpStatus.FORBIDDEN, "ACCOUNT_SUSPENDED", "This account is not active");
    }
    req.actor = {
      userId: user.id,
      authSubject: user.authSubject,
      aal: token.aal,
      locale: user.locale,
    };
    return true;
  }
}
