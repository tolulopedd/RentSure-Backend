import { Router } from "express";
import { z } from "zod";
import { AppError } from "../../common/errors/AppError";
import { requireAuth } from "../../middleware/auth.middleware";
import { requirePublicRole } from "../../middleware/public-role.middleware";
import {
  confirmRenterPayment,
  getRenterDashboard,
  saveRenterPassportPhoto,
  searchRenterShareRecipients,
  shareRenterScoreReport,
  updateRenterProfile,
  verifyRenterIdentity
} from "./renter.service";

const router = Router();

router.use("/renter", requireAuth, requirePublicRole("RENTER"));

const updateProfileSchema = z.object({
  firstName: z.string().trim().min(1).optional(),
  lastName: z.string().trim().min(1).optional(),
  organizationName: z.string().trim().optional().nullable(),
  registrationNumber: z.string().trim().max(120).optional().nullable(),
  phone: z.string().trim().min(3).optional(),
  state: z.string().trim().min(2).optional(),
  city: z.string().trim().min(2).optional(),
  address: z.string().trim().min(5).optional(),
  notes: z.string().trim().max(500).optional().nullable()
});

const identitySchema = z.object({
  verificationType: z.enum(["NIN", "BVN"]),
  value: z.string().trim().min(11).max(20)
});

const confirmPaymentSchema = z.object({
  receiptReference: z.string().trim().max(120).optional(),
  note: z.string().trim().max(500).optional()
});

const shareReportSchema = z.object({
  recipientEmail: z.string().trim().email().toLowerCase(),
  recipientType: z.enum(["LANDLORD", "AGENT"]),
  recipientFirstName: z.string().trim().min(1).optional(),
  recipientLastName: z.string().trim().min(1).optional(),
  recipientPhone: z.string().trim().min(3).optional(),
  note: z.string().trim().max(500).optional()
});

const passportPhotoSchema = z.object({
  objectKey: z.string().trim().min(10).max(500),
  fileName: z.string().trim().min(1).max(240),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  fileSize: z.number().int().positive()
});

router.get("/renter/dashboard", async (req, res, next) => {
  try {
    const result = await getRenterDashboard(req.user!.userId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.patch("/renter/profile", async (req, res, next) => {
  try {
    const body = updateProfileSchema.parse(req.body);
    const result = await updateRenterProfile({
      publicAccountId: req.user!.userId,
      ...body
    });
    res.json(result);
  } catch (error) {
    next(error instanceof z.ZodError ? new AppError(error.issues[0]?.message ?? "Invalid profile payload", 400, "VALIDATION_ERROR") : error);
  }
});

router.post("/renter/profile/passport-photo", async (req, res, next) => {
  try {
    const body = passportPhotoSchema.parse(req.body);
    const result = await saveRenterPassportPhoto({
      publicAccountId: req.user!.userId,
      objectKey: body.objectKey,
      fileName: body.fileName,
      mimeType: body.mimeType,
      fileSize: body.fileSize
    });
    res.json(result);
  } catch (error) {
    next(error instanceof z.ZodError ? new AppError(error.issues[0]?.message ?? "Invalid passport photo payload", 400, "VALIDATION_ERROR") : error);
  }
});

router.post("/renter/identity", async (req, res, next) => {
  try {
    const body = identitySchema.parse(req.body);
    const result = await verifyRenterIdentity({
      publicAccountId: req.user!.userId,
      verificationType: body.verificationType,
      value: body.value
    });
    res.json(result);
  } catch (error) {
    next(error instanceof z.ZodError ? new AppError(error.issues[0]?.message ?? "Invalid identity payload", 400, "VALIDATION_ERROR") : error);
  }
});

router.post("/renter/payment-schedules/:paymentScheduleId/confirm", async (req, res, next) => {
  try {
    const params = z.object({ paymentScheduleId: z.string().uuid() }).parse(req.params);
    const body = confirmPaymentSchema.parse(req.body);
    const result = await confirmRenterPayment({
      publicAccountId: req.user!.userId,
      paymentScheduleId: params.paymentScheduleId,
      receiptReference: body.receiptReference,
      note: body.note
    });
    res.json(result);
  } catch (error) {
    next(error instanceof z.ZodError ? new AppError(error.issues[0]?.message ?? "Invalid payment confirmation", 400, "VALIDATION_ERROR") : error);
  }
});

router.post("/renter/share-report", async (req, res, next) => {
  try {
    const body = shareReportSchema.parse(req.body);
    const result = await shareRenterScoreReport({
      publicAccountId: req.user!.userId,
      recipientEmail: body.recipientEmail,
      recipientType: body.recipientType,
      recipientFirstName: body.recipientFirstName,
      recipientLastName: body.recipientLastName,
      recipientPhone: body.recipientPhone,
      note: body.note
    });
    res.json(result);
  } catch (error) {
    next(error instanceof z.ZodError ? new AppError(error.issues[0]?.message ?? "Invalid score share request", 400, "VALIDATION_ERROR") : error);
  }
});

router.get("/renter/share-recipient-search", async (req, res, next) => {
  try {
    const query = z
      .object({
        recipientType: z.enum(["LANDLORD", "AGENT"]),
        q: z.string().trim().min(2)
      })
      .parse(req.query);

    const result = await searchRenterShareRecipients({
      publicAccountId: req.user!.userId,
      recipientType: query.recipientType,
      q: query.q
    });
    res.json(result);
  } catch (error) {
    next(error instanceof z.ZodError ? new AppError(error.issues[0]?.message ?? "Invalid share recipient search query", 400, "VALIDATION_ERROR") : error);
  }
});

export const renterRoutes = router;
