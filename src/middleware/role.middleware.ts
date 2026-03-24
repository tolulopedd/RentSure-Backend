import type { NextFunction, Request, Response } from "express";
import type { UserRole } from "@prisma/client";
import { AppError } from "../common/errors/AppError";

export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new AppError("Authentication required", 401, "UNAUTHORIZED"));
    }

    if (req.user.accountScope !== "STAFF") {
      return next(new AppError("Insufficient permissions", 403, "FORBIDDEN"));
    }

    if (!roles.includes(req.user.role as UserRole)) {
      return next(new AppError("Insufficient permissions", 403, "FORBIDDEN"));
    }

    return next();
  };
}
