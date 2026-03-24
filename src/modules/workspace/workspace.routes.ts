import { Router } from "express";
import { z } from "zod";
import { AppError } from "../../common/errors/AppError";
import { requireAuth } from "../../middleware/auth.middleware";
import { requirePublicRole } from "../../middleware/public-role.middleware";
import {
  commentOnWorkspaceProposedRenter,
  createWorkspacePaymentSchedule,
  createWorkspaceProperty,
  createWorkspaceProposedRenter,
  decideWorkspaceProposedRenter,
  forwardWorkspaceScoreRequest,
  getWorkspaceProfile,
  getWorkspaceOverview,
  getWorkspaceQueueItem,
  listWorkspaceProperties,
  listWorkspaceQueue,
  requestWorkspaceRentScore,
  saveWorkspacePassportPhoto,
  searchWorkspaceRenters,
  shareWorkspaceProperty,
  updateWorkspaceProfile,
  updateWorkspacePaymentSchedule
} from "./workspace.service";

const router = Router();

const propertySchema = z.object({
  name: z.string().trim().min(2).max(160),
  ownerName: z.string().trim().min(2).max(160),
  landlordEmail: z.string().email(),
  propertyType: z.enum(["Duplex", "Flats", "Self Contain", "Mansion", "Boys Quater"]),
  bedroomCount: z.number().int().min(1).max(100),
  bathroomCount: z.number().int().min(1).max(100),
  toiletCount: z.number().int().min(1).max(100),
  unitCount: z.number().int().min(1).max(500),
  units: z.array(
    z.object({
      label: z.string().trim().min(1).max(120),
      address: z.string().trim().min(5).max(240),
      state: z.string().trim().min(2).max(120),
      city: z.string().trim().min(2).max(120)
    })
  ).min(1).max(500)
});

const sharePropertySchema = z.object({
  sharedWithEmail: z.string().email()
});

const proposedRenterSchema = z.object({
  propertyId: z.string().uuid(),
  renterAccountId: z.string().uuid().optional(),
  firstName: z.string().trim().min(1).max(120),
  lastName: z.string().trim().min(1).max(120),
  organizationName: z.string().trim().max(160).optional(),
  email: z.string().email(),
  phone: z.string().trim().min(3).max(40),
  address: z.string().trim().max(240).optional(),
  state: z.string().trim().max(120).optional(),
  city: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(500).optional()
});

const rentScoreRequestSchema = z.object({
  notes: z.string().trim().max(500).optional()
});

const forwardScoreSchema = z.object({
  forwardToAccountId: z.string().uuid().optional()
});

const paymentTypeSchema = z.enum(["RENT", "UTILITY", "ESTATE_DUE"]);
const paymentStatusSchema = z.enum(["PENDING", "PAID", "OVERDUE"]);

const createPaymentScheduleSchema = z.object({
  paymentType: paymentTypeSchema,
  amountNgn: z.number().int().positive(),
  dueDate: z.coerce.date(),
  note: z.string().trim().max(500).optional(),
  recurrence: z
    .object({
      enabled: z.boolean(),
      frequency: z.enum(["MONTHLY", "QUARTERLY", "YEARLY"]).optional(),
      occurrences: z.number().int().min(1).max(24).optional()
    })
    .optional()
});

const updatePaymentScheduleSchema = z.object({
  status: paymentStatusSchema,
  paidAt: z.coerce.date().nullable().optional()
});

const decisionSchema = z.object({
  decision: z.enum(["APPROVED", "HOLD", "DECLINED"]),
  note: z.string().trim().max(500).optional()
});

const commentSchema = z.object({
  message: z.string().trim().min(2).max(500)
});

const updateProfileSchema = z.object({
  accountType: z.enum(["LANDLORD", "AGENT"]).optional(),
  representation: z.string().trim().max(120).optional().nullable(),
  firstName: z.string().trim().min(1).optional(),
  lastName: z.string().trim().min(1).optional(),
  organizationName: z.string().trim().optional().nullable(),
  registrationNumber: z.string().trim().max(120).optional().nullable(),
  phone: z.string().trim().min(3).optional(),
  state: z.string().trim().min(2).optional(),
  city: z.string().trim().min(2).optional(),
  address: z.string().trim().min(5).optional(),
  propertyCount: z.string().trim().max(80).optional().nullable(),
  portfolioType: z.string().trim().max(120).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable()
});

