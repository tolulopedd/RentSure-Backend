import { Router } from "express";
import { z } from "zod";
import { AppError } from "../../common/errors/AppError";
import { getMailPreview, listMailPreviews, renderMailPreviewDocument } from "./mail-preview.service";

const router = Router();

function ensurePreviewEnabled() {
  if (process.env.NODE_ENV === "production") {
    throw new AppError("Mail preview is not available in production", 404, "NOT_FOUND");
  }
}

router.get("/dev/mail-previews", (req, res, next) => {
  try {
    ensurePreviewEnabled();
    const query = z
      .object({
        email: z.string().trim().email().optional(),
        category: z
          .enum(["EMAIL_VERIFICATION", "RENTER_INVITE", "RENTER_NOTIFICATION", "RENTER_SHARE_REPORT", "PASSWORD_RESET"])
          .optional(),
        limit: z.coerce.number().int().min(1).max(50).optional()
      })
      .parse(req.query);
    res.json(listMailPreviews(query));
  } catch (error) {
    next(error instanceof z.ZodError ? new AppError("Invalid mail preview query", 400, "VALIDATION_ERROR") : error);
  }
});

router.get("/dev/mail-previews/:previewId", (req, res, next) => {
  try {
    ensurePreviewEnabled();
    const params = z.object({ previewId: z.string().uuid() }).parse(req.params);
    const record = getMailPreview(params.previewId);
    if (!record) {
      throw new AppError("Mail preview not found", 404, "MAIL_PREVIEW_NOT_FOUND");
    }

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(renderMailPreviewDocument(record));
  } catch (error) {
    next(error instanceof z.ZodError ? new AppError("Invalid mail preview request", 400, "VALIDATION_ERROR") : error);
  }
});

export const mailPreviewRoutes = router;
