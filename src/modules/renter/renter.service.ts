import type { Prisma } from "@prisma/client";
import { prisma } from "../../prisma/client";
import { AppError } from "../../common/errors/AppError";
import { buildRentScoreSnapshot, ensureSingleRentScoreEvent, syncUtilityPaymentHistoryEvent } from "../rent-score/rent-score.service";
import { attachPassportPhotoToPublicAccount, buildPublicDocumentViewUrl, toPublicDocumentAsset } from "../storage/storage.service";
import { createMailPreview } from "../mail-preview/mail-preview.service";
import { renderInfoPanel, renderTransactionalEmail } from "../mail/mail-templates";
import { getAvailableRentScorePaymentProviders } from "../score-payments/score-payments.service";

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function publicAccountDisplayName(account: { firstName: string; lastName: string; organizationName?: string | null }) {
  if (account.organizationName?.trim()) return account.organizationName.trim();
  return [account.firstName, account.lastName].filter(Boolean).join(" ");
}

function rentScoreBandLabel(scoreBand: string) {
  if (scoreBand === "STRONG") return "Excellent";
  if (scoreBand === "STABLE") return "Good";
  if (scoreBand === "WATCH") return "Fair";
  return "High Risk";
}

function isMissingRenterScoreShareTable(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2021" &&
    "meta" in error &&
    typeof error.meta === "object" &&
    error.meta !== null &&
    "table" in error.meta &&
    error.meta.table === "public.RenterScoreShare"
  );
}

function isMissingRenterShareRecipientColumn(error: unknown) {
  const meta =
    typeof error === "object" &&
    error !== null &&
    "meta" in error &&
    typeof (error as { meta?: unknown }).meta === "object" &&
    (error as { meta?: unknown }).meta !== null
      ? ((error as { meta: { column?: unknown } }).meta as { column?: unknown })
      : null;
  const column = typeof meta?.column === "string" ? meta.column : null;

  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2022" &&
    typeof column === "string" &&
    ["recipientFirstName", "recipientLastName", "recipientPhone"].some((field) => column.includes(field))
  );
}

function isMissingPublicAccountNotificationTable(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2021" &&
    "meta" in error &&
    typeof error.meta === "object" &&
    error.meta !== null &&
    "table" in error.meta &&
    error.meta.table === "public.PublicAccountNotification"
  );
}

function isMissingRentScorePaymentTable(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2021" &&
    "meta" in error &&
    typeof error.meta === "object" &&
    error.meta !== null &&
    "table" in error.meta &&
    error.meta.table === "public.RentScorePayment"
  );
}

function isMissingProposedRenterPropertyUnitColumn(error: unknown) {
  const meta =
    typeof error === "object" &&
    error !== null &&
    "meta" in error &&
    typeof (error as { meta?: unknown }).meta === "object" &&
    (error as { meta?: unknown }).meta !== null
      ? ((error as { meta: { column?: unknown } }).meta as { column?: unknown })
      : null;
  const column = typeof meta?.column === "string" ? meta.column : null;

  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2022" &&
    column === "ProposedRenter.propertyUnitId"
  );
}

function getLinkedRenterCases(publicAccountId: string) {
  return prisma.proposedRenter
    .findMany({
      where: { renterAccountId: publicAccountId },
      include: {
        property: true,
        propertyUnit: true,
        scoreRequests: {
          include: {
            requestedBy: true,
            forwardedTo: true
          },
          orderBy: { createdAt: "desc" }
        },
        paymentSchedules: {
          include: {
            createdBy: true
          },
          orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }]
        },
        landlordReferenceRequests: {
          include: {
            landlordAccount: true
          },
          orderBy: { createdAt: "desc" }
        },
        activities: {
          include: {
            actor: true
          },
          orderBy: { createdAt: "desc" },
          take: 8
        }
      },
      orderBy: { createdAt: "desc" }
    })
    .catch((error: unknown) => {
      if (isMissingProposedRenterPropertyUnitColumn(error)) {
        return prisma.proposedRenter.findMany({
          where: { renterAccountId: publicAccountId },
          select: {
            id: true,
            status: true,
            decision: true,
            decisionNote: true,
            property: true,
            propertyUnit: true,
            scoreRequests: {
              include: {
                requestedBy: true,
                forwardedTo: true
              },
              orderBy: { createdAt: "desc" }
            },
            paymentSchedules: {
              include: {
                createdBy: true
              },
              orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }]
            },
            landlordReferenceRequests: {
              include: {
                landlordAccount: true
              },
              orderBy: { createdAt: "desc" }
            },
            activities: {
              include: {
                actor: true
              },
              orderBy: { createdAt: "desc" },
              take: 8
            }
          },
          orderBy: { createdAt: "desc" }
        });
      }
      throw error;
    });
}

async function getRenterAccount(publicAccountId: string) {
  const account = await prisma.publicAccount.findUnique({
    where: { id: publicAccountId },
    include: {
      passportPhotoDocument: true
    }
  });
  if (!account || account.accountType !== "RENTER") {
    throw new AppError("Renter account not found", 404, "RENTER_NOT_FOUND");
  }
  if (account.status !== "ACTIVE") {
    throw new AppError("Renter account is not active", 403, "FORBIDDEN");
  }
  return account;
}

