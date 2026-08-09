import { Router } from "express";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { AppError } from "../../common/errors/AppError";
import { writeAuditLog } from "../../common/audit/audit";
import { requireAuth } from "../../middleware/auth.middleware";
import { requireRole } from "../../middleware/role.middleware";
import {
  listAdminLandlordAgentActivities,
  listAdminRenterActivities,
  listPendingRenterInvites,
  resendPendingRenterInvite
} from "../workspace/workspace.service";
import {
  createRentScoreOverride,
  deleteRentScoreCategory,
  deleteRentScoreOverride,
  deleteRentScoreEvent,
  deleteRentScoreRule,
  getAuthenticatedRenterScore,
  getRentScoreConfig,
  getRenterScoreDetails,
  listPendingIdentityReviews,
  listRentScoreRules,
  listRenterScores,
  recordRentScoreEvent,
  reviewIdentitySubmission,
  updateRentScoreCategory,
  updateRentScoreRule
} from "./rent-score.service";

const router = Router();

const publicAccountStatusSchema = z.enum(["UNVERIFIED", "ACTIVE", "DISABLED"]);
const metadataSchema = z.record(z.string(), z.unknown()).optional();

function toJsonObject(value?: Record<string, unknown>) {
  return value as Prisma.JsonObject | undefined;
}

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

const categoryUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  maxScore: z.number().int().min(0).max(900).optional()
});

const ruleUpdateSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  points: z.number().int().min(-900).max(900).optional()
});

const identityReviewActionSchema = z.object({
  action: z.enum(["APPROVE", "FAIL"]),
  comment: z.string().trim().max(500).optional()
});

