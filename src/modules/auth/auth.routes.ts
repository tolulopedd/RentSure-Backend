import { Router } from "express";
import { z } from "zod";
import { AppError } from "../../common/errors/AppError";
import {
  changeStaffPassword,
  completePublicAccountSignup,
  getStaffProfile,
  loginWithPassword,
  logout,
  requestPasswordReset,
  resendPublicAccountVerification,
  rotateRefreshToken,
  signupPublicAccount,
  updateStaffProfile,
  verifyPublicAccountEmail
} from "./auth.service";
import { writeAuditLog } from "../../common/audit/audit";
import { requireAuth } from "../../middleware/auth.middleware";

const router = Router();

const publicAccountTypeSchema = z.enum(["RENTER", "LANDLORD", "AGENT"]);
const publicEntityTypeSchema = z.enum(["INDIVIDUAL", "COMPANY"]);
const strongPasswordSchema = z
  .string()
  .min(10)
  .regex(/[A-Z]/, "Password must include at least one uppercase letter")
  .regex(/[a-z]/, "Password must include at least one lowercase letter")
  .regex(/\d/, "Password must include at least one number")
  .regex(/[^A-Za-z0-9]/, "Password must include at least one special character");

function requireStaffScope(req: Parameters<typeof requireAuth>[0]) {
  if (!req.user || req.user.accountScope !== "STAFF") {
    throw new AppError("This action is only available to staff users", 403, "FORBIDDEN");
  }
}

router.post("/auth/signup", async (req, res, next) => {
  try {
    const body = z
      .object({
        accountType: publicAccountTypeSchema,
        entityType: publicEntityTypeSchema.optional(),
        representation: z.string().min(1).optional(),
        firstName: z.string().min(1),
        lastName: z.string().min(1),
        organizationName: z.string().min(1).optional(),
        registrationNumber: z.string().min(1).optional(),
        email: z.string().email(),
        phone: z.string().min(1),
        state: z.string().min(1).optional(),
        city: z.string().min(1).optional(),
        address: z.string().min(1).optional(),
        propertyCount: z.string().min(1).optional(),
        portfolioType: z.string().min(1).optional(),
        notes: z.string().optional()
      })
      .parse(req.body);

    if (body.accountType === "RENTER" && body.representation) {
      throw new AppError("Renter signup cannot include landlord or agent representation", 400, "VALIDATION_ERROR");
    }

    if (body.accountType === "LANDLORD" && body.representation && body.representation !== "LANDLORD") {
      throw new AppError("Landlord signup must use landlord representation", 400, "VALIDATION_ERROR");
    }

    if (body.accountType === "AGENT" && body.representation === "LANDLORD") {
      throw new AppError("Agent signup must be tied to landlord representation or management company", 400, "VALIDATION_ERROR");
    }

    const result = await signupPublicAccount(body);

    await writeAuditLog({
      req,
        action: "auth.signup",
        entity: "PublicAccount",
        meta: {
          email: result.email,
          accountType: body.accountType,
          entityType: body.entityType ?? "INDIVIDUAL"
        }
      });

    res.status(201).json(result);
  } catch (error) {
    next(
      error instanceof z.ZodError
        ? new AppError(error.issues[0]?.message ?? "Invalid signup payload", 400, "VALIDATION_ERROR")
        : error
    );
  }
});

