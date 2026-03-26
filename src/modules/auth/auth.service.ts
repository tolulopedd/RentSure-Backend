import bcrypt from "bcryptjs";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import type { PublicAccount, PublicAccountType, User } from "@prisma/client";
import type { Secret, SignOptions } from "jsonwebtoken";
import { prisma } from "../../prisma/client";
import { env } from "../../config/env";
import { AppError } from "../../common/errors/AppError";
import { logger } from "../../common/logger/logger";
import { ensureRegistrationRentScoreEvent } from "../rent-score/rent-score.service";
import { createMailPreview } from "../mail-preview/mail-preview.service";
import { sendTransactionalMail } from "../mail/mail.service";

type AccountScope = "STAFF" | "PUBLIC";

type AuthTokenPayload = {
  userId: string;
  role: string;
  outletId?: string | null;
  accountScope: AccountScope;
};

type PublicSignupInput = {
  accountType: PublicAccountType;
  entityType?: "INDIVIDUAL" | "COMPANY";
  representation?: string;
  firstName: string;
  lastName: string;
  organizationName?: string;
  registrationNumber?: string;
  email: string;
  phone: string;
  state?: string;
  city?: string;
  address?: string;
  propertyCount?: string;
  portfolioType?: string;
  notes?: string;
};

const accessTokenTtl = env.JWT_ACCESS_EXPIRES_IN as SignOptions["expiresIn"];
const refreshTokenTtl = env.JWT_REFRESH_EXPIRES_IN as SignOptions["expiresIn"];

function signAccessToken(payload: AuthTokenPayload) {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET as Secret, { expiresIn: accessTokenTtl });
}

function signRefreshToken(payload: AuthTokenPayload) {
  return jwt.sign(payload, env.JWT_REFRESH_SECRET as Secret, { expiresIn: refreshTokenTtl });
}

function decodeExpiry(token: string) {
  const decoded = jwt.decode(token) as { exp?: number } | null;
  if (!decoded?.exp) throw new AppError("Unable to decode token expiry", 500, "TOKEN_ERROR");
  return new Date(decoded.exp * 1000);
}

function hashVerificationToken(rawToken: string) {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

function verificationExpiryDate() {
  return new Date(Date.now() + env.EMAIL_VERIFICATION_EXPIRES_HOURS * 60 * 60 * 1000);
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function publicAccountDisplayName(account: Pick<PublicAccount, "firstName" | "lastName" | "organizationName">) {
  if (account.organizationName?.trim()) return account.organizationName.trim();
  return `${account.firstName} ${account.lastName}`.trim();
}

async function storeStaffRefreshToken(userId: string, refreshToken: string) {
  const tokenHash = await bcrypt.hash(refreshToken, 10);
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash,
      expiresAt: decodeExpiry(refreshToken)
    }
  });
}

async function storePublicRefreshToken(publicAccountId: string, refreshToken: string) {
  const tokenHash = await bcrypt.hash(refreshToken, 10);
  await prisma.publicRefreshToken.create({
    data: {
      publicAccountId,
      tokenHash,
      expiresAt: decodeExpiry(refreshToken)
    }
  });
}

async function issueVerificationToken(publicAccountId: string) {
  await prisma.emailVerificationToken.deleteMany({
    where: {
      publicAccountId,
      consumedAt: null
    }
  });

  const rawToken = crypto.randomBytes(32).toString("hex");
  const expiresAt = verificationExpiryDate();

  await prisma.emailVerificationToken.create({
    data: {
      publicAccountId,
      tokenHash: hashVerificationToken(rawToken),
      expiresAt
    }
  });

  return {
    rawToken,
    expiresAt
  };
}

async function createPendingPasswordHash() {
  return bcrypt.hash(crypto.randomBytes(32).toString("hex"), 12);
}

function buildVerificationUrl(rawToken: string) {
  const base = env.APP_WEB_BASE_URL.replace(/\/+$/, "");
  return `${base}/verify-email?token=${encodeURIComponent(rawToken)}`;
}