async function logRenterActivity(input: {
  proposedRenterId: string;
  actorAccountId: string;
  activityType:
    | "COMMENT"
    | "CREATED"
    | "SCORE_REQUESTED"
    | "SCORE_REQUEST_ACCEPTED"
    | "SCORE_FORWARDED"
    | "DECISION"
    | "PAYMENT_SCHEDULE_CREATED"
    | "PAYMENT_SCHEDULE_UPDATED"
    | "PAYMENT_CONFIRMATION_INITIATED"
    | "PAYMENT_CONFIRMED"
    | "RENTER_PAYMENT_CONFIRMED";
  message: string;
  metadata?: Prisma.JsonObject;
}) {
  await prisma.proposedRenterActivity.create({
    data: {
      proposedRenterId: input.proposedRenterId,
      actorAccountId: input.actorAccountId,
      activityType: input.activityType,
      message: input.message,
      metadata: input.metadata
    }
  });
}

function buildRenterScoreSharePayload(input: {
  account: Awaited<ReturnType<typeof getRenterAccount>>;
  rentScore: Awaited<ReturnType<typeof buildRentScoreSnapshot>>;
  linkedCases: Array<{
    id: string;
    property: {
      name: string;
      address: string;
      city: string;
      state: string;
    };
    decision: string | null;
    status: string;
  }>;
}) {
  const scoredBreakdown = input.rentScore.breakdown as Array<{
    name: string;
    contribution: number;
    appliedOccurrences: number;
  }>;

  return {
    generatedAt: new Date().toISOString(),
    renter: {
      name: publicAccountDisplayName(input.account),
      email: input.account.email,
      phone: input.account.phone,
      state: input.account.state,
      city: input.account.city,
      address: input.account.address
    },
    rentScore: {
      score: input.rentScore.summary.score,
      maxScore: input.rentScore.summary.maxScore,
      minScore: input.rentScore.summary.minScore,
      scoreBand: input.rentScore.summary.scoreBand,
      positivePoints: input.rentScore.summary.positivePoints,
      negativePoints: input.rentScore.summary.negativePoints,
      breakdown: scoredBreakdown
        .filter((item) => item.appliedOccurrences > 0)
        .slice(0, 8)
        .map((item) => ({
          name: item.name,
          contribution: item.contribution,
          appliedOccurrences: item.appliedOccurrences
        }))
    },
    linkedCases: input.linkedCases.slice(0, 6).map((item) => ({
      id: item.id,
      status: item.status,
      decision: item.decision,
      propertyName: item.property.name,
      propertyAddress: item.property.address,
      propertyCity: item.property.city,
      propertyState: item.property.state
    }))
  } satisfies Prisma.JsonObject;
}

function resolveScoreRequestShareRecipient(request: {
  requestedBy: {
    accountType: "LANDLORD" | "AGENT" | "RENTER";
    email: string;
    firstName: string;
    lastName: string;
    organizationName?: string | null;
    phone: string;
  };
  forwardedTo: {
    accountType: "LANDLORD" | "AGENT" | "RENTER";
    email: string;
    firstName: string;
    lastName: string;
    organizationName?: string | null;
    phone: string;
  } | null;
}) {
  const target = request.forwardedTo || request.requestedBy;
  if (target.accountType !== "LANDLORD" && target.accountType !== "AGENT") {
    throw new AppError("This score request is not tied to a landlord or agent recipient", 400, "VALIDATION_ERROR");
  }

  return {
    email: target.email,
    type: target.accountType,
    firstName: target.firstName,
    lastName: target.lastName,
    organizationName: target.organizationName,
    phone: target.phone,
    name: publicAccountDisplayName(target)
  } as const;
}