router.post("/auth/login", async (req, res, next) => {
  try {
    const body = z
      .object({
        email: z.string().email(),
        password: z.string().min(8)
      })
      .parse(req.body);

    const result = await loginWithPassword(body.email, body.password);

    await writeAuditLog({
      req,
      action: "auth.login",
      entity: "User",
      entityId: result.user.id,
      meta: { email: result.user.email }
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/auth/verify-email", async (req, res, next) => {
  try {
    const query = z
      .object({
        token: z.string().min(20)
      })
      .parse(req.query);

    const result = await verifyPublicAccountEmail(query.token);

    await writeAuditLog({
      req,
      action: "auth.verify_email",
      entity: "PublicAccount",
      meta: {
        email: result.email
      }
    });

    res.json(result);
  } catch (error) {
    next(error instanceof z.ZodError ? new AppError("Invalid verification token", 400, "VALIDATION_ERROR") : error);
  }
});

router.post("/auth/complete-signup", async (req, res, next) => {
  try {
    const body = z
      .object({
        token: z.string().min(20),
        password: strongPasswordSchema
      })
      .parse(req.body);

    const result = await completePublicAccountSignup({
      rawToken: body.token,
      password: body.password
    });

    await writeAuditLog({
      req,
      action: "auth.signup_complete",
      entity: "PublicAccount",
      meta: {
        email: result.email
      }
    });

    res.json(result);
  } catch (error) {
    next(error instanceof z.ZodError ? new AppError(error.issues[0]?.message ?? "Invalid signup completion payload", 400, "VALIDATION_ERROR") : error);
  }
});

router.post("/auth/request-password-reset", async (req, res, next) => {
  try {
    const body = z
      .object({
        email: z.string().trim().email()
      })
      .parse(req.body);

    const result = await requestPasswordReset(body.email);
    res.json(result);
  } catch (error) {
    next(error instanceof z.ZodError ? new AppError("Invalid password reset request", 400, "VALIDATION_ERROR") : error);
  }
});

router.post("/auth/resend-verification", async (req, res, next) => {
  try {
    const body = z
      .object({
        email: z.string().trim().email()
      })
      .parse(req.body);

    const result = await resendPublicAccountVerification(body.email);
    res.json(result);
  } catch (error) {
    next(error instanceof z.ZodError ? new AppError("Invalid resend verification request", 400, "VALIDATION_ERROR") : error);
  }
});

router.post("/auth/refresh", async (req, res, next) => {
  try {
    const body = z
      .object({
        refreshToken: z.string().min(10)
      })
      .parse(req.body);

    const result = await rotateRefreshToken(body.refreshToken);
    res.json(result);
  } catch (error) {
    next(error instanceof z.ZodError ? new AppError("Invalid refresh payload", 400, "VALIDATION_ERROR") : error);
  }
});

router.post("/auth/logout", async (req, res, next) => {
  try {
    const body = z
      .object({
        refreshToken: z.string().min(10)
      })
      .parse(req.body);

    await logout(body.refreshToken);

    await writeAuditLog({
      req,
      action: "auth.logout",
      entity: "User"
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.get("/auth/me", requireAuth, async (req, res, next) => {
  try {
    requireStaffScope(req);
    const profile = await getStaffProfile(req.user!.userId);
    res.json(profile);
  } catch (error) {
    next(error);
  }
});

router.patch("/auth/me", requireAuth, async (req, res, next) => {
  try {
    requireStaffScope(req);
    const body = z
      .object({
        fullName: z.string().trim().min(2),
        email: z.string().trim().email(),
        locationLabel: z.string().trim().max(120).optional().nullable()
      })
      .parse(req.body);

    const profile = await updateStaffProfile({
      userId: req.user!.userId,
      fullName: body.fullName,
      email: body.email,
      locationLabel: body.locationLabel
    });

    await writeAuditLog({
      req,
      action: "auth.profile.update",
      entity: "User",
      entityId: req.user!.userId,
      meta: {
        fullName: profile.fullName,
        email: profile.email,
        locationLabel: profile.locationLabel
      }
    });

    res.json(profile);
  } catch (error) {
    next(error instanceof z.ZodError ? new AppError(error.issues[0]?.message ?? "Invalid profile payload", 400, "VALIDATION_ERROR") : error);
  }
});

router.post("/auth/change-password", requireAuth, async (req, res, next) => {
  try {
    requireStaffScope(req);
    const body = z
      .object({
        currentPassword: z.string().min(1),
        newPassword: strongPasswordSchema
      })
      .parse(req.body);

    const result = await changeStaffPassword({
      userId: req.user!.userId,
      currentPassword: body.currentPassword,
      newPassword: body.newPassword
    });

    await writeAuditLog({
      req,
      action: "auth.password.change",
      entity: "User",
      entityId: req.user!.userId
    });

    res.json(result);
  } catch (error) {
    next(error instanceof z.ZodError ? new AppError(error.issues[0]?.message ?? "Invalid password payload", 400, "VALIDATION_ERROR") : error);
  }
});

export const authRoutes = router;
