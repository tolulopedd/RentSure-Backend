import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { AppError } from "../common/errors/AppError";
import { logger } from "../common/logger/logger";

export function errorMiddleware(err: unknown, req: Request, res: Response, _next: NextFunction) {
  const payloadTooLarge = typeof err === "object" && err !== null && "status" in err && (err as { status?: number }).status === 413;
  const zodError = err instanceof ZodError ? err : null;
  const appError = err instanceof AppError ? err : null;
  const status = appError?.statusCode ?? (zodError ? 400 : payloadTooLarge ? 413 : 500);
  const code = appError?.code ?? (zodError ? "VALIDATION_ERROR" : payloadTooLarge ? "PAYLOAD_TOO_LARGE" : "INTERNAL_SERVER_ERROR");
  const message = appError?.message ?? (zodError ? "Validation failed" : payloadTooLarge ? "Request payload is too large" : "Unexpected error");

  logger.error(
    {
      requestId: req.requestId,
      status,
      code,
      err
    },
    "Request failed"
  );

  return res.status(status).json({
    error: {
      code,
      message,
      requestId: req.requestId ?? null,
      ...(appError?.details
        ? { details: appError.details }
        : zodError
        ? {
            details: {
              formErrors: zodError.flatten().formErrors,
              fieldErrors: zodError.flatten().fieldErrors
            }
          }
        : {})
    }
  });
}