async function sendVerificationLink(email: string, verificationUrl: string) {
  const subject = "Verify your email and finish your RentSure signup";
  const html = `
      <div style="font-family: Arial, sans-serif; color: #0f172a;">
        <p style="font-size: 14px; color: #475569;">Hello,</p>
        <p style="font-size: 14px; line-height: 1.7; color: #334155;">
          Your RentSure signup has started successfully. Use the button below to verify your email and set your password.
        </p>
        <p style="margin: 28px 0;">
          <a href="${verificationUrl}" style="display: inline-block; border-radius: 12px; background: #1d4ed8; color: white; padding: 12px 18px; text-decoration: none; font-weight: 600;">
            Verify email and continue
          </a>
        </p>
        <p style="font-size: 13px; line-height: 1.7; color: #475569;">
          If the button does not work, use this link:<br />
          <a href="${verificationUrl}" style="color: #1d4ed8;">${verificationUrl}</a>
        </p>
      </div>
    `;
  const delivery = await sendTransactionalMail({
    category: "EMAIL_VERIFICATION",
    to: email,
    subject,
    html
  });

  logger.info(
    {
      event: "auth.email_verification",
      email,
      verificationUrl,
      previewUrl: delivery.previewUrl || null,
      deliveryMode: delivery.deliveryMode
    },
    "Email verification link generated"
  );

  return delivery;
}

async function createStaffSession(user: User) {
  const accessToken = signAccessToken({
    userId: user.id,
    role: user.role,
    accountScope: "STAFF"
  });
  const refreshToken = signRefreshToken({
    userId: user.id,
    role: user.role,
    accountScope: "STAFF"
  });

  await storeStaffRefreshToken(user.id, refreshToken);

  return {
    accessToken,
    refreshToken,
    accountScope: "STAFF" as const,
    user: {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      outletId: null,
      outletName: null
    }
  };
}

async function createPublicSession(account: PublicAccount) {
  const role = account.accountType;
  const accessToken = signAccessToken({
    userId: account.id,
    role,
    accountScope: "PUBLIC"
  });
  const refreshToken = signRefreshToken({
    userId: account.id,
    role,
    accountScope: "PUBLIC"
  });

  await storePublicRefreshToken(account.id, refreshToken);

  return {
    accessToken,
    refreshToken,
    accountScope: "PUBLIC" as const,
    user: {
      id: account.id,
      fullName: publicAccountDisplayName(account),
      email: account.email,
      role,
      outletId: null,
      outletName: null
    }
  };
}

async function findStoredStaffRefreshToken(userId: string, rawRefreshToken: string) {
  const candidates = await prisma.refreshToken.findMany({
    where: {
      userId,
      revokedAt: null,
      expiresAt: { gt: new Date() }
    },
    orderBy: { createdAt: "desc" },
    take: 8
  });

  for (const row of candidates) {
    const match = await bcrypt.compare(rawRefreshToken, row.tokenHash);
    if (match) return row;
  }

  return null;
}

async function findStoredPublicRefreshToken(publicAccountId: string, rawRefreshToken: string) {
  const candidates = await prisma.publicRefreshToken.findMany({
    where: {
      publicAccountId,
      revokedAt: null,
      expiresAt: { gt: new Date() }
    },
    orderBy: { createdAt: "desc" },
    take: 8
  });

  for (const row of candidates) {
    const match = await bcrypt.compare(rawRefreshToken, row.tokenHash);
    if (match) return row;
  }

  return null;
}

async function authenticateStaffUser(email: string, password: string) {
  const user = await prisma.user.findUnique({
    where: { email }
  });

  if (!user || user.status === "DISABLED") return null;

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return null;

  return user;
}

async function authenticatePublicAccount(email: string, password: string) {
  const account = await prisma.publicAccount.findUnique({
    where: { email }
  });

  if (!account || account.status === "DISABLED") return null;

  const ok = await bcrypt.compare(password, account.passwordHash);
  if (!ok) return null;

  return account;
}

