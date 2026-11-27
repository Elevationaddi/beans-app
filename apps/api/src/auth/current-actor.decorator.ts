import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import { ApiError } from "../common/api-error.js";
import type { Actor, ApiRequest } from "../common/request-context.js";

/** Injects the verified caller. Only valid on routes behind the AuthGuard. */
export const CurrentActor = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Actor => {
    const actor = context.switchToHttp().getRequest<ApiRequest>().actor;
    if (!actor) throw ApiError.unauthenticated();
    return actor;
  },
);

/** Injects the request ID for audit events. */
export const RequestId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string =>
    context.switchToHttp().getRequest<ApiRequest>().requestId,
);