export async function getRenterDashboard(publicAccountId: string) {
  const shareHistoryPromise = prisma.renterScoreShare
    .findMany({
      where: { publicAccountId },
      include: {
        recipientAccount: true
      },
      orderBy: { createdAt: "desc" },
      take: 12
    })
    .catch((error: unknown) => {
      if (isMissingRenterScoreShareTable(error)) {
        return [];
      }
      if (isMissingRenterShareRecipientColumn(error)) {
        return prisma.renterScoreShare.findMany({
          where: { publicAccountId },
          orderBy: { createdAt: "desc" },
          take: 12,
          select: {
            id: true,
            recipientEmail: true,
            recipientType: true,
            note: true,
            score: true,
            maxScore: true,
            scoreBand: true,
            createdAt: true,
            recipientAccount: {
              select: {
                firstName: true,
                lastName: true,
                organizationName: true
              }
            }
          }
        });
      }
      throw error;
    });

  const notificationsPromise = prisma.publicAccountNotification
    .findMany({
      where: { publicAccountId },
      orderBy: [{ readAt: "asc" }, { createdAt: "desc" }],
      take: 10
    })
    .catch((error: unknown) => {
      if (isMissingPublicAccountNotificationTable(error)) {
        return [];
      }
      throw error;
    });

  const rentScorePurchasesPromise = prisma.rentScorePayment
    .findMany({
      where: {
        requestedByAccountId: publicAccountId,
        proposedRenterId: null
      },
      orderBy: { createdAt: "desc" },
      take: 12
    })
    .catch((error: unknown) => {
      if (isMissingRentScorePaymentTable(error)) {
        return [];
      }
      throw error;
    });

  const [account, rentScore, linkedCases, shareHistory, notifications, rentScorePurchases] = await Promise.all([
    getRenterAccount(publicAccountId),
    buildRentScoreSnapshot(publicAccountId),
    getLinkedRenterCases(publicAccountId),
    shareHistoryPromise,
    notificationsPromise,
    rentScorePurchasesPromise
  ]);

  const profileCompleteness = [
    Boolean(account.phone),
    Boolean(account.address),
    Boolean(account.city),
    Boolean(account.state),
    Boolean(account.ninVerifiedAt || account.bvnVerifiedAt)
  ].filter(Boolean).length;

  return {
    profile: {
      id: account.id,
      entityType: account.entityType,
      firstName: account.firstName,
      lastName: account.lastName,
      organizationName: account.organizationName,
      registrationNumber: account.registrationNumber,
      email: account.email,
      phone: account.phone,
      state: account.state,
      city: account.city,
      address: account.address,
      residenceMoveCount5y: account.residenceMoveCount5y,
      employmentType: account.employmentType,
      employmentYears: account.employmentYears,
      notes: account.notes,
      nin: null,
      ninVerifiedAt: account.ninVerifiedAt,
      bvn: null,
      bvnVerifiedAt: account.bvnVerifiedAt,
      passportPhoto: toPublicDocumentAsset(account.passportPhotoDocument),
      createdAt: account.createdAt
    },
    rentScore,
    summary: {
      activeLinkedCases: linkedCases.length,
      pendingSchedules: linkedCases.flatMap((item) => item.paymentSchedules).filter((schedule) => schedule.status !== "PAID").length,
      profileCompletenessPercent: Math.round((profileCompleteness / 5) * 100),
      unreadNotifications: notifications.filter((item) => !item.readAt).length
    },
    reportAccess: {
      canShareOrDownload: true
    },
    availableRentScorePaymentProviders: getAvailableRentScorePaymentProviders(),
    notifications: notifications.map((notification) => ({
      id: notification.id,
      notificationType: notification.notificationType,
      title: notification.title,
      message: notification.message,
      ctaLabel: notification.ctaLabel,
      ctaPath: notification.ctaPath,
      readAt: notification.readAt,
      createdAt: notification.createdAt
    })),
    shareHistory: shareHistory.map((share) => ({
      id: share.id,
      recipientEmail: share.recipientEmail,
      recipientType: share.recipientType,
      recipientName: share.recipientAccount
        ? publicAccountDisplayName(share.recipientAccount)
        : [("recipientFirstName" in share ? share.recipientFirstName : null), ("recipientLastName" in share ? share.recipientLastName : null)].filter(Boolean).join(" ") || null,
      recipientPhone: "recipientPhone" in share ? share.recipientPhone : null,
      note: share.note,
      score: share.score,
      maxScore: share.maxScore,
      scoreBand: share.scoreBand,
      createdAt: share.createdAt
    })),
    rentScorePurchases: rentScorePurchases.map((payment) => ({
      id: payment.id,
      provider: payment.provider,
      status: payment.status,
      amountNgn: payment.amountNgn,
      currency: payment.currency,
      reference: payment.reference,
      checkoutUrl: payment.checkoutUrl,
      createdAt: payment.createdAt,
      paidAt: payment.paidAt,
      verifiedAt: payment.verifiedAt,
      reportApprovedAt: payment.reportApprovedAt,
      manualTransfer:
        payment.provider === "MANUAL_TRANSFER" && payment.metadata && typeof payment.metadata === "object"
          ? (payment.metadata as {
              bankName?: string;
              accountName?: string;
              accountNumber?: string;
              reference?: string;
              instructions?: string;
            })
          : null
    })),
    linkedCases: linkedCases.map((item) => ({
      id: item.id,
      status: item.status,
      decision: item.decision,
      decisionNote: item.decisionNote,
      property: {
        id: item.property.id,
        name: item.property.name,
        address: item.property.address,
        city: item.property.city,
        state: item.property.state
      },
      propertyUnit: item.propertyUnit
        ? {
            id: item.propertyUnit.id,
            label: item.propertyUnit.label,
            summaryLabel: [item.propertyUnit.label, item.propertyUnit.bedroomCount ? `${item.propertyUnit.bedroomCount} bed` : null, item.propertyUnit.bathroomCount ? `${item.propertyUnit.bathroomCount} bath` : null]
              .filter(Boolean)
              .join(" · "),
            address: item.propertyUnit.address,
            city: item.propertyUnit.city,
            state: item.propertyUnit.state,
            bedroomCount: item.propertyUnit.bedroomCount,
            bathroomCount: item.propertyUnit.bathroomCount,
            isOccupied: item.propertyUnit.isOccupied,
            currentTenantName: item.propertyUnit.currentTenantName,
            currentTenantEmail: item.propertyUnit.currentTenantEmail,
            currentTenantPhone: item.propertyUnit.currentTenantPhone
          }
        : null,
      scoreRequests: item.scoreRequests.map((request) => ({
        id: request.id,
        status: request.status,
        acceptedAt: "acceptedAt" in request ? request.acceptedAt : null,
        requestedBy: publicAccountDisplayName(request.requestedBy),
        requestedByEmail: request.requestedBy.email,
        requestedByType: request.requestedBy.accountType,
        forwardedTo: request.forwardedTo ? publicAccountDisplayName(request.forwardedTo) : null,
        forwardedToEmail: request.forwardedTo?.email || null,
        forwardedToType: request.forwardedTo?.accountType || null,
        shareTarget: resolveScoreRequestShareRecipient({
          requestedBy: request.requestedBy,
          forwardedTo: request.forwardedTo
        }),
        createdAt: request.createdAt
      })),
      paymentSchedules: item.paymentSchedules.map((schedule) => ({
        id: schedule.id,
        paymentType: schedule.paymentType,
        amountNgn: schedule.amountNgn,
        dueDate: schedule.dueDate,
        status: schedule.status,
        note: schedule.note,
        confirmedByRenterAt: schedule.confirmedByRenterAt,
        confirmationInitiatedAt: schedule.confirmationInitiatedAt,
        confirmedAt: schedule.confirmedAt,
        confirmationTiming: schedule.confirmationTiming,
        paymentEvidenceObjectKey: schedule.paymentEvidenceObjectKey,
        paymentEvidenceFileName: schedule.paymentEvidenceFileName,
        paymentEvidenceMimeType: schedule.paymentEvidenceMimeType,
        paymentEvidenceFileSize: schedule.paymentEvidenceFileSize,
        paymentEvidenceUploadedAt: schedule.paymentEvidenceUploadedAt,
        paymentEvidenceViewUrl: schedule.paymentEvidenceObjectKey ? buildPublicDocumentViewUrl(schedule.paymentEvidenceObjectKey) : null,
        receiptReference: schedule.receiptReference,
        createdBy: publicAccountDisplayName(schedule.createdBy)
      })),
      landlordReferenceRequests: item.landlordReferenceRequests.map((request) => ({
        id: request.id,
        status: request.status,
        recommendation: request.recommendation,
        note: request.note,
        requestedAt: request.requestedAt,
        respondedAt: request.respondedAt,
        landlordName: publicAccountDisplayName(request.landlordAccount)
      })),
      activities: item.activities.map((activity) => ({
        id: activity.id,
        activityType: activity.activityType,
        message: activity.message,
        createdAt: activity.createdAt,
        actorName: activity.actor ? publicAccountDisplayName(activity.actor) : null
      }))
    }))
  };
}