export async function signupPublicAccount(input: PublicSignupInput) {
  const email = normalizeEmail(input.email);
  const existingStaffUser = await prisma.user.findUnique({ where: { email } });
  if (existingStaffUser) {
    throw new AppError("An account with this email already exists", 409, "ACCOUNT_EXISTS");
  }

  const existingPublicAccount = await prisma.publicAccount.findUnique({ where: { email } });
  if (existingPublicAccount?.emailVerifiedAt || existingPublicAccount?.status === "ACTIVE") {
    throw new AppError("An account with this email already exists", 409, "ACCOUNT_EXISTS");
  }

  const passwordHash = await createPendingPasswordHash();
  const baseData = {
    accountType: input.accountType,
    entityType: input.entityType ?? "INDIVIDUAL",
    representation: input.representation?.trim() || null,
    firstName: input.firstName.trim(),
    lastName: input.lastName.trim(),
    organizationName: input.organizationName?.trim() || null,
    registrationNumber: input.registrationNumber?.trim() || null,
    email,
    passwordHash,
    phone: input.phone.trim(),
    state: input.state?.trim() || "",
    city: input.city?.trim() || "",
    address: input.address?.trim() || "",
    propertyCount: input.propertyCount?.trim() || null,
    portfolioType: input.portfolioType?.trim() || null,
    notes: input.notes?.trim() || null,
    emailVerifiedAt: null,
    status: "UNVERIFIED" as const
  };

  const account = existingPublicAccount
    ? await prisma.publicAccount.update({
        where: { email },
        data: baseData
      })
    : await prisma.publicAccount.create({
        data: baseData
      });

  await prisma.publicRefreshToken.deleteMany({ where: { publicAccountId: account.id } });

  const { rawToken, expiresAt } = await issueVerificationToken(account.id);
  const verificationUrl = buildVerificationUrl(rawToken);
  const verificationEmail = await sendVerificationLink(account.email, verificationUrl);

  return {
    success: true,
    email: account.email,
    status: account.status,
    verificationExpiresAt: expiresAt.toISOString(),
    ...(process.env.NODE_ENV === "production"
      ? {}
      : {
          verificationPreviewUrl: verificationUrl,
          verificationEmailPreviewUrl: verificationEmail.previewUrl || undefined
        })
  };
}

export async function resendPublicAccountVerification(emailInput: string) {
  const email = normalizeEmail(emailInput);
  const account = await prisma.publicAccount.findUnique({
    where: { email }
  });

  if (!account || account.status === "DISABLED" || account.emailVerifiedAt) {
    return {
      success: true,
      email,
      alreadyVerified: Boolean(account?.emailVerifiedAt)
    };
  }

  const { rawToken, expiresAt } = await issueVerificationToken(account.id);
  const verificationUrl = buildVerificationUrl(rawToken);
  const verificationEmail = await sendVerificationLink(account.email, verificationUrl);

  return {
    success: true,
    email: account.email,
    alreadyVerified: false,
    verificationExpiresAt: expiresAt.toISOString(),
    ...(process.env.NODE_ENV === "production"
      ? {}
      : {
          verificationPreviewUrl: verificationUrl,
          verificationEmailPreviewUrl: verificationEmail.previewUrl || undefined
        })
  };
}

export async function requestPasswordReset(emailInput: string) {
  const email = normalizeEmail(emailInput);
  const [staffUser, publicAccount] = await Promise.all([
    prisma.user.findUnique({ where: { email } }),
    prisma.publicAccount.findUnique({ where: { email } })
  ]);

  const preview =
    staffUser || publicAccount
      ? createMailPreview({
          category: "PASSWORD_RESET",
          to: email,
          subject: "RentSure password reset request",
          html: `
            <div style="font-family: Arial, sans-serif; color: #0f172a;">
              <p style="font-size: 14px; color: #475569;">Hello,</p>
              <p style="font-size: 14px; line-height: 1.7; color: #334155;">
                A password reset request was received for your RentSure account.
              </p>
              <p style="font-size: 14px; line-height: 1.7; color: #334155;">
                This development environment captures the reset email as a local preview while live email delivery is still being connected.
              </p>
              <p style="margin: 28px 0;">
                <a href="${env.APP_WEB_BASE_URL.replace(/\/+$/, "")}/login" style="display: inline-block; border-radius: 12px; background: #1d4ed8; color: white; padding: 12px 18px; text-decoration: none; font-weight: 600;">
                  Return to sign in
                </a>
              </p>
            </div>
          `
        })
      : null;

  logger.info(
    {
      event: "auth.password_reset_requested",
      email,
      previewUrl: preview?.previewUrl || null
    },
    "Password reset request captured"
  );

  return {
    success: true,
    email,
    ...(process.env.NODE_ENV === "production" ? {} : { resetEmailPreviewUrl: preview?.previewUrl || null })
  };
}

