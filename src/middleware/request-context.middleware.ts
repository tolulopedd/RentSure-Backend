import type { NextFunction, Request, Response } from "express";
import { randomUUID } from "crypto";

export function requestContextMiddleware(req: Request, res: Response, next: NextFunction) {
  const incoming = req.header("x-request-id")?.trim();
  const requestId = incoming || randomUUID();
  req.requestId = requestId;
  res.setHeader("x-request-id", requestId);
  next();
}
