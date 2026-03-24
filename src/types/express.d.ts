import type { PublicAccountType, UserRole } from "@prisma/client";

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      user?: {
        userId: string;
        role: UserRole | PublicAccountType;
        accountScope?: "STAFF" | "PUBLIC";
        outletId?: string | null;
      };
    }
  }
}

export {};