export async function verifyPublicAccountEmail(rawToken: string) {
  const tokenHash = hashVerificationToken(rawToken.trim());

  const token = await prisma.emailVerificationToken.findUnique({
    where: { tokenHash },
    include: { publicAccount: true }
  });

  if (!token || token.consumedAt || token.expiresAt <= new Date()) {
    throw new AppError("This email verification link is invalid or expired", 400, "INVALID_VERIFICATION_TOKEN");
  }

  return {
    success: true,
    email: token.publicAccount.email,
    fullName: publicAccountDisplayName(token.publicAccount),
    accountType: token.publicAccount.accountType,
    entityType: token.publicAccount.entityType
  };
}

export async function completePublicAccountSignup(input: { rawToken: string; password: string }) {
  const tokenHash = hashVerificationToken(input.rawToken.trim());

  const token = await prisma.emailVerificationToken.findUnique({
    where: { tokenHash },
    include: { publicAccount: true }
  });

  if (!token || token.consumedAt || token.expiresAt <= new Date()) {
    throw new AppError("This signup link is invalid or expired", 400, "INVALID_VERIFICATION_TOKEN");
  }

  const passwordHash = await bcrypt.hash(input.password, 12);

  const updatedAccount = await prisma.$transaction(async (tx) => {
    await tx.emailVerificationToken.update({
      where: { id: token.id },
      data: { consumedAt: new Date() }
    });

    await tx.emailVerificationToken.deleteMany({
      where: {
        publicAccountId: token.publicAccountId,
        id: { not: token.id }
      }
    });

    return tx.publicAccount.update({
      where: { id: token.publicAccountId },
      data: {
        passwordHash,
        emailVerifiedAt: new Date(),
        status: token.publicAccount.status === "DISABLED" ? "DISABLED" : "ACTIVE"
      }
    });
  });

  if (updatedAccount.accountType === "RENTER") {
    await ensureRegistrationRentScoreEvent(updatedAccount.id);
  }

  const session = await createPublicSession(updatedAccount);
  const onboardingRoute =
    updatedAccount.accountType === "RENTER"
      ? "/account/renter/profile?onboarding=1"
      : "/account/profile?onboarding=1";

  return {
    success: true,
    email: updatedAccount.email,
    fullName: publicAccountDisplayName(updatedAccount),
    onboardingRoute,
    ...session
  };
}

export async function loginWithPassword(emailInput: string, password: string) {
  const email = normalizeEmail(emailInput);

  const staffUser = await authenticateStaffUser(email, password);
  if (staffUser) {
    return createStaffSession(staffUser);
  }

  const publicAccount = await authenticatePublicAccount(email, password);
  if (!publicAccount) {
    throw new AppError("Invalid credentials", 401, "INVALID_CREDENTIALS");
  }

  if (!publicAccount.emailVerifiedAt || publicAccount.status === "UNVERIFIED") {
    throw new AppError("Verify your email before signing in", 403, "EMAIL_NOT_VERIFIED");
  }

  return createPublicSession(publicAccount);
}

