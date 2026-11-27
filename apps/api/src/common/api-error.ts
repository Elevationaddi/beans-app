import { HttpException, HttpStatus } from "@nestjs/common";
import type { ErrorCode } from "@beans/contracts";

/** An error with a stable machine-readable code from the API contract (docs/07). */
export class ApiError extends HttpException {
  constructor(
    status: HttpStatus,
    readonly code: ErrorCode,
    message: string,
    readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(message, status);
  }

  static unauthenticated(message = "A valid access token is required") {
    return new ApiError(HttpStatus.UNAUTHORIZED, "UNAUTHENTICATED", message);
  }

  static forbidden(message = "You do not have permission to do this") {
    return new ApiError(HttpStatus.FORBIDDEN, "FORBIDDEN", message);
  }

  /** Absent or outside the caller's scope. The two cases are indistinguishable on purpose. */
  static notFound(message = "Not found") {
    return new ApiError(HttpStatus.NOT_FOUND, "NOT_FOUND", message);
  }

  static validation(fieldErrors: Record<string, string[]>) {
    return new ApiError(
      HttpStatus.BAD_REQUEST,
      "VALIDATION_FAILED",
      "The request is not valid",
      fieldErrors,
    );
  }
}
