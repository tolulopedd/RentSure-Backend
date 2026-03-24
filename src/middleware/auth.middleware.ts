import type { NextFunction, Request, Response } from "express";
import type { PublicAccountType, UserRole } from "@prisma/client";
import jwt from "jsonwebtoken";
import { AppError } from "../common/errors/AppError";
import { env } from "../config/env";

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.header("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;

  if (!token) {
    return next(new AppError("Missing authorization token", 401, "UNAUTHORIZED"));
  }

  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as {
      userId: string;
      role: string;
      accountScope?: "STAFF" | "PUBLIC";
      outletId?: string | null;
    };

    req.user = {
      userId: payload.userId,
      role: payload.role as UserRole | PublicAccountType,
      accountScope: payload.accountScope ?? "STAFF",
      outletId: payload.outletId ?? null
    };

    return next();
  } catch {
    return next(new AppError("Invalid or expired token", 401, "UNAUTHORIZED"));
  }
}