export async function rotateRefreshToken(rawRefreshToken: string) {
  let payload: AuthTokenPayload;

  try {
    payload = jwt.verify(rawRefreshToken, env.JWT_REFRESH_SECRET) as AuthTokenPayload;
  } catch {
    throw new AppError("Invalid refresh token", 401, "INVALID_REFRESH_TOKEN");
  }

  const accountScope = payload.accountScope ?? "STAFF";

  if (accountScope === "PUBLIC") {
    const stored = await findStoredPublicRefreshToken(payload.userId, rawRefreshToken);
    if (!stored) throw new AppError("Refresh token not recognized", 401, "INVALID_REFRESH_TOKEN");

    const account = await prisma.publicAccount.findUnique({
      where: { id: payload.userId }
    });

    if (!account || account.status === "DISABLED" || !account.emailVerifiedAt) {
      throw new AppError("Account unavailable", 401, "INVALID_REFRESH_TOKEN");
    }

    await prisma.publicRefreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() }
    });

    return createPublicSession(account);
  }

  const stored = await findStoredStaffRefreshToken(payload.userId, rawRefreshToken);
  if (!stored) throw new AppError("Refresh token not recognized", 401, "INVALID_REFRESH_TOKEN");

  const user = await prisma.user.findUnique({
    where: { id: payload.userId }
  });

  if (!user || user.status === "DISABLED") {
    throw new AppError("User unavailable", 401, "INVALID_REFRESH_TOKEN");
  }

  await prisma.refreshToken.update({
    where: { id: stored.id },
    data: { revokedAt: new Date() }
  });

  return createStaffSession(user);
}

export async function logout(rawRefreshToken: string) {
  let payload: AuthTokenPayload;
  try {
    payload = jwt.verify(rawRefreshToken, env.JWT_REFRESH_SECRET) as AuthTokenPayload;
  } catch {
    return;
  }

  const accountScope = payload.accountScope ?? "STAFF";

  if (accountScope === "PUBLIC") {
    const stored = await findStoredPublicRefreshToken(payload.userId, rawRefreshToken);
    if (!stored) return;

    await prisma.publicRefreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() }
    });
    return;
  }

  const stored = await findStoredStaffRefreshToken(payload.userId, rawRefreshToken);
  if (!stored) return;

  await prisma.refreshToken.update({
    where: { id: stored.id },
    data: { revokedAt: new Date() }
  });
}

export async function getStaffProfile(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId }
  });

  if (!user || user.status === "DISABLED") {
    throw new AppError("User unavailable", 404, "USER_NOT_FOUND");
  }

  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    role: user.role,
    status: user.status,
    locationLabel: user.locationLabel,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

export async function updateStaffProfile(input: {
  userId: string;
  fullName: string;
  email: string;
  locationLabel?: string | null;
}) {
  const user = await prisma.user.findUnique({
    where: { id: input.userId }
  });

  if (!user || user.status === "DISABLED") {
    throw new AppError("User unavailable", 404, "USER_NOT_FOUND");
  }

  const email = normalizeEmail(input.email);
  const existingUser = await prisma.user.findUnique({
    where: { email }
  });

  if (existingUser && existingUser.id !== input.userId) {
    throw new AppError("Another staff user already uses this email", 409, "ACCOUNT_EXISTS");
  }

  const updated = await prisma.user.update({
    where: { id: input.userId },
    data: {
      fullName: input.fullName.trim(),
      email,
      locationLabel: input.locationLabel?.trim() || null
    }
  });

  return {
    id: updated.id,
    fullName: updated.fullName,
    email: updated.email,
    role: updated.role,
    status: updated.status,
    locationLabel: updated.locationLabel,
    createdAt: updated.createdAt,
    updatedAt: updated.updatedAt
  };
}

export async function changeStaffPassword(input: {
  userId: string;
  currentPassword: string;
  newPassword: string;
}) {
  const user = await prisma.user.findUnique({
    where: { id: input.userId }
  });

  if (!user || user.status === "DISABLED") {
    throw new AppError("User unavailable", 404, "USER_NOT_FOUND");
  }

  const passwordOk = await bcrypt.compare(input.currentPassword, user.passwordHash);
  if (!passwordOk) {
    throw new AppError("Current password is incorrect", 400, "INVALID_CREDENTIALS");
  }

  const samePassword = await bcrypt.compare(input.newPassword, user.passwordHash);
  if (samePassword) {
    throw new AppError("Choose a new password that is different from the current one", 400, "VALIDATION_ERROR");
  }

  const nextHash = await bcrypt.hash(input.newPassword, 12);

  await prisma.user.update({
    where: { id: input.userId },
    data: {
      passwordHash: nextHash
    }
  });

  return { success: true };
}