export async function updateRenterProfile(input: {
  publicAccountId: string;
  firstName?: string;
  lastName?: string;
  organizationName?: string | null;
  registrationNumber?: string | null;
  phone?: string;
  state?: string;
  city?: string;
  address?: string;
  residenceMoveCount5y?: number | null;
  employmentType?: "EMPLOYED" | "SELF_EMPLOYED" | null;
  employmentYears?: number | null;
  notes?: string | null;
}) {
  await getRenterAccount(input.publicAccountId);

  await prisma.publicAccount.update({
    where: { id: input.publicAccountId },
    data: {
      firstName: input.firstName?.trim(),
      lastName: input.lastName?.trim(),
      organizationName: input.organizationName === undefined ? undefined : input.organizationName?.trim() || null,
      registrationNumber: input.registrationNumber === undefined ? undefined : input.registrationNumber?.trim() || null,
      phone: input.phone?.trim(),
      state: input.state?.trim(),
      city: input.city?.trim(),
      address: input.address?.trim(),
      residenceMoveCount5y: input.residenceMoveCount5y === undefined ? undefined : input.residenceMoveCount5y,
      employmentType: input.employmentType === undefined ? undefined : input.employmentType,
      employmentYears: input.employmentYears === undefined ? undefined : input.employmentYears,
      notes: input.notes === undefined ? undefined : input.notes?.trim() || null
    }
  });

  return getRenterDashboard(input.publicAccountId);
}

export async function saveRenterPassportPhoto(input: {
  publicAccountId: string;
  objectKey: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
}) {
  await getRenterAccount(input.publicAccountId);
  await attachPassportPhotoToPublicAccount(input);
  return getRenterDashboard(input.publicAccountId);
}

export async function verifyRenterIdentity(input: {
  publicAccountId: string;
  verificationType: "NIN" | "BVN";
  value: string;
}) {
  const account = await getRenterAccount(input.publicAccountId);
  const cleanValue = input.value.replace(/\D/g, "");
  if (cleanValue.length !== 11) {
    throw new AppError(`${input.verificationType} must be 11 digits`, 400, "VALIDATION_ERROR");
  }

  await prisma.publicAccount.update({
    where: { id: account.id },
    data:
      input.verificationType === "NIN"
        ? {
            nin: cleanValue,
            ninVerifiedAt: new Date()
          }
        : {
            bvn: cleanValue,
            bvnVerifiedAt: new Date()
          }
  });

  await ensureSingleRentScoreEvent(account.id, "GOVERNMENT_ID_VERIFIED", `${input.verificationType} verified on RentSure`);
  return getRenterDashboard(account.id);
}

