import type { Request } from "express";
import { prisma } from "../../prisma/client";
import { logger } from "../logger/logger";

type AuditInput = {
  req?: Request;
  action: string;
  entity: string;
  entityId?: string;
  meta?: unknown;
};

export async function writeAuditLog(input: AuditInput) {
  try {
    await prisma.auditLog.create({
      data: {
        requestId: input.req?.requestId ?? null,
        actorUserId: input.req?.user?.userId ?? null,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId ?? null,
        meta: input.meta ?? undefined
      }
    });
  } catch (error) {
    logger.error({ err: error, action: input.action, entity: input.entity }, "Failed to persist audit log");
  }
}
