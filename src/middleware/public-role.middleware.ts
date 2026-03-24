import type { NextFunction, Request, Response } from "express";
import type { PublicAccountType } from "@prisma/client";
import { AppError } from "../common/errors/AppError";
import { prisma } from "../prisma/client";

export function requirePublicRole(...roles: PublicAccountType[]) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return next(new AppError("Authentication required", 401, "UNAUTHORIZED"));
      }

      if (req.user.accountScope !== "PUBLIC") {
        return next(new AppError("Public account access required", 403, "FORBIDDEN"));
      }

      const account = await prisma.publicAccount.findUnique({
        where: { id: req.user.userId },
        select: {
          id: true,
          accountType: true,
          status: true
        }
      });

      if (!account || account.status === "DISABLED") {
        return next(new AppError("Public account not found", 401, "UNAUTHORIZED"));
      }

      const actualRole = String(account.accountType).toUpperCase() as PublicAccountType;
      const allowedRoles = roles.map((role) => String(role).toUpperCase());

      req.user.role = actualRole;

      if (!allowedRoles.includes(actualRole)) {
        return next(new AppError(`Insufficient permissions for ${actualRole}. Allowed roles: ${allowedRoles.join(", ")}`, 403, "FORBIDDEN"));
      }

      return next();
    } catch (error) {
      return next(error);
    }
  };
}
