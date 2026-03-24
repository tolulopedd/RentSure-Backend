import type { Prisma } from "@prisma/client";
import { prisma } from "../../prisma/client";
import { AppError } from "../../common/errors/AppError";
import { buildRentScoreSnapshot, ensureSingleRentScoreEvent, recordRentScoreEvent } from "../rent-score/rent-score.service";
import { attachPassportPhotoToPublicAccount, toPublicDocumentAsset } from "../storage/storage.service";
import { createMailPreview } from "../mail-preview/mail-preview.service";

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function publicAccountDisplayName(account: { firstName: string; lastName: string; organizationName?: string | null }) {
  if (account.organizationName?.trim()) return account.organizationName.trim();
  return [account.firstName, account.lastName].filter(Boolean).join(" ");
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
    | "SCORE_FORWARDED"
    | "DECISION"
    | "PAYMENT_SCHEDULE_CREATED"
    | "PAYMENT_SCHEDULE_UPDATED"
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

  const [account, rentScore, linkedCases, shareHistory] = await Promise.all([
    getRenterAccount(publicAccountId),
    buildRentScoreSnapshot(publicAccountId),
    prisma.proposedRenter.findMany({
      where: { renterAccountId: publicAccountId },
      include: {
        property: true,
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
        activities: {
          include: {
            actor: true
          },
          orderBy: { createdAt: "desc" },
          take: 8
        }
      },
      orderBy: { createdAt: "desc" }
    }),
    shareHistoryPromise
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
      notes: account.notes,
      nin: account.nin,
      ninVerifiedAt: account.ninVerifiedAt,
      bvn: account.bvn,
      bvnVerifiedAt: account.bvnVerifiedAt,
      passportPhoto: toPublicDocumentAsset(account.passportPhotoDocument),
      createdAt: account.createdAt
    },
    rentScore,
    summary: {
      activeLinkedCases: linkedCases.length,
      pendingSchedules: linkedCases.flatMap((item) => item.paymentSchedules).filter((schedule) => schedule.status !== "PAID").length,
      profileCompletenessPercent: Math.round((profileCompleteness / 5) * 100)
    },
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
      scoreRequests: item.scoreRequests.map((request) => ({
        id: request.id,
        status: request.status,
        requestedBy: publicAccountDisplayName(request.requestedBy),
        forwardedTo: request.forwardedTo ? publicAccountDisplayName(request.forwardedTo) : null,
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
        receiptReference: schedule.receiptReference,
        createdBy: publicAccountDisplayName(schedule.createdBy)
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

  await ensureSingleRentScoreEvent(account.id, "BVN_SIN_VALIDATED", `${input.verificationType} verified on RentSure`);
  return getRenterDashboard(account.id);
}

export async function confirmRenterPayment(input: {
  publicAccountId: string;
  paymentScheduleId: string;
  receiptReference?: string;
  note?: string;
}) {
  await getRenterAccount(input.publicAccountId);

  const schedule = await prisma.paymentSchedule.findFirst({
    where: {
      id: input.paymentScheduleId,
      proposedRenter: {
        renterAccountId: input.publicAccountId
      }
    },
    include: {
      proposedRenter: true
    }
  });

  if (!schedule) {
    throw new AppError("Payment schedule not found", 404, "PAYMENT_SCHEDULE_NOT_FOUND");
  }

  const now = new Date();
  await prisma.paymentSchedule.update({
    where: { id: schedule.id },
    data: {
      status: "PAID",
      paidAt: now,
      confirmedByRenterAt: now,
      confirmationNote: input.note?.trim() || null,
      receiptReference: input.receiptReference?.trim() || null
    }
  });

  if (schedule.paymentType === "RENT" && schedule.dueDate >= now) {
    await recordRentScoreEvent({
      publicAccountId: input.publicAccountId,
      ruleCode: "RENT_PAID_ON_TIME",
      quantity: 1,
      sourceNote: "Renter confirmed on-time rent payment"
    });
  }

  if (schedule.paymentType === "UTILITY" && schedule.dueDate >= now) {
    await recordRentScoreEvent({
      publicAccountId: input.publicAccountId,
      ruleCode: "CONSISTENT_UTILITY_PAYMENT",
      quantity: 1,
      sourceNote: "Renter confirmed utility payment"
    });
  }

  await logRenterActivity({
    proposedRenterId: schedule.proposedRenterId,
    actorAccountId: input.publicAccountId,
    activityType: "RENTER_PAYMENT_CONFIRMED",
    message: `${schedule.paymentType.replaceAll("_", " ")} payment confirmed by renter.`,
    metadata: {
      paymentScheduleId: schedule.id,
      receiptReference: input.receiptReference?.trim() || null
    } as Prisma.JsonObject
  });

  return getRenterDashboard(input.publicAccountId);
}

export async function shareRenterScoreReport(input: {
  publicAccountId: string;
  recipientEmail: string;
  recipientType: "LANDLORD" | "AGENT";
  recipientFirstName?: string;
  recipientLastName?: string;
  recipientPhone?: string;
  note?: string;
}) {
  const account = await getRenterAccount(input.publicAccountId);
  const recipientEmail = normalizeEmail(input.recipientEmail);

  if (recipientEmail === normalizeEmail(account.email)) {
    throw new AppError("Use a landlord or agent email to share this report", 400, "VALIDATION_ERROR");
  }

  const recipientAccount = await prisma.publicAccount.findUnique({
    where: { email: recipientEmail }
  });

  if (recipientAccount && recipientAccount.accountType !== input.recipientType) {
    throw new AppError(
      `This email already belongs to a ${recipientAccount.accountType.toLowerCase()} account, not ${input.recipientType.toLowerCase()}.`,
      400,
      "VALIDATION_ERROR"
    );
  }

  const [rentScore, linkedCases] = await Promise.all([
    buildRentScoreSnapshot(account.id),
    prisma.proposedRenter.findMany({
      where: { renterAccountId: account.id },
      include: {
        property: true
      },
      orderBy: { createdAt: "desc" }
    })
  ]);

  try {
    await prisma.renterScoreShare.create({
      data: {
        publicAccountId: account.id,
        recipientEmail,
        recipientType: input.recipientType,
        recipientAccountId: recipientAccount?.id,
        recipientFirstName: recipientAccount ? recipientAccount.firstName : input.recipientFirstName?.trim() || null,
        recipientLastName: recipientAccount ? recipientAccount.lastName : input.recipientLastName?.trim() || null,
        recipientPhone: recipientAccount ? recipientAccount.phone : input.recipientPhone?.trim() || null,
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
          recipientType: input.recipientType,
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
      const legacySharePreview = createMailPreview({
        category: "RENTER_SHARE_REPORT",
        to: recipientEmail,
        subject: "RentSure rent score report shared with you",
        html: `
          <div style="font-family: Arial, sans-serif; color: #0f172a;">
            <p style="font-size: 14px; color: #475569;">Hello,</p>
            <p style="font-size: 14px; line-height: 1.7; color: #334155;">
              ${publicAccountDisplayName(account)} has shared a RentSure rent score report with you.
            </p>
            <div style="border: 1px solid #dbe4f3; border-radius: 16px; padding: 16px; background: #f8fbff; margin: 20px 0;">
              <p style="margin: 0; font-size: 12px; letter-spacing: 0.16em; text-transform: uppercase; color: #1d4ed8;">Rent score</p>
              <p style="margin: 8px 0 0; font-size: 28px; font-weight: 700;">${rentScore.summary.score} / ${rentScore.summary.maxScore}</p>
              <p style="margin: 8px 0 0; color: #475569;">Band: ${rentScore.summary.scoreBand}</p>
            </div>
          </div>
        `
      });
      return {
        dashboard: await getRenterDashboard(account.id),
        sharePreviewUrl: process.env.NODE_ENV === "production" ? null : legacySharePreview.previewUrl
      };
    }
    throw error;
  }

  const sharePreview = createMailPreview({
    category: "RENTER_SHARE_REPORT",
    to: recipientEmail,
    subject: "RentSure rent score report shared with you",
    html: `
      <div style="font-family: Arial, sans-serif; color: #0f172a;">
        <p style="font-size: 14px; color: #475569;">Hello,</p>
        <p style="font-size: 14px; line-height: 1.7; color: #334155;">
          ${publicAccountDisplayName(account)} has shared a RentSure rent score report with you.
        </p>
        <div style="border: 1px solid #dbe4f3; border-radius: 16px; padding: 16px; background: #f8fbff; margin: 20px 0;">
          <p style="margin: 0; font-size: 12px; letter-spacing: 0.16em; text-transform: uppercase; color: #1d4ed8;">Rent score</p>
          <p style="margin: 8px 0 0; font-size: 28px; font-weight: 700;">${rentScore.summary.score} / ${rentScore.summary.maxScore}</p>
          <p style="margin: 8px 0 0; color: #475569;">Band: ${rentScore.summary.scoreBand}</p>
        </div>
        ${
          input.note?.trim()
            ? `<p style="font-size: 14px; line-height: 1.7; color: #334155;"><strong>Note:</strong> ${input.note.trim()}</p>`
            : ""
        }
        <p style="font-size: 14px; line-height: 1.7; color: #334155;">
          This preview shows the outbound share email in development while live email delivery is still being connected.
        </p>
      </div>
    `
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