export async function confirmRenterPayment(input: {
  publicAccountId: string;
  paymentScheduleId: string;
  paidAt?: Date | null;
  receiptReference?: string;
  note?: string;
}) {
  await getRenterAccount(input.publicAccountId);

  const schedule = await prisma.paymentSchedule.findFirst({
    where: {
      id: input.paymentScheduleId,
      proposedRenter: {
        renterAccountId: input.publicAccountId,
        decision: "APPROVED",
        propertyUnitId: { not: null }
      }
    }
  });

  if (!schedule) {
    throw new AppError("Approved linked property unit payment schedule not found", 404, "PAYMENT_SCHEDULE_NOT_FOUND");
  }

  const now = input.paidAt ?? new Date();
  const timing = now.getTime() <= schedule.dueDate.getTime() ? "ON_TIME" : "LATE";
  await prisma.paymentSchedule.update({
    where: { id: schedule.id },
    data: {
      status: "PAID",
      paidAt: now,
      confirmedByRenterAt: now,
      confirmedAt: now,
      confirmedByAccountId: input.publicAccountId,
      confirmationTiming: timing,
      confirmationNote: input.note?.trim() || null,
      receiptReference: input.receiptReference?.trim() || null
    }
  });

  await logRenterActivity({
    proposedRenterId: schedule.proposedRenterId,
    actorAccountId: input.publicAccountId,
    activityType: "RENTER_PAYMENT_CONFIRMED",
    message: `${schedule.paymentType.replaceAll("_", " ")} payment confirmed by renter.`,
    metadata: {
      paymentScheduleId: schedule.id,
      receiptReference: input.receiptReference?.trim() || null,
      timing
    } as Prisma.JsonObject
  });

  if (schedule.paymentType === "UTILITY") {
    await syncUtilityPaymentHistoryEvent(input.publicAccountId);
  }

  return getRenterDashboard(input.publicAccountId);
}

export async function initiateRenterPaymentConfirmation(input: {
  publicAccountId: string;
  paymentScheduleId: string;
  receiptReference?: string;
  note?: string;
  paymentEvidenceObjectKey?: string;
  paymentEvidenceFileName?: string;
  paymentEvidenceMimeType?: string;
  paymentEvidenceFileSize?: number;
}) {
  await getRenterAccount(input.publicAccountId);

  const schedule = await prisma.paymentSchedule.findFirst({
    where: {
      id: input.paymentScheduleId,
      proposedRenter: {
        renterAccountId: input.publicAccountId,
        decision: "APPROVED",
        propertyUnitId: { not: null }
      }
    }
  });

  if (!schedule) {
    throw new AppError("Approved linked property unit payment schedule not found", 404, "PAYMENT_SCHEDULE_NOT_FOUND");
  }

  if (schedule.confirmationInitiatedAt) {
    throw new AppError(
      "Proof of payment has already been submitted for this payment request. Start a new payment if you need to send another proof.",
      400,
      "PAYMENT_PROOF_ALREADY_SUBMITTED"
    );
  }

  if (!input.paymentEvidenceObjectKey && !schedule.paymentEvidenceObjectKey) {
    throw new AppError("Attach proof of payment before sending to landlord", 400, "VALIDATION_ERROR");
  }

  const initiatedAt = new Date();
  await prisma.paymentSchedule.update({
    where: { id: schedule.id },
    data: {
      confirmationInitiatedAt: initiatedAt,
      confirmationInitiatedByAccountId: input.publicAccountId,
      confirmationNote: input.note?.trim() || schedule.confirmationNote || null,
      receiptReference: input.receiptReference?.trim() || schedule.receiptReference || null,
      paymentEvidenceObjectKey: input.paymentEvidenceObjectKey?.trim() || schedule.paymentEvidenceObjectKey || null,
      paymentEvidenceFileName: input.paymentEvidenceFileName?.trim() || schedule.paymentEvidenceFileName || null,
      paymentEvidenceMimeType: input.paymentEvidenceMimeType?.trim() || schedule.paymentEvidenceMimeType || null,
      paymentEvidenceFileSize: input.paymentEvidenceFileSize ?? schedule.paymentEvidenceFileSize ?? null,
      paymentEvidenceUploadedAt:
        input.paymentEvidenceObjectKey || input.paymentEvidenceFileName || input.paymentEvidenceMimeType
          ? initiatedAt
          : schedule.paymentEvidenceUploadedAt
    }
  });

  await logRenterActivity({
    proposedRenterId: schedule.proposedRenterId,
    actorAccountId: input.publicAccountId,
    activityType: "PAYMENT_CONFIRMATION_INITIATED",
    message: `${schedule.paymentType.replaceAll("_", " ")} payment confirmation initiated by renter.`,
    metadata: {
      paymentScheduleId: schedule.id,
      hasEvidence: Boolean(input.paymentEvidenceObjectKey),
      receiptReference: input.receiptReference?.trim() || null
    } as Prisma.JsonObject
  });

  return getRenterDashboard(input.publicAccountId);
}

