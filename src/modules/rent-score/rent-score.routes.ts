import { Router } from "express";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { AppError } from "../../common/errors/AppError";
import { writeAuditLog } from "../../common/audit/audit";
import { requireAuth } from "../../middleware/auth.middleware";
import { requireRole } from "../../middleware/role.middleware";
import { listPendingRenterInvites, resendPendingRenterInvite } from "../workspace/workspace.service";
import {
  createRentScoreRule,
  deleteRentScoreEvent,
  getAuthenticatedRenterScore,
  getRentScoreConfig,
  getRenterScoreDetails,
  listRenterScores,
  recordRentScoreEvent,
  updateRentScorePolicy,
  updateRentScoreRule
} from "./rent-score.service";

const router = Router();

const publicAccountStatusSchema = z.enum(["UNVERIFIED", "ACTIVE", "DISABLED"]);
const metadataSchema = z.record(z.string(), z.unknown()).optional();

function toJsonObject(value?: Record<string, unknown>) {
  return value as Prisma.JsonObject | undefined;
}

const policyUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    description: z.string().trim().max(400).nullable().optional(),
    minScore: z.number().int().min(0).max(900).optional(),
    maxScore: z.number().int().min(0).max(900).optional(),
    isActive: z.boolean().optional()
  })
  .refine((data) => data.minScore === undefined || data.maxScore === undefined || data.minScore < data.maxScore, {
    message: "minScore must be below maxScore"
  });

const ruleCreateSchema = z.object({
  code: z.string().trim().min(2).max(80),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(400).nullable().optional(),
  points: z.number().int().min(-900).max(900).refine((value) => value !== 0, {
    message: "Rule points cannot be zero"
  }),
  maxOccurrences: z.number().int().min(1).max(100).nullable().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  metadata: metadataSchema
});

const ruleUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(400).nullable().optional(),
  points: z.number().int().min(-900).max(900).refine((value) => value !== 0, {
    message: "Rule points cannot be zero"
  }).optional(),
  maxOccurrences: z.number().int().min(1).max(100).nullable().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  metadata: metadataSchema
});

const eventCreateSchema = z
  .object({
    ruleId: z.string().uuid().optional(),
    ruleCode: z.string().trim().min(2).max(80).optional(),
    quantity: z.number().int().min(1).max(100).optional(),
    occurredAt: z.coerce.date().optional(),
    sourceNote: z.string().trim().max(240).optional(),
    metadata: metadataSchema
  })
  .refine((data) => Boolean(data.ruleId || data.ruleCode), {
    message: "ruleId or ruleCode is required"
  });

router.get(
  "/admin/rent-score/config",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res, next) => {
    try {
      const config = await getRentScoreConfig();
      res.json(config);
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  "/admin/renter-invites",
  requireAuth,
  requireRole("ADMIN"),
  async (_req, res, next) => {
    try {
      const result = await listPendingRenterInvites();
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/admin/renter-invites/:proposedRenterId/remind",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res, next) => {
    try {
      const params = z.object({ proposedRenterId: z.string().uuid() }).parse(req.params);
      const result = await resendPendingRenterInvite({
        adminUserId: req.user!.userId,
        proposedRenterId: params.proposedRenterId
      });

      await writeAuditLog({
        req,
        action: "renter_invite.remind",
        entity: "ProposedRenter",
        entityId: params.proposedRenterId
      });

      res.json(result);
    } catch (error) {
      next(error instanceof z.ZodError ? new AppError(error.issues[0]?.message ?? "Invalid reminder request", 400, "VALIDATION_ERROR") : error);
    }
  }
);

router.patch(
  "/admin/rent-score/config",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res, next) => {
    try {
      const body = policyUpdateSchema.parse(req.body);
      const config = await updateRentScorePolicy(body);

      await writeAuditLog({
        req,
        action: "rent_score.policy.update",
        entity: "RentScorePolicy",
        entityId: config.id,
        meta: body
      });

      res.json(config);
    } catch (error) {
      next(error instanceof z.ZodError ? new AppError(error.issues[0]?.message ?? "Invalid payload", 400, "VALIDATION_ERROR") : error);
    }
  }
);

router.post(
  "/admin/rent-score/rules",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res, next) => {
    try {
      const body = ruleCreateSchema.parse(req.body);
      const config = await createRentScoreRule({
        ...body,
        metadata: toJsonObject(body.metadata)
      });

      await writeAuditLog({
        req,
        action: "rent_score.rule.create",
        entity: "RentScoreRule",
        meta: body
      });

      res.status(201).json(config);
    } catch (error) {
      next(error instanceof z.ZodError ? new AppError(error.issues[0]?.message ?? "Invalid payload", 400, "VALIDATION_ERROR") : error);
    }
  }
);

