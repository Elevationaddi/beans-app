import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { ErrorCode, ErrorResponse } from "@beans/contracts";
import { ApiError } from "./api-error.js";
import type { ApiRequest, ApiResponse } from "./request-context.js";

const DEFAULT_CODES: Partial<Record<number, ErrorCode>> = {
  400: "BAD_REQUEST",
  401: "UNAUTHENTICATED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  429: "RATE_LIMITED",
  503: "SERVICE_UNAVAILABLE",
};

/** Bodies that must reach the client unchanged (the health endpoint's 503). */
export class PassthroughHttpException extends HttpException {}

/**
 * Renders every error as `{ error: { code, message, fieldErrors?, requestId } }`.
 * Unexpected errors are logged with the request ID and answered with a generic 500, so
 * internal details and provider messages never reach the client.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger("HttpExceptionFilter");

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<ApiRequest>();
    const res = http.getResponse<ApiResponse>();
    const requestId = req.requestId ?? "unknown";

    if (exception instanceof PassthroughHttpException) {
      res.status(exception.getStatus()).json(exception.getResponse());
      return;
    }

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: ErrorResponse["error"];

    if (exception instanceof ApiError) {
      status = exception.getStatus();
      body = { code: exception.code, message: exception.message, requestId };
      if (exception.fieldErrors) body.fieldErrors = exception.fieldErrors;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      body = {
        code: DEFAULT_CODES[status] ?? (status >= 500 ? "INTERNAL_ERROR" : "BAD_REQUEST"),
        message: status >= 500 ? "Something went wrong" : exception.message,
        requestId,
      };
    } else {
      body = { code: "INTERNAL_ERROR", message: "Something went wrong", requestId };
    }

    if (status >= 500) {
      const detail =
        exception instanceof Error ? (exception.stack ?? exception.message) : String(exception);
      this.logger.error(`[${requestId}] ${req.method} ${req.url.split("?")[0]} failed: ${detail}`);
    }
    res.status(status).json({ error: body });
  }
}