export async function createSelfInitiatedRenterPayment(input: {
  publicAccountId: string;
  linkedCaseId: string;
  paymentType: "RENT" | "UTILITY" | "ESTATE_DUE";
  amountNgn: number;
  paidAt?: Date | null;
  receiptReference?: string;
  note?: string;
  paymentEvidenceObjectKey: string;
  paymentEvidenceFileName: string;
  paymentEvidenceMimeType: string;
  paymentEvidenceFileSize: number;
}) {
  await getRenterAccount(input.publicAccountId);

  const linkedCase = await prisma.proposedRenter.findFirst({
    where: {
      id: input.linkedCaseId,
      renterAccountId: input.publicAccountId,
      decision: "APPROVED",
      propertyUnitId: { not: null }
    },
    select: {
      id: true,
      propertyId: true,
      propertyUnitId: true,
      property: {
        select: {
          id: true,
          name: true,
          address: true,
          city: true,
          state: true
        }
      }
    }
  });

  if (!linkedCase) {
    throw new AppError("Approved linked property unit not found for this renter", 404, "LINKED_PROPERTY_NOT_FOUND");
  }

  const paidAt = input.paidAt ?? new Date();

  await prisma.paymentSchedule.create({
    data: {
      proposedRenterId: linkedCase.id,
      propertyId: linkedCase.propertyId,
      createdByAccountId: input.publicAccountId,
      paymentType: input.paymentType,
      amountNgn: input.amountNgn,
      dueDate: paidAt,
      paidAt,
      status: "PENDING",
      note: input.note?.trim() || null,
      confirmedByRenterAt: paidAt,
      confirmationInitiatedAt: paidAt,
      confirmationInitiatedByAccountId: input.publicAccountId,
      confirmationNote: input.note?.trim() || null,
      receiptReference: input.receiptReference?.trim() || null,
      paymentEvidenceObjectKey: input.paymentEvidenceObjectKey.trim(),
      paymentEvidenceFileName: input.paymentEvidenceFileName.trim(),
      paymentEvidenceMimeType: input.paymentEvidenceMimeType.trim(),
      paymentEvidenceFileSize: input.paymentEvidenceFileSize,
      paymentEvidenceUploadedAt: paidAt
    }
  });

  await logRenterActivity({
    proposedRenterId: linkedCase.id,
    actorAccountId: input.publicAccountId,
    activityType: "PAYMENT_CONFIRMATION_INITIATED",
    message: `${input.paymentType.replaceAll("_", " ")} payment submitted by renter for landlord confirmation.`,
    metadata: {
      propertyId: linkedCase.propertyId,
      paymentType: input.paymentType,
      amountNgn: input.amountNgn,
      paidAt: paidAt.toISOString(),
      receiptReference: input.receiptReference?.trim() || null
    } as Prisma.JsonObject
  });

  return getRenterDashboard(input.publicAccountId);
}

export async function acceptRenterScoreRequest(input: { publicAccountId: string; linkedCaseId: string }) {
  await getRenterAccount(input.publicAccountId);

  const linkedCase = await prisma.proposedRenter.findFirst({
    where: {
      id: input.linkedCaseId,
      renterAccountId: input.publicAccountId
    },
    include: {
      scoreRequests: {
        include: {
          requestedBy: true,
          forwardedTo: true
        },
        orderBy: { createdAt: "desc" }
      }
    }
  });

  if (!linkedCase) {
    throw new AppError("Linked landlord request was not found", 404, "NOT_FOUND");
  }

  const latestRequest = linkedCase.scoreRequests[0] || null;
  if (!latestRequest) {
    throw new AppError("No rent score request is waiting on this linked property", 400, "VALIDATION_ERROR");
  }

  if (latestRequest.acceptedAt) {
    return getRenterDashboard(input.publicAccountId);
  }

  const acceptedAt = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.scoreRequest.update({
      where: { id: latestRequest.id },
      data: { acceptedAt }
    });

    const recipient = resolveScoreRequestShareRecipient({
      requestedBy: latestRequest.requestedBy,
      forwardedTo: latestRequest.forwardedTo
    });

    await tx.proposedRenterActivity.create({
      data: {
        proposedRenterId: linkedCase.id,
        actorAccountId: input.publicAccountId,
        activityType: "SCORE_REQUEST_ACCEPTED",
        message: `Renter accepted the rent score request for ${recipient.name}.`,
        metadata: {
          scoreRequestId: latestRequest.id,
          recipientEmail: recipient.email,
          recipientType: recipient.type,
          acceptedAt: acceptedAt.toISOString()
        } satisfies Prisma.JsonObject
      }
    });
  });

  return getRenterDashboard(input.publicAccountId);
}

export async function requestLandlordReference(input: {
  publicAccountId: string;
  linkedCaseId: string;
  note?: string;
}) {
  await getRenterAccount(input.publicAccountId);

  const linkedCase = await prisma.proposedRenter.findFirst({
    where: {
      id: input.linkedCaseId,
      renterAccountId: input.publicAccountId
    },
    include: {
      property: {
        include: {
          members: {
            where: { role: "LANDLORD" },
            include: { account: true },
            orderBy: [{ isPrimary: "desc" }, { addedAt: "asc" }]
          }
        }
      }
    }
  });

  if (!linkedCase) {
    throw new AppError("Linked property not found", 404, "LINKED_PROPERTY_NOT_FOUND");
  }

  const landlordMembership = linkedCase.property.members[0] || null;
  if (!landlordMembership) {
    throw new AppError("No landlord is linked to this property yet", 400, "LANDLORD_NOT_FOUND");
  }

  const existingPending = await prisma.landlordReferenceRequest.findFirst({
    where: {
      proposedRenterId: linkedCase.id,
      renterAccountId: input.publicAccountId,
      landlordAccountId: landlordMembership.publicAccountId,
      status: "PENDING"
    }
  });

  if (!existingPending) {
    await prisma.$transaction(async (tx) => {
      await tx.landlordReferenceRequest.create({
        data: {
          proposedRenterId: linkedCase.id,
          renterAccountId: input.publicAccountId,
          landlordAccountId: landlordMembership.publicAccountId,
          note: input.note?.trim() || null
        }
      });

      await tx.proposedRenterActivity.create({
        data: {
          proposedRenterId: linkedCase.id,
          actorAccountId: input.publicAccountId,
          activityType: "COMMENT",
          message: `Renter requested a landlord reference from ${publicAccountDisplayName(landlordMembership.account)}.`,
          metadata: {
            landlordAccountId: landlordMembership.publicAccountId,
            note: input.note?.trim() || null
          } satisfies Prisma.JsonObject
        }
      });
    });
  }

  return getRenterDashboard(input.publicAccountId);
}

