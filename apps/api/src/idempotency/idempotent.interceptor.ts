import {
  applyDecorators,
  type CallHandler,
  type ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
  type NestInterceptor,
  UseInterceptors,
} from "@nestjs/common";
import { from, lastValueFrom, type Observable } from "rxjs";
import { ApiError } from "../common/api-error.js";
import type { ApiRequest, ApiResponse } from "../common/request-context.js";
import { IdempotencyService } from "./idempotency.service.js";

/**
 * Requires an Idempotency-Key header and makes the route replay-safe per actor
 * (docs/07: orders, payments, refunds, payouts and claims).
 */
export const Idempotent = () => applyDecorators(UseInterceptors(IdempotentInterceptor));

@Injectable()
export class IdempotentInterceptor implements NestInterceptor {
  constructor(@Inject(IdempotencyService) private readonly idempotency: IdempotencyService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<ApiRequest>();
    const res = http.getResponse<ApiResponse>();
    if (!req.actor) throw ApiError.unauthenticated();

    const header = req.headers["idempotency-key"];
    const key = this.idempotency.validateKey(Array.isArray(header) ? header[0] : header);
    const route = `${req.method} ${req.route?.path ?? req.url.split("?")[0]}`;

    return from(
      this.idempotency
        .run(
          { actorScope: `user:${req.actor.userId}`, route, key, body: req.body ?? null },
          async () => {
            const body = await lastValueFrom(next.handle(), { defaultValue: undefined });
            const status = req.method === "POST" ? HttpStatus.CREATED : HttpStatus.OK;
            return { status, body };
          },
        )
        .then((outcome) => {
          res.status(outcome.status);
          if (outcome.replayed) res.setHeader("Idempotent-Replayed", "true");
          return outcome.body;
        }),
    );
  }
}