router.patch(
  "/admin/rent-score/rules/:ruleId",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res, next) => {
    try {
      const params = z.object({ ruleId: z.string().uuid() }).parse(req.params);
      const body = ruleUpdateSchema.parse(req.body);
      const config = await updateRentScoreRule(params.ruleId, {
        ...body,
        metadata: toJsonObject(body.metadata)
      });

      await writeAuditLog({
        req,
        action: "rent_score.rule.update",
        entity: "RentScoreRule",
        entityId: params.ruleId,
        meta: body
      });

      res.json(config);
    } catch (error) {
      next(error instanceof z.ZodError ? new AppError(error.issues[0]?.message ?? "Invalid payload", 400, "VALIDATION_ERROR") : error);
    }
  }
);

router.get(
  "/admin/rent-score/accounts",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res, next) => {
    try {
      const query = z
        .object({
          q: z.string().trim().optional(),
          status: publicAccountStatusSchema.optional()
        })
        .parse(req.query);

      const result = await listRenterScores(query);
      res.json(result);
    } catch (error) {
      next(error instanceof z.ZodError ? new AppError(error.issues[0]?.message ?? "Invalid query", 400, "VALIDATION_ERROR") : error);
    }
  }
);

router.get(
  "/admin/rent-score/accounts/:publicAccountId",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res, next) => {
    try {
      const params = z.object({ publicAccountId: z.string().uuid() }).parse(req.params);
      const snapshot = await getRenterScoreDetails(params.publicAccountId);
      res.json(snapshot);
    } catch (error) {
      next(error instanceof z.ZodError ? new AppError(error.issues[0]?.message ?? "Invalid request", 400, "VALIDATION_ERROR") : error);
    }
  }
);

router.post(
  "/admin/rent-score/accounts/:publicAccountId/events",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res, next) => {
    try {
      const params = z.object({ publicAccountId: z.string().uuid() }).parse(req.params);
      const body = eventCreateSchema.parse(req.body);
      const snapshot = await recordRentScoreEvent({
        publicAccountId: params.publicAccountId,
        ruleId: body.ruleId,
        ruleCode: body.ruleCode,
        quantity: body.quantity,
        occurredAt: body.occurredAt,
        recordedByUserId: req.user?.userId ?? null,
        sourceNote: body.sourceNote,
        metadata: toJsonObject(body.metadata)
      });

      await writeAuditLog({
        req,
        action: "rent_score.event.record",
        entity: "RentScoreEvent",
        entityId: params.publicAccountId,
        meta: body
      });

      res.status(201).json(snapshot);
    } catch (error) {
      next(error instanceof z.ZodError ? new AppError(error.issues[0]?.message ?? "Invalid payload", 400, "VALIDATION_ERROR") : error);
    }
  }
);

router.delete(
  "/admin/rent-score/events/:eventId",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res, next) => {
    try {
      const params = z.object({ eventId: z.string().uuid() }).parse(req.params);
      const snapshot = await deleteRentScoreEvent(params.eventId);

      await writeAuditLog({
        req,
        action: "rent_score.event.delete",
        entity: "RentScoreEvent",
        entityId: params.eventId
      });

      res.json(snapshot);
    } catch (error) {
      next(error instanceof z.ZodError ? new AppError(error.issues[0]?.message ?? "Invalid request", 400, "VALIDATION_ERROR") : error);
    }
  }
);

router.get("/rent-score/me", requireAuth, async (req, res, next) => {
  try {
    if (!req.user) {
      throw new AppError("Authentication required", 401, "UNAUTHORIZED");
    }

    if (String(req.user.role) !== "RENTER") {
      throw new AppError("Rent score is only available for renter accounts", 403, "FORBIDDEN");
    }

    const snapshot = await getAuthenticatedRenterScore(req.user.userId);
    res.json(snapshot);
  } catch (error) {
    next(error);
  }
});

export const rentScoreRoutes = router;
