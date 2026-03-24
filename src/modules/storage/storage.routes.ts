import { Router } from "express";
import { z } from "zod";
import { AppError } from "../../common/errors/AppError";
import { requireAuth } from "../../middleware/auth.middleware";
import { requirePublicRole } from "../../middleware/public-role.middleware";
import { createPublicDocumentUploadIntent, saveLocalPublicDocumentUpload } from "./storage.service";

const router = Router();

const documentTypeSchema = z.enum([
  "PASSPORT_PHOTO",
  "IDENTITY_DOCUMENT",
  "EMPLOYMENT_DOCUMENT",
  "PAYSLIP",
  "UTILITY_BILL",
  "PAYMENT_RECEIPT",
  "OTHER"
]);

router.use("/storage", requireAuth, requirePublicRole("RENTER", "LANDLORD", "AGENT"));

router.post("/storage/public-account-documents/presign", async (req, res, next) => {
  try {
    const body = z
      .object({
        documentType: documentTypeSchema,
        fileName: z.string().trim().min(1).max(240),
        contentType: z.string().trim().min(3).max(120),
        fileSize: z.number().int().positive()
      })
      .parse(req.body);

    const result = await createPublicDocumentUploadIntent({
      publicAccountId: req.user!.userId,
      documentType: body.documentType,
      fileName: body.fileName,
      contentType: body.contentType,
      fileSize: body.fileSize
    });

    res.status(201).json(result);
  } catch (error) {
    next(
      error instanceof z.ZodError
        ? new AppError(error.issues[0]?.message ?? "Invalid document upload request", 400, "VALIDATION_ERROR")
        : error
    );
  }
});

router.post("/storage/public-account-documents/local-upload", async (req, res, next) => {
  try {
    const body = z
      .object({
        documentType: documentTypeSchema,
        fileName: z.string().trim().min(1).max(240),
        contentType: z.string().trim().min(3).max(120),
        fileSize: z.number().int().positive(),
        base64Data: z.string().trim().min(20)
      })
      .parse(req.body);

    const result = await saveLocalPublicDocumentUpload({
      publicAccountId: req.user!.userId,
      documentType: body.documentType,
      fileName: body.fileName,
      contentType: body.contentType,
      fileSize: body.fileSize,
      base64Data: body.base64Data
    });

    res.status(201).json(result);
  } catch (error) {
    next(
      error instanceof z.ZodError
        ? new AppError(error.issues[0]?.message ?? "Invalid local document upload request", 400, "VALIDATION_ERROR")
        : error
    );
  }
});

export const storageRoutes = router;