const passportPhotoSchema = z.object({
  objectKey: z.string().trim().min(10).max(500),
  fileName: z.string().trim().min(1).max(240),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  fileSize: z.number().int().positive()
});

router.use("/workspace", requireAuth, requirePublicRole("AGENT", "LANDLORD"));

router.get("/workspace/profile", async (req, res, next) => {
  try {
    const result = await getWorkspaceProfile(req.user!.userId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.patch("/workspace/profile", async (req, res, next) => {
  try {
    const body = updateProfileSchema.parse(req.body);
    const result = await updateWorkspaceProfile({
      publicAccountId: req.user!.userId,
      ...body
    });
    res.json(result);
  } catch (error) {
    next(error instanceof z.ZodError ? new AppError(error.issues[0]?.message ?? "Invalid workspace profile payload", 400, "VALIDATION_ERROR") : error);
  }
});

router.post("/workspace/profile/passport-photo", async (req, res, next) => {
  try {
    const body = passportPhotoSchema.parse(req.body);
    const result = await saveWorkspacePassportPhoto({
      publicAccountId: req.user!.userId,
      objectKey: body.objectKey,
      fileName: body.fileName,
      mimeType: body.mimeType,
      fileSize: body.fileSize
    });
    res.json(result);
  } catch (error) {
    next(error instanceof z.ZodError ? new AppError(error.issues[0]?.message ?? "Invalid workspace passport photo payload", 400, "VALIDATION_ERROR") : error);
  }
});

router.get("/workspace/overview", async (req, res, next) => {
  try {
    const result = await getWorkspaceOverview(req.user!.userId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/workspace/properties", async (req, res, next) => {
  try {
    const result = await listWorkspaceProperties(req.user!.userId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/workspace/properties", async (req, res, next) => {
  try {
    const body = propertySchema.parse(req.body);
    if (body.unitCount !== body.units.length) {
      throw new AppError("Number of units must match the number of unit address entries", 400, "VALIDATION_ERROR");
    }
    const result = await createWorkspaceProperty({
      publicAccountId: req.user!.userId,
      ...body
    });
    res.status(201).json(result);
  } catch (error) {
    next(error instanceof z.ZodError ? new AppError(error.issues[0]?.message ?? "Invalid property payload", 400, "VALIDATION_ERROR") : error);
  }
});

router.post("/workspace/properties/:propertyId/share", async (req, res, next) => {
  try {
    const params = z.object({ propertyId: z.string().uuid() }).parse(req.params);
    const body = sharePropertySchema.parse(req.body);
    const result = await shareWorkspaceProperty({
      publicAccountId: req.user!.userId,
      propertyId: params.propertyId,
      sharedWithEmail: body.sharedWithEmail
    });
    res.json(result);
  } catch (error) {
    next(error instanceof z.ZodError ? new AppError(error.issues[0]?.message ?? "Invalid share request", 400, "VALIDATION_ERROR") : error);
  }
});

router.get("/workspace/queue", async (req, res, next) => {
  try {
    const result = await listWorkspaceQueue(req.user!.userId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/workspace/renter-search", async (req, res, next) => {
  try {
    const query = z
      .object({
        propertyId: z.string().uuid(),
        q: z.string().trim().min(2)
      })
      .parse(req.query);
    const result = await searchWorkspaceRenters({
      publicAccountId: req.user!.userId,
      propertyId: query.propertyId,
      q: query.q
    });
    res.json(result);
  } catch (error) {
    next(error instanceof z.ZodError ? new AppError(error.issues[0]?.message ?? "Invalid renter search query", 400, "VALIDATION_ERROR") : error);
  }
});

router.get("/workspace/queue/:proposedRenterId", async (req, res, next) => {
  try {
    const params = z.object({ proposedRenterId: z.string().uuid() }).parse(req.params);
    const result = await getWorkspaceQueueItem(req.user!.userId, params.proposedRenterId);
    res.json(result);
  } catch (error) {
    next(error instanceof z.ZodError ? new AppError(error.issues[0]?.message ?? "Invalid queue request", 400, "VALIDATION_ERROR") : error);
  }
});

router.post("/workspace/queue", async (req, res, next) => {
  try {
    const body = proposedRenterSchema.parse(req.body);
    const result = await createWorkspaceProposedRenter({
      publicAccountId: req.user!.userId,
      ...body
    });
    res.status(201).json(result);
  } catch (error) {
    next(error instanceof z.ZodError ? new AppError(error.issues[0]?.message ?? "Invalid proposed renter payload", 400, "VALIDATION_ERROR") : error);
  }
});

router.post("/workspace/queue/:proposedRenterId/score-requests", async (req, res, next) => {
  try {
    const params = z.object({ proposedRenterId: z.string().uuid() }).parse(req.params);
    const body = rentScoreRequestSchema.parse(req.body);
    const result = await requestWorkspaceRentScore({
      publicAccountId: req.user!.userId,
      proposedRenterId: params.proposedRenterId,
      notes: body.notes
    });
    res.status(201).json(result);
  } catch (error) {
    next(error instanceof z.ZodError ? new AppError(error.issues[0]?.message ?? "Invalid rent score request", 400, "VALIDATION_ERROR") : error);
  }
});

router.post("/workspace/queue/:proposedRenterId/decision", async (req, res, next) => {
  try {
    const params = z.object({ proposedRenterId: z.string().uuid() }).parse(req.params);
    const body = decisionSchema.parse(req.body);
    const result = await decideWorkspaceProposedRenter({
      publicAccountId: req.user!.userId,
      proposedRenterId: params.proposedRenterId,
      decision: body.decision,
      note: body.note
    });
    res.json(result);
  } catch (error) {
    next(error instanceof z.ZodError ? new AppError(error.issues[0]?.message ?? "Invalid decision payload", 400, "VALIDATION_ERROR") : error);
  }
});

router.post("/workspace/queue/:proposedRenterId/comments", async (req, res, next) => {
  try {
    const params = z.object({ proposedRenterId: z.string().uuid() }).parse(req.params);
    const body = commentSchema.parse(req.body);
    const result = await commentOnWorkspaceProposedRenter({
      publicAccountId: req.user!.userId,
      proposedRenterId: params.proposedRenterId,
      message: body.message
    });
    res.status(201).json(result);
  } catch (error) {
    next(error instanceof z.ZodError ? new AppError(error.issues[0]?.message ?? "Invalid comment payload", 400, "VALIDATION_ERROR") : error);
  }
});

router.post("/workspace/score-requests/:scoreRequestId/forward", async (req, res, next) => {
  try {
    const params = z.object({ scoreRequestId: z.string().uuid() }).parse(req.params);
    const body = forwardScoreSchema.parse(req.body);
    const result = await forwardWorkspaceScoreRequest({
      publicAccountId: req.user!.userId,
      scoreRequestId: params.scoreRequestId,
      forwardToAccountId: body.forwardToAccountId
    });
    res.json(result);
  } catch (error) {
    next(error instanceof z.ZodError ? new AppError(error.issues[0]?.message ?? "Invalid forward request", 400, "VALIDATION_ERROR") : error);
  }
});

router.post("/workspace/queue/:proposedRenterId/payment-schedules", async (req, res, next) => {
  try {
    const params = z.object({ proposedRenterId: z.string().uuid() }).parse(req.params);
    const body = createPaymentScheduleSchema.parse(req.body);
    const result = await createWorkspacePaymentSchedule({
      publicAccountId: req.user!.userId,
      proposedRenterId: params.proposedRenterId,
      ...body
    });
    res.status(201).json(result);
  } catch (error) {
    next(error instanceof z.ZodError ? new AppError(error.issues[0]?.message ?? "Invalid payment schedule payload", 400, "VALIDATION_ERROR") : error);
  }
});

router.patch("/workspace/payment-schedules/:paymentScheduleId", async (req, res, next) => {
  try {
    const params = z.object({ paymentScheduleId: z.string().uuid() }).parse(req.params);
    const body = updatePaymentScheduleSchema.parse(req.body);
    const result = await updateWorkspacePaymentSchedule({
      publicAccountId: req.user!.userId,
      paymentScheduleId: params.paymentScheduleId,
      status: body.status,
      paidAt: body.paidAt
    });
    res.json(result);
  } catch (error) {
    next(error instanceof z.ZodError ? new AppError(error.issues[0]?.message ?? "Invalid payment schedule update", 400, "VALIDATION_ERROR") : error);
  }
});

export const workspaceRoutes = router;