export async function shareRenterScoreReport(input: {
  publicAccountId: string;
  linkedCaseId?: string;
  recipientEmail: string;
  recipientType: "LANDLORD" | "AGENT";
  recipientFirstName?: string;
  recipientLastName?: string;
  recipientPhone?: string;
  note?: string;
}) {
  const account = await getRenterAccount(input.publicAccountId);
  let recipientEmail = normalizeEmail(input.recipientEmail);
  let recipientType = input.recipientType;
  let recipientFirstName = input.recipientFirstName?.trim() || undefined;
  let recipientLastName = input.recipientLastName?.trim() || undefined;
  let recipientPhone = input.recipientPhone?.trim() || undefined;
  let linkedCaseId = input.linkedCaseId;

  if (linkedCaseId) {
    const linkedCase = await prisma.proposedRenter.findFirst({
      where: {
        id: linkedCaseId,
        renterAccountId: input.publicAccountId
      },
      include: {
        scoreRequests: {
          include: {
            requestedBy: true,
            forwardedTo: true
          },
          orderBy: { createdAt: "desc" }
        }
      }
    });

    if (!linkedCase) {
      throw new AppError("Linked landlord request was not found", 404, "NOT_FOUND");
    }

    const latestRequest = linkedCase.scoreRequests[0] || null;
    if (!latestRequest) {
      throw new AppError("No rent score request is available for this linked property", 400, "VALIDATION_ERROR");
    }
    if (!latestRequest.acceptedAt) {
      throw new AppError("Accept the landlord request before sharing your rent score", 400, "VALIDATION_ERROR");
    }

    const recipient = resolveScoreRequestShareRecipient({
      requestedBy: latestRequest.requestedBy,
      forwardedTo: latestRequest.forwardedTo
    });
    recipientEmail = normalizeEmail(recipient.email);
    recipientType = recipient.type;
    recipientFirstName = recipient.firstName;
    recipientLastName = recipient.lastName;
    recipientPhone = recipient.phone;
  }

  if (recipientEmail === normalizeEmail(account.email)) {
    throw new AppError("Use a landlord or agent email to share this report", 400, "VALIDATION_ERROR");
  }

  const recipientAccount = await prisma.publicAccount.findUnique({
    where: { email: recipientEmail }
  });

  if (recipientAccount && recipientAccount.accountType !== recipientType) {
    const expectedType = linkedCaseId ? recipientType : input.recipientType;
    throw new AppError(
      `This email already belongs to a ${recipientAccount.accountType.toLowerCase()} account, not ${expectedType.toLowerCase()}.`,
      400,
      "VALIDATION_ERROR"
    );
  }

  const [rentScore, linkedCases] = await Promise.all([
    buildRentScoreSnapshot(account.id),
    prisma.proposedRenter.findMany({
      where: { renterAccountId: account.id },
      select: {
        id: true,
        decision: true,
        status: true,
        property: {
          select: {
            name: true,
            address: true,
            city: true,
            state: true
          }
        }
      },
      orderBy: { createdAt: "desc" }
    })
  ]);

  try {
    await prisma.renterScoreShare.create({
      data: {
        publicAccountId: account.id,
        recipientEmail,
        recipientType,
        recipientAccountId: recipientAccount?.id,
        recipientFirstName: recipientAccount ? recipientAccount.firstName : recipientFirstName || null,
        recipientLastName: recipientAccount ? recipientAccount.lastName : recipientLastName || null,
        recipientPhone: recipientAccount ? recipientAccount.phone : recipientPhone || null,
        note: input.note?.trim() || null,
        score: rentScore.summary.score,
        maxScore: rentScore.summary.maxScore,
        scoreBand: rentScore.summary.scoreBand,
        reportPayload: buildRenterScoreSharePayload({
          account,
          rentScore,
          linkedCases: linkedCases.map((item) => ({
            id: item.id,
            decision: item.decision,
            status: item.status,
            property: {
              name: item.property.name,
              address: item.property.address,
              city: item.property.city,
              state: item.property.state
            }
          }))
        })
      }
    });
  } catch (error: unknown) {
    if (isMissingRenterScoreShareTable(error)) {
      throw new AppError(
        "Rent score share history is not ready yet on this environment. Run the latest Prisma migration and try again.",
        503,
        "FEATURE_NOT_READY"
      );
    }
    if (isMissingRenterShareRecipientColumn(error)) {
      await prisma.renterScoreShare.create({
        data: {
          publicAccountId: account.id,
          recipientEmail,
          recipientType,
          recipientAccountId: recipientAccount?.id,
          note: input.note?.trim() || null,
          score: rentScore.summary.score,
          maxScore: rentScore.summary.maxScore,
          scoreBand: rentScore.summary.scoreBand,
          reportPayload: buildRenterScoreSharePayload({
            account,
            rentScore,
            linkedCases: linkedCases.map((item) => ({
              id: item.id,
              decision: item.decision,
              status: item.status,
              property: {
                name: item.property.name,
                address: item.property.address,
                city: item.property.city,
                state: item.property.state
              }
            }))
          })
        }
      } as never);
      const scorePanel = renderInfoPanel({
        label: "Rent score",
        value: `${rentScore.summary.score} / ${rentScore.summary.maxScore}`,
        note: `Band: ${rentScoreBandLabel(rentScore.summary.scoreBand)}`
      });
      const legacySharePreview = createMailPreview({
        category: "RENTER_SHARE_REPORT",
        to: recipientEmail,
        subject: "RentSure rent score report shared with you",
        html: renderTransactionalEmail({
          eyebrow: "Rent Score Shared",
          title: "Rent score report shared with you",
          greeting: "Hello,",
          paragraphs: [`${publicAccountDisplayName(account)} has shared a RentSure rent score report with you.`],
          sectionHtml: scorePanel
        })
      });
      return {
        dashboard: await getRenterDashboard(account.id),
        sharePreviewUrl: process.env.NODE_ENV === "production" ? null : legacySharePreview.previewUrl
      };
    }
    throw error;
  }

  if (linkedCaseId) {
    const sharedAt = new Date();
    await prisma.$transaction(async (tx) => {
      const linkedCase = await tx.proposedRenter.findFirst({
        where: {
          id: linkedCaseId,
          renterAccountId: input.publicAccountId
        },
        include: {
          scoreRequests: {
            include: {
              requestedBy: true,
              forwardedTo: true
            },
            orderBy: { createdAt: "desc" }
          }
        }
      });

      if (!linkedCase) return;

      if (linkedCase.status === "SCORE_REQUESTED" || linkedCase.status === "PROPOSED") {
        await tx.proposedRenter.update({
          where: { id: linkedCase.id },
          data: { status: "SCORE_SHARED" }
        });
      }

      const latestRequest = linkedCase.scoreRequests[0] || null;
      const recipient = latestRequest
        ? resolveScoreRequestShareRecipient({
            requestedBy: latestRequest.requestedBy,
            forwardedTo: latestRequest.forwardedTo
          })
        : null;

      await tx.proposedRenterActivity.create({
        data: {
          proposedRenterId: linkedCase.id,
          actorAccountId: input.publicAccountId,
          activityType: "SCORE_FORWARDED",
          message: recipient
            ? `Renter shared the rent score report with ${recipient.name}.`
            : "Renter shared the rent score report.",
          metadata: {
            recipientEmail,
            recipientType,
            sharedAt: sharedAt.toISOString()
          } satisfies Prisma.JsonObject
        }
      });
    });
  }

  const scorePanel = renderInfoPanel({
    label: "Rent score",
    value: `${rentScore.summary.score} / ${rentScore.summary.maxScore}`,
    note: `Band: ${rentScoreBandLabel(rentScore.summary.scoreBand)}`
  });
  const sharePreview = createMailPreview({
    category: "RENTER_SHARE_REPORT",
    to: recipientEmail,
    subject: "RentSure rent score report shared with you",
    html: renderTransactionalEmail({
      eyebrow: "Rent Score Shared",
      title: "Rent score report shared with you",
      greeting: "Hello,",
      paragraphs: [
        `${publicAccountDisplayName(account)} has shared a RentSure rent score report with you.`,
        ...(input.note?.trim() ? [`<strong>Note:</strong> ${input.note.trim()}`] : []),
        "This preview shows the outbound share email in development while live email delivery is still being connected."
      ],
      sectionHtml: scorePanel
    })
  });

  return {
    dashboard: await getRenterDashboard(account.id),
    sharePreviewUrl: process.env.NODE_ENV === "production" ? null : sharePreview.previewUrl
  };
}

export async function searchRenterShareRecipients(input: {
  publicAccountId: string;
  recipientType: "LANDLORD" | "AGENT";
  q: string;
}) {
  const renter = await getRenterAccount(input.publicAccountId);
  const query = input.q.trim();
  if (query.length < 2) {
    return { items: [] };
  }

  const accounts = await prisma.publicAccount.findMany({
    where: {
      accountType: input.recipientType,
      status: "ACTIVE",
      email: { not: renter.email },
      OR: [
        { email: { contains: query, mode: "insensitive" } },
        { phone: { contains: query, mode: "insensitive" } },
        { firstName: { contains: query, mode: "insensitive" } },
        { lastName: { contains: query, mode: "insensitive" } },
        { organizationName: { contains: query, mode: "insensitive" } }
      ]
    },
    orderBy: [{ updatedAt: "desc" }],
    take: 8
  });

  return {
    items: accounts.map((account) => ({
      id: account.id,
      firstName: account.firstName,
      lastName: account.lastName,
      organizationName: account.organizationName,
      email: account.email,
      phone: account.phone,
      state: account.state,
      city: account.city,
      address: account.address
    }))
  };
}