router.get(
  "/admin/identity-reviews",
  requireAuth,
  requireRole("ADMIN"),
  async (_req, res, next) => {
    try {
      const result = await listPendingIdentityReviews();
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/admin/identity-reviews/:publicAccountId",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res, next) => {
    try {
      const params = z.object({ publicAccountId: z.string().uuid() }).parse(req.params);
      const body = identityReviewActionSchema.parse(req.body);
      const result = await reviewIdentitySubmission({
        publicAccountId: params.publicAccountId,
        reviewerUserId: req.user!.userId,
        action: body.action,
        comment: body.comment
      });

      await writeAuditLog({
        req,
        action: "identity.review",
        entity: "PublicAccount",
        entityId: params.publicAccountId,
        meta: body
      });

      res.json(result);
    } catch (error) {
      next(error instanceof z.ZodError ? new AppError(error.issues[0]?.message ?? "Invalid identity review payload", 400, "VALIDATION_ERROR") : error);
    }
  }
);

router.get(
  "/admin/rent-score/setup",
  requireAuth,
  requireRole("ADMIN"),
  async (_req, res, next) => {
    try {
      const result = await getRentScoreConfig();
      res.json(result);
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


router.get(
  "/admin/renter-activities",
  requireAuth,
  requireRole("ADMIN"),
  async (_req, res, next) => {
    try {
      const result = await listAdminRenterActivities();
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  "/admin/landlord-agent-activities",
  requireAuth,
  requireRole("ADMIN"),
  async (_req, res, next) => {
    try {
      const result = await listAdminLandlordAgentActivities();
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

const overrideCreateSchema = z.object({
  scope: z.enum(["BREAKDOWN_ITEM", "CATEGORY"]),
  targetCode: z.string().trim().min(2).max(120),
  note: z.string().trim().max(500).optional()
});

router.get(
  "/admin/rent-score/rules",
  requireAuth,
  requireRole("ADMIN"),
  async (_req, res, next) => {
    try {
      const result = await listRentScoreRules();
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

router.patch(
  "/admin/rent-score/setup/categories/:categoryId",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res, next) => {
    try {
      const params = z.object({ categoryId: z.string().uuid() }).parse(req.params);
      const body = categoryUpdateSchema.parse(req.body);
      const result = await updateRentScoreCategory(params.categoryId, body);

      await writeAuditLog({
        req,
        action: "rent_score.category.update",
        entity: "RentScoreCategoryConfig",
        entityId: params.categoryId,
        meta: body
      });

      res.json(result);
    } catch (error) {
      next(error instanceof z.ZodError ? new AppError(error.issues[0]?.message ?? "Invalid category payload", 400, "VALIDATION_ERROR") : error);
    }
  }
);

router.delete(
  "/admin/rent-score/setup/categories/:categoryId",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res, next) => {
    try {
      const params = z.object({ categoryId: z.string().uuid() }).parse(req.params);
      const result = await deleteRentScoreCategory(params.categoryId);

      await writeAuditLog({
        req,
        action: "rent_score.category.delete",
        entity: "RentScoreCategoryConfig",
        entityId: params.categoryId
      });

      res.json(result);
    } catch (error) {
      next(error instanceof z.ZodError ? new AppError(error.issues[0]?.message ?? "Invalid category delete request", 400, "VALIDATION_ERROR") : error);
    }
  }
);

router.patch(
  "/admin/rent-score/setup/rules/:ruleId",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res, next) => {
    try {
      const params = z.object({ ruleId: z.string().uuid() }).parse(req.params);
      const body = ruleUpdateSchema.parse(req.body);
      const result = await updateRentScoreRule(params.ruleId, body);

      await writeAuditLog({
        req,
        action: "rent_score.rule.update",
        entity: "RentScoreRule",
        entityId: params.ruleId,
        meta: body
      });

      res.json(result);
    } catch (error) {
      next(error instanceof z.ZodError ? new AppError(error.issues[0]?.message ?? "Invalid rule payload", 400, "VALIDATION_ERROR") : error);
    }
  }
);

router.delete(
  "/admin/rent-score/setup/rules/:ruleId",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res, next) => {
    try {
      const params = z.object({ ruleId: z.string().uuid() }).parse(req.params);
      const result = await deleteRentScoreRule(params.ruleId);

      await writeAuditLog({
        req,
        action: "rent_score.rule.delete",
        entity: "RentScoreRule",
        entityId: params.ruleId
      });

      res.json(result);
    } catch (error) {
      next(error instanceof z.ZodError ? new AppError(error.issues[0]?.message ?? "Invalid rule delete request", 400, "VALIDATION_ERROR") : error);
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

router.post(
  "/admin/rent-score/accounts/:publicAccountId/overrides",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res, next) => {
    try {
      const params = z.object({ publicAccountId: z.string().uuid() }).parse(req.params);
      const body = overrideCreateSchema.parse(req.body);
      const snapshot = await createRentScoreOverride({
        publicAccountId: params.publicAccountId,
        scope: body.scope,
        targetCode: body.targetCode,
        note: body.note,
        createdByUserId: req.user?.userId ?? null
      });

      await writeAuditLog({
        req,
        action: "rent_score.override.create",
        entity: "PublicAccount",
        entityId: params.publicAccountId,
        meta: body
      });

      res.status(201).json(snapshot);
    } catch (error) {
      next(error instanceof z.ZodError ? new AppError(error.issues[0]?.message ?? "Invalid override payload", 400, "VALIDATION_ERROR") : error);
    }
  }
);

router.delete(
  "/admin/rent-score/overrides/:overrideId",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res, next) => {
    try {
      const params = z.object({ overrideId: z.string().uuid() }).parse(req.params);
      const snapshot = await deleteRentScoreOverride(params.overrideId);

      await writeAuditLog({
        req,
        action: "rent_score.override.delete",
        entity: "RentScoreOverride",
        entityId: params.overrideId
      });

      res.json(snapshot);
    } catch (error) {
      next(error instanceof z.ZodError ? new AppError(error.issues[0]?.message ?? "Invalid override request", 400, "VALIDATION_ERROR") : error);
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
